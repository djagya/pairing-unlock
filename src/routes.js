const uuidv1 = require('uuid/v1');
const { applyFixture } = require('./db');

const isDev = process.env.NODE_ENV === 'development';
// There's no specified expiration time for OTP codes,
// but it's a good security measure, so I'll consider it invalid after 5 minutes.
const OTP_EXPIRATION = 5 * 60;
const OTP_ATTEMPTS_LIMIT = 3;

const PAIRING_EXPIRATION = 2 * 60;

const isCodeValid = (saved, code, expiration) => saved && saved.code
  // Code matches.
  && saved.code === code
  // Not expired.
  && (!expiration || (Date.now() - new Date(saved.createdAt).getTime()) / 1000 < expiration);

module.exports = function (app, db, client) {
  // Not sure what is supposed to be an authentication/identification method of user,
  // so I use a phone number that is naturally must be available for every request.

  // todo: the given information is not enough to decide whether a separate "vehicles" collection is required,
  // where pairing code, unlock status would be stored. For now everything is stored in users collection.
  const users = db.collection('users');

  const userNotFound = (res, phone) => res.status(404).json({ error: `User with phone number ${phone} not found` });
  const badRequest = (res, msg) => res.status(400).json({ error: msg });
  const unauthorized = (res, msg) => res.status(401).json({ error: msg });
  const forbidden = (res, msg) => res.status(403).json({ error: msg });
  const log = (...args) => isDev && console.log(...args);

  const logAttempt = async (phone, type, code) => {
    await users.updateOne({ phone }, { $push: { attempts: { type, code, createdAt: new Date() } } });
    log(`Logged an attempt of ${type} validation: code=${code}, user=${phone}`);
  };

  /**
   * OTP validation.
   * Required JSON body params:
   * - phone: the user phone to identify
   * - code: OTP code to validate
   *
   * Additionally returns a generated uuid that must be stored by the client app to make further requests
   * and prevent pairing/unlocking using another phone.
   */
  app.post('/user/otp', async (req, res) => {
    const { phone, code } = req.body;

    if (!phone) {
      return badRequest(res, 'No phone number provided');
    }
    if (!code) {
      return badRequest(res, 'No OTP provided');
    }
    const user = await users.findOne({ phone });
    if (!user) {
      return userNotFound(res, phone);
    }
    log('Found user', { user });
    if (user.requiresReset) {
      return forbidden(res, 'You must contact support to start over');
    }
    if (user.verified || user.paired) {
      return badRequest(res, 'You are already verified');
    }
    if (!user.otp.code) {
      return badRequest(res, 'The OTP code is not generated. Request the system for a new code.');
    }

    let attemptsCount = (user.attempts || []).filter(_ => _.type === 'otp').length;
    if (attemptsCount >= OTP_ATTEMPTS_LIMIT) {
      return forbidden(res, 'OTP verification attempts limit is reached. Contact the support to start over.');
    }

    // Log an attempt and validate in a transaction.
    const uuid = uuidv1();
    let isValid = false;
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Log an attempt.
        await logAttempt(phone, 'otp', code);
        attemptsCount += 1;

        // Mark as verified if valid.
        if (isCodeValid(user.otp, code, OTP_EXPIRATION)) {
          isValid = true;
          await users.updateOne({ phone }, { $set: { verified: true, uuid } });
          return;
        }
        // If invalid and limit reached, mark user as requiring reset.
        if (attemptsCount >= OTP_ATTEMPTS_LIMIT) {
          await users.updateOne({ phone }, { $set: { requiresReset: true } });
        }
      });
    } catch (err) {
      log('Failed transaction', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (!isValid) {
      return attemptsCount >= OTP_ATTEMPTS_LIMIT
        ? forbidden(res, 'OTP verification attempts limit is reached. Contact the support to start over.')
        : badRequest(res, `Invalid OTP code. Remaining attempts ${OTP_ATTEMPTS_LIMIT - attemptsCount}`);
    }

    return res.json({ message: 'Successfully validated', uuid });
  });

  /**
   * Pairing code validation.
   * Required JSON body params:
   * - phone: the user phone to identify
   * - code: pairing code to validate
   * - uuid: unique id stored on the client from the OTP verification step
   */
  app.post('/user/pair', async (req, res) => {
    const { phone, code, uuid } = req.body;

    if (!phone) {
      return badRequest(res, 'No phone number provided');
    }
    if (!code) {
      return badRequest(res, 'No pairing code provided');
    }
    const user = await users.findOne({ phone });
    if (!user) {
      return userNotFound(res, phone);
    }
    log('Found user', { user });
    if (user.requiresReset) {
      return forbidden(res, 'You must contact support to start over');
    }
    if (!user.verified || !user.uuid) {
      return forbidden(res, 'You are not verified yet. Start with OTP verification.');
    }
    if (user.uuid !== uuid) {
      return unauthorized(res, 'Invalid identification number. Do you make a request from a different device?');
    }
    if (user.paired) {
      return badRequest(res, 'You are already paired with the scooter');
    }
    if (!user.pairing.code) {
      return badRequest(res, 'The pairing code is not generated. Start with OTP verification.');
    }

    // Log an attempt and validate in a transaction.
    let errorMessage;
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Log an attempt.
        await logAttempt(phone, 'pairing', code);

        // If code is already expired, lock the user.
        if ((Date.now() - new Date(user.pairing.createdAt).getTime()) / 1000 > PAIRING_EXPIRATION) {
          await users.updateOne({ phone }, { $set: { requiresReset: true } });
          errorMessage = 'Pairing code expired. Contact the support to start over.';
          return;
        }

        // Validate and pair.
        if (isCodeValid(user.pairing, code)) {
          await users.updateOne({ phone }, { $set: { paired: true } });
        } else {
          errorMessage = 'Invalid pairing code';
        }
      });
    } catch (err) {
      log('Failed transaction', err.message);
      return res.status(500).json({ error: 'Server error' });
    }

    if (errorMessage) {
      return badRequest(res, errorMessage);
    }

    return res.json({ message: 'Successfully paired' });
  });

  /**
   * Reset pairing process:
   * - reset OTP code
   * - reset pairing code
   * - reset attempt history
   * - reset flags: paired, verified, requiresReset
   * Accessible ONLY by a customer agent.
   * For now the simplest authentication via a static authToken is used.
   * todo: implement a proper agent authentication
   */
  app.post('/user/reset', async (req, res) => {
    const { authToken, phone } = req.body;

    if (!authToken || authToken !== process.env.AGENT_AUTH) {
      return unauthorized(res, 'Invalid agent authentication token');
    }

    const user = await users.findOne({ phone });
    if (!user) {
      return userNotFound(res, phone);
    }

    await users.updateOne({ phone }, {
      $set: {
        uuid: null,
        otp: {},
        pairing: {},
        attempts: [],
        paired: false,
        verified: false,
        requiresReset: false,
      },
    });
    log('User has been reset', { user });

    return res.json({ message: 'User has been reset' });
  });

  /**
   * Unlock command.
   * Required JSON body params:
   * - phone: the user phone to identify
   * - uuid: unique id stored on the client from the OTP verification step
   */
  app.post('/user/unlock', async (req, res) => {
    const { phone, uuid } = req.body;

    if (!phone) {
      return badRequest(res, 'No phone number provided');
    }
    const user = await users.findOne({ phone });
    if (!user) {
      return userNotFound(res, phone);
    }
    if (!user.paired) {
      return forbidden(res, 'You are not paired yet. Start with OTP verification.');
    }
    if (user.uuid !== uuid) {
      return unauthorized(res, 'Invalid identification number. Do you make a request from a different device?');
    }
    if (user.unlocked) {
      return badRequest(res, 'Vehicle is already unlocked');
    }

    await users.updateOne({ phone }, { $set: { unlocked: true } });

    return res.json({ message: 'Vehicle has been unlocked' });
  });

  if (isDev) {
    app.delete('/user', async (req, res) => {
      await users.deleteMany({});
      await applyFixture(db);
      res.json({ message: 'All users recreated' });
    });
    /**
     * Code generation for a user identified by phone for development purposes.
     * Creates OTP and pairing codes with the creation date set to Date.now().
     * Required JSON body params:
     * - otpCode: the code number
     * - pairingCode: the code number
     */
    app.post('/user/codegen', async (req, res) => {
      const { phone, otpCode, pairingCode } = req.body;

      const r = await users.updateOne({ phone }, {
        $set: {
          otp: { code: otpCode, createdAt: new Date() },
          pairing: { code: pairingCode, createdAt: new Date() },
        },
      });
      if (r.modifiedCount === 0) {
        res.json({ error: `Not created for user ${phone}` });
        return;
      }
      log(`For user with phone ${phone} created codes: otp=${otpCode}, pairing=${pairingCode}`);
      res.json({ message: `Created new codes for user ${phone}` });
    });
  }
};
