const axios = require('axios');

const phone = '111-222-333';
const otpCode = '111111';
const pairingCode = '222222';

(async () => {
  let res;

  console.log('Reset');
  await axios({
    method: 'DELETE',
    url: 'http://localhost:8080/user',
  });

  console.log(`\nCreating codes for phone=${phone}: otp=${otpCode}, pairing=${pairingCode}`);
  res = await axios({
    method: 'POST',
    url: 'http://localhost:8080/user/codegen',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    data: {
      otpCode,
      phone,
      pairingCode,
    },
  });
  console.log('Response:', res.data);


  console.log('\nValidating invalid OTP code');
  try {
    await axios({
      method: 'POST',
      url: 'http://localhost:8080/user/otp',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      data: {
        phone: '111-222-333',
        code: '444',
      },
    });
  } catch (err) {
    console.log('Expected error: ', err.message, err.response.data);
  }

  console.log('\nValidating valid OTP code');
  res = await axios({
    method: 'POST',
    url: 'http://localhost:8080/user/otp',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    data: {
      phone,
      code: otpCode,
    },
  });
  console.log('Response', res.data);
  const { uuid } = res.data;

  console.log('\nValidating invalid pairing code');
  try {
    await axios({
      method: 'POST',
      url: 'http://localhost:8080/user/pair',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      data: {
        phone,
        uuid,
        code: '123',
      },
    });
  } catch (err) {
    console.log('Expected error: ', err.message, err.response.data);
  }

  console.log('\nValidating valid pairing code');
  await axios({
    method: 'POST',
    url: 'http://localhost:8080/user/pair',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    data: {
      phone,
      uuid,
      code: pairingCode,
    },
  });

  console.log('\nTrying to unlock');
  await axios({
    method: 'POST',
    url: 'http://localhost:8080/user/unlock',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
    data: {
      phone,
      uuid,
    },
  });
  console.log('Success unlock');
})();
