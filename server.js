const express = require('express');
const helmet = require('helmet');
const { MongoClient } = require('mongodb');
const routes = require('./src/routes');
const { applyFixture } = require('./src/db');

const port = 3000;
const app = express();
app.use(helmet());
app.use(express.json());

const isDev = process.env.NODE_ENV === 'development';

// DB.
// todo: setup cluster
// fixme: Could use a proper role-based access: agents, users.
const dbUser = process.env.DB_USERNAME;
const dbPass = process.env.DB_PASSWORD;
const dbName = process.env.DB_NAME || 'app';
// todo: configure and use ssl=true
// todo: use a non-root user for access, allow access only to the app db
const client = new MongoClient(`mongodb://${dbUser}:${dbPass}@mongo:27017/?authSource=admin&maxPoolSize=10`, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// todo: use socket.io for Websocket support
// Start.
(async () => {
  try {
    await client.connect();
    const db = client.db(dbName);
    console.log('Connected to DB.');

    // Check fixtures in dev env.
    console.log('Applying fixtures?', isDev ? 'yes' : 'no');
    if (isDev) {
      await applyFixture(db);
    }

    // Configure routes.
    routes(app, db, client);
  } catch (err) {
    console.log(err.stack);
    return;
  }

  const cleanup = () => {
    client.close();
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  app.listen(port, () => console.log(`Listening on ${port}`, { env: process.env.NODE_ENV }));
})();
