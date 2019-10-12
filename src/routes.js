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
  // Not sure what is supposed to be an authentication method of user,
  // so I use a phone number that is naturally must be available for each request.
  const users = db.collection('users');

  const userNotFound = (res, phone) => res.status(404).json({ error: `User with phone number ${phone} not found` });
  const badRequest = (res, msg) => res.status(400).json({ error: msg });
  const log = (...args) => isDev && console.log(...args);

  const logAttempt = async (phone, type, code) => {
    await users.updateOne({ phone }, { $push: { attempts: { type, code, createdAt: new Date() } } });
    log(`Logged an attempt of ${type} validation: code=${code}, user=${phone}`);
  };

  /**
   * OTP validation.
   * Required body params:
   * - phone: the user phone to identify
   * - code: OTP code to validate
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
      return badRequest(res, 'You must contact support to start over');
    }
    if (user.verified || user.paired) {
      return badRequest(res, 'You are already verified');
    }
    if (!user.otp) {
      return badRequest(res, 'The OTP code is not generated. Request the system for a new code.');
    }

    let attemptsCount = (user.attempts || []).filter(_ => _.type === 'otp').length;
    if (attemptsCount >= OTP_ATTEMPTS_LIMIT) {
      return badRequest(res, 'OTP verification attempts limit is reached. Contact the support to start over.');
    }

    // Log an attempt and validate in a transaction.
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
          await users.updateOne({ phone }, { $set: { verified: true } });
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
        ? badRequest(res, 'OTP verification attempts limit is reached. Contact the support to start over.')
        : badRequest(res, `Invalid OTP code. Remaining attempts ${OTP_ATTEMPTS_LIMIT - attemptsCount}`);
    }

    return res.json({ message: 'Successfully validated' });
  });

  /**
   * Pairing code validation.
   * Required body params:
   * - phone: the user phone to identify
   * - code: pairing code to validate
   */
  app.post('/user/pair', async (req, res) => {
    const { phone, code } = req.body;

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
      return badRequest(res, 'You must contact support to start over');
    }
    if (!user.verified) {
      return badRequest(res, 'You are not verified yet. Start with OTP verification.');
    }
    if (user.paired) {
      return badRequest(res, 'You are already paired with the scooter');
    }
    if (!user.pairing) {
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
   * Reset pairing process.
   * Accessible ONLY by a customer agent.
   */
  app.post('/user/reset', (req, res) => {
    res.send('resetting process');
  });

  /**
   * Unlock command.
   */
  app.post('/vehicle/:vin/unlock', (req, res) => {
    res.send('unlock vehicle!');
  });

  if (isDev) {
    app.delete('/user', async (req, res) => {
      await users.deleteMany({});
      await applyFixture(db);
      res.json({ message: 'All users recreated' });
    });
    /**
     * Code generation for a user identified by phone for development purposes.
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
