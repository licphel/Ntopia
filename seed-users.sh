#!/bin/bash
# Generate test accounts: t1-t5, password 1111, email 1111@test.com

node -e "
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDB, db } = require('./lib/db');
initDB();
const hash = bcrypt.hashSync('1111', 10);
const upsert = db.prepare(\`INSERT INTO users (username, password_hash, display_name, role, banned, email)
  VALUES (?, ?, ?, ?, ?, '1111@test.com')
  ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, role=excluded.role, banned=excluded.banned, email=excluded.email\`);
for (const [u, r, b, l] of [['t1',1,1,'User (banned)'],['t2',1,0,'User'],['t3',16,0,'Mod'],['t4',32,0,'Admin'],['t5',64,0,'Super Admin']]) {
  upsert.run(u, hash, l, r, b);
  console.log(u + ' — ' + l + ' (role=' + r + ')');
}
console.log('\nPasswords: 1111 | Emails: 1111@test.com');
process.exit(0);
" 2>&1 | grep -v 'injected\|tip:'
