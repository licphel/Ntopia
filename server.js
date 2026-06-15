require('dotenv').config();
const { initDB } = require('./lib/db');
const app = require('./lib/app');
const config = require('./lib/config');

initDB();
app.listen(config.PORT, () => {
  console.log(`Ntopia running at http://localhost:${config.PORT}`);
});
