function getUserFixture(phone, vin) {
  return {
    phone,
    vin,
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
