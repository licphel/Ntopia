// Unified database — all tables in a single SQLite file
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../config');

const DB_PATH = path.join(config.DATA_DIR, 'ntopia.db');
if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(RESTART)');

function init() {
  // ── Core tables ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '/img/default-avatar.png',
      role INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1,
      consecutive_days INTEGER DEFAULT 0,
      last_checkin DATE,
      banned INTEGER DEFAULT 0,
      email TEXT DEFAULT '',
      desc TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content_md TEXT NOT NULL,
      content_html TEXT NOT NULL,
      excerpt TEXT DEFAULT '',
      category TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      author_id INTEGER NOT NULL REFERENCES users(id),
      is_draft INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      content_md TEXT NOT NULL,
      content_html TEXT NOT NULL,
      parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      is_deleted INTEGER DEFAULT 0,
      deleted_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS post_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content_md TEXT NOT NULL,
      content_html TEXT NOT NULL,
      excerpt TEXT DEFAULT '',
      category TEXT DEFAULT '',
      tags TEXT DEFAULT '',
      revised_by INTEGER NOT NULL REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Social tables ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL REFERENCES users(id),
      to_id INTEGER NOT NULL REFERENCES users(id),
      content_md TEXT NOT NULL,
      content_html TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      post_id INTEGER NOT NULL REFERENCES posts(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    -- ── Volatile / high-write tables ────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      link TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      checkin_date DATE NOT NULL DEFAULT (date('now')),
      xp_earned INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, checkin_date)
    );

    CREATE TABLE IF NOT EXISTS xp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      post_id INTEGER REFERENCES posts(id),
      comment_id INTEGER REFERENCES comments(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    -- Partial unique indexes: NULLs are distinct in SQLite, so standard UNIQUE fails
    CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_post ON likes(user_id, post_id) WHERE comment_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_comment ON likes(user_id, comment_id) WHERE post_id IS NULL;

    CREATE TABLE IF NOT EXISTS email_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      attempts INTEGER DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Indexes ─────────────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
    CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_post ON post_revisions(post_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON bookmarks(post_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, checkin_date);
    CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);
    CREATE INDEX IF NOT EXISTS idx_likes_comment ON likes(comment_id);
    CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, expires_at);
  `);

  // ── Migrations: add columns that might not exist in older DBs ─
  for (const [table, col, type] of [
    ['users', 'xp', 'INTEGER DEFAULT 0'],
    ['users', 'level', 'INTEGER DEFAULT 1'],
    ['users', 'consecutive_days', 'INTEGER DEFAULT 0'],
    ['users', 'last_checkin', 'DATE'],
    ['users', 'avatar', "TEXT DEFAULT '/img/default-avatar.png'"],
    ['users', 'email', "TEXT DEFAULT ''"],
    ['users', 'banned', 'INTEGER DEFAULT 0'],
    ['users', 'role', 'INTEGER DEFAULT 1'],
    ['users', 'desc', "TEXT DEFAULT ''"],
    ['posts', 'is_draft', 'INTEGER DEFAULT 0'],
    ['posts', 'is_deleted', 'INTEGER DEFAULT 0'],
    ['posts', 'deleted_at', 'DATETIME'],
    ['posts', 'view_count', 'INTEGER DEFAULT 0'],
    ['comments', 'is_deleted', 'INTEGER DEFAULT 0'],
    ['comments', 'deleted_at', 'DATETIME'],
  ]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (_) { /* already exists */ }
  }

  // ── Cleanup old soft-deleted content (>60 days) ───────────────
  db.exec(`
    DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days'));
    DELETE FROM comments WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days');
    DELETE FROM posts WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days');
    DELETE FROM email_codes WHERE expires_at < datetime('now');
  `);

  // ── Create owner if not exists ────────────────────────────────
  const owner = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!owner) {
    const hash = bcrypt.hashSync(config.OWNER_PASSWORD, 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, 128, ?)')
      .run(config.OWNER_NAME.toLowerCase(), hash, config.OWNER_NAME, config.OWNER_EMAIL);
  }

  // ── Default categories ────────────────────────────────────────
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)');
    for (const [name, slug, desc, ord] of [
      ['计算机', 'computer', '信息', 1],
      ['数学', 'math', '数学', 2],
      ['自然', 'nature', '自然', 3],
      ['生活', 'life', '生活', 4],
      ['杂谈', 'misc', '杂谈', 5],
      ['论坛', 'forum', '论坛', 6],
    ]) {
      insert.run(name, slug, desc, ord);
    }
  }
}

module.exports = { db, init };
