// Social database: messages, bookmarks
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const DB_PATH = path.join(config.DATA_DIR, 'social.db');
if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(RESTART)');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL,
      to_id INTEGER NOT NULL,
      content_md TEXT NOT NULL,
      content_html TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id);

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );
  `);
}

module.exports = { db, init };
