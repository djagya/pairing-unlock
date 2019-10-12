const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const port = 3000;

// DB.
// todo: setup cluster
// fixme: Could use a proper role-based access: agents, users.
const client = new MongoClient('mongodb://localhost:27017');
const db = () => client.db('app');


// todo: use socket.io for Websocket support
// Routes.

// Not sure what is supposed to be an authentication method of user,
// so I use a phone number that is naturally must be available for each request.

/**
 * OTP validation.
 */
app.post('/user/otp', (req, res) => {
  res.send('OTP validation');
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

// Start.
(async () => {
  await client.connect();
  console.log('Connected to DB.');

  app.listen(port, () => console.log(`Listening on ${port}`));
})();
