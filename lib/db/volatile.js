// Volatile database: notifications, checkins, xp_log, likes (high-write tables)
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const DB_PATH = path.join(config.DATA_DIR, 'volatile.db');
if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(RESTART)');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      link TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      checkin_date DATE NOT NULL DEFAULT (date('now')),
      xp_earned INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, checkin_date)
    );
    CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, checkin_date);

    CREATE TABLE IF NOT EXISTS xp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id);

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      post_id INTEGER,
      comment_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id, comment_id)
    );
  `);
}

module.exports = { db, init };
