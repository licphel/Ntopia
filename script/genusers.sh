#!/usr/bin/env bash
# Generate test users u1~u10, password 1111, email u@1.com
set -e
cd "$(dirname "$0")/.."

node -e "
const bcrypt = require('bcryptjs');
const { initDB, getDB } = require('./src/database');
initDB();
const db = getDB();

const hash = bcrypt.hashSync('1111', 10);
const now = new Date().toISOString().replace('T',' ').slice(0,19);

const insert = db.prepare(\`
  INSERT OR IGNORE INTO users (username, password_hash, display_name, email, role, level, xp, created_at)
  VALUES (?, ?, ?, ?, 1, 1, 0, ?)
\`);

for (let i = 1; i <= 10; i++) {
  const username = 'u' + i;
  insert.run(username, hash, username, 'u@1.com', now);
}

console.log('Created users:', db.prepare('SELECT COUNT(*) as c FROM users').get().c);
const names = db.prepare('SELECT username FROM users WHERE username LIKE ? ORDER BY username').all('u%');
console.log(names.map(u => u.username).join(', '));
"
