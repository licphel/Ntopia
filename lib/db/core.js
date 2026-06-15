// Core database: users, posts, comments, categories, post_revisions
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const config = require('../config');

const DB_PATH = path.join(config.DATA_DIR, 'core.db');
if (!fs.existsSync(config.DATA_DIR)) fs.mkdirSync(config.DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('wal_checkpoint(RESTART)');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      bio TEXT DEFAULT '',
      avatar TEXT DEFAULT '/img/default-avatar.svg',
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

    CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
  `);

  // Migrations: add columns that might not exist
  for (const col of [
    ['users', 'xp', 'INTEGER DEFAULT 0'],
    ['users', 'level', 'INTEGER DEFAULT 1'],
    ['users', 'consecutive_days', 'INTEGER DEFAULT 0'],
    ['users', 'last_checkin', 'DATE'],
    ['users', 'avatar', "TEXT DEFAULT '/img/default-avatar.svg'"],
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
    try { db.exec(`ALTER TABLE ${col[0]} ADD COLUMN ${col[1]} ${col[2]}`); } catch(e) {}
  }

  // Cleanup old soft-deleted content (>60 days)
  db.prepare("DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days'))").run();
  db.prepare("DELETE FROM comments WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days')").run();
  db.prepare("DELETE FROM posts WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days')").run();

  // Create owner if not exists
  const owner = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!owner) {
    const hash = bcrypt.hashSync(config.OWNER_PASSWORD, 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, 128, ?)')
      .run(config.OWNER_NAME.toLowerCase(), hash, config.OWNER_NAME, config.OWNER_EMAIL);
  }

  // Insert default categories if none
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    const cats = [
      ['计算机', 'computer', '信息', 1],
      ['数学', 'math', '数学', 2],
      ['自然', 'nature', '自然', 3],
      ['生活', 'life', '生活', 4],
      ['杂谈', 'misc', '杂谈', 5],
      ['论坛', 'forum', '论坛', 6],
    ];
    const insert = db.prepare('INSERT OR IGNORE INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)');
    for (const c of cats) insert.run(...c);
  }

  // Post revision history
  db.exec(`CREATE TABLE IF NOT EXISTS post_revisions (
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
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_revisions_post ON post_revisions(post_id)');
}

module.exports = { db, init };
