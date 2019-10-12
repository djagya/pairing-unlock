function getUserFixture(phone, vin) {
  return {
    phone,
    vin,
    // UUID of the phone used for OTP verification and pairing, prevent making requests from other phone.
    // Must be stored on the client app.
    // Optionally can be replaced by some unique permanent device id coming from the client.
    uuid: null,
    // Was the pairing successful?
    paired: false,
    // Was the OTP code verified?
    verified: false,
    // Did the pairing fail and now requires reset by an agent?
    requiresReset: false,
    // Contains last generated OTP: { code: '123456', createdAt: Date }
    otp: {},
    // Contains last generated pairing code: { code: '123456', createdAt: Date }
    pairing: {},
    // Contains a history of pairing attempts since last reset:
    // { type: 'otp'|'pairing', code: '123456', createdAt: Date }
    attempts: [],
    // Is the vehicle unlocked?
    unlocked: false,
  };
}

module.exports = {
  async applyFixture(db) {
    const col = db.collection('users');
    const count = await col.countDocuments();
    if (count > 0) {
      console.log(`Skipping fixture, there are ${count} documents in the users collection already.`);
      return;
    }

    const r = await col.insertMany([
      getUserFixture('111-222-333', '123456'),
      getUserFixture('123-456-789', '666333'),
      getUserFixture('444-555-666', '987654'),
    ]);
    console.log(`Inserted ${r.insertedCount} sample users`);
  },
};
