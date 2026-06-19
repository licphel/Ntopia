// Ntopia 2.0 — entry point (Fastify)
require('dotenv').config();
const { initDB } = require('./src/database');
initDB();

const app = require('./src/app');
const config = require('./src/config');

const start = async () => {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Ntopia 2.0 running at http://localhost:${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};
start();
