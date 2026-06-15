#!/usr/bin/env node
// Run DB migrations safely — adds new tables/columns/indexes, no data loss
require('dotenv').config();
const { initDB } = require('./lib/db');
initDB({ migrateOnly: true });
console.log('Migrations complete. All tables, columns and indexes up to date.');
process.exit(0);
