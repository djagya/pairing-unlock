const { applyFixture } = require('./db');

const isDev = process.env.NODE_ENV === 'development';
// There's no specified expiration time for OTP codes,
// but it's a good security measure, so I'll consider it invalid after 5 minutes.
const OTP_EXPIRATION = 5 * 60;
const OTP_ATTEMPTS_LIMIT = 3;

module.exports = function (app, db, client) {
  // Not sure what is supposed to be an authentication method of user,
  // so I use a phone number that is naturally must be available for each request.
  const users = db.collection('users');

  const userNotFound = (res, phone) => res.status(404).json({ error: `User with phone number ${phone} not found` });
  const badRequest = (res, msg) => res.status(400).json({ error: msg });
  const log = (...args) => isDev && console.log(...args);

  /**
   * OTP validation.
   */
  app.post('/user/otp', async (req, res) => {
    const { phone, otp } = req.body;

    const isCodeValid = (savedOTP, code) => savedOTP && savedOTP.code
      // Code matches.
      && savedOTP.code === code
      // Not expired.
      && (Date.now() - new Date(savedOTP.createdAt).getTime()) / 1000 < OTP_EXPIRATION;

    if (!phone) {
      return badRequest(res, 'No phone number provided');
    }
    if (!otp) {
      return badRequest(res, 'No OPT provided');
    }
    const user = await users.findOne({ phone });
    if (!user) {
      return userNotFound(res, phone);
    }
    log('Found user', { user });
    if (user.verified) {
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
        // await users.updateOne({ phone }, { $push: { attempts: { type: 'otp', code: otp, createdAt: new Date() } } });
        log(`Logged an attempt of OTP validation: code=${otp}, user=${phone}`);
        attemptsCount += 1;

        // Mark as verified if valid.
        if (isCodeValid(user.otp, otp)) {
          isValid = true;
          await users.updateOne({ phone }, { $set: { verified: true } });
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

    return res.json({ message: 'Successful validation' });
  });

  /**
   * Pairing code validation.
   */
  app.post('/user/pair', (req, res) => {
    res.send('pairing validation');
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
