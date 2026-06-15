#!/usr/bin/env node
// Force network time sync
require('dotenv').config();
const time = require('./lib/time');

(async () => {
  console.log('Syncing network time...');
  await time.syncTime();

  const local = Date.now();
  const net = time.now().getTime();
  const offset = net - local;

  console.log(`Local:    ${new Date(local).toISOString()}`);
  console.log(`Network:  ${new Date(net).toISOString()}`);
  console.log(`Offset:   ${offset > 0 ? '+' : ''}${(offset / 1000).toFixed(1)}s`);
  console.log(`Status:   ${time.synced ? 'Synced' : 'Failed, using local clock'}`);
  process.exit(0);
})();
