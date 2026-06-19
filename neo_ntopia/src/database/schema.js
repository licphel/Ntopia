// Database initialization — creates/upgrades schema, indexes, and default data.
const Database = require('better-sqlite3');
const fs = require('fs');
const config = require('../config');

/** @returns {import('better-sqlite3').Database} */
function createConnection() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
  }

  const db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('wal_checkpoint(RESTART)');
  return db;
}

/** @param {import('better-sqlite3').Database} db */
function initSchema(db) {
  db.exec(`
    -- ── Users ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      username        TEXT UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      display_name    TEXT,
      bio             TEXT DEFAULT '',
      avatar          TEXT DEFAULT '/img/default-avatar.png',
      role            INTEGER DEFAULT 1,
      xp              INTEGER DEFAULT 0,
      level           INTEGER DEFAULT 1,
      consecutive_days INTEGER DEFAULT 0,
      last_checkin    DATE,
      banned          INTEGER DEFAULT 0,
      banned_until    DATETIME,
      email           TEXT DEFAULT '',
      desc            TEXT DEFAULT '',
      deleted_at      DATETIME,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Categories ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      slug        TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      type        TEXT DEFAULT 'blog' CHECK(type IN ('blog','forum')),
      sort_order  INTEGER DEFAULT 0
    );

    -- ── Posts ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      slug        TEXT NOT NULL,
      content_md  TEXT NOT NULL,
      content_html TEXT NOT NULL,
      category    TEXT DEFAULT '',
      tags        TEXT DEFAULT '',
      author_id   INTEGER NOT NULL REFERENCES users(id),
      is_draft    INTEGER DEFAULT 0,
      is_deleted  INTEGER DEFAULT 0,
      is_pinned   INTEGER DEFAULT 0,
      license     TEXT DEFAULT '',
      view_count  INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at  DATETIME
    );

    -- ── Comments ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id   INTEGER NOT NULL REFERENCES users(id),
      content_md  TEXT NOT NULL,
      content_html TEXT NOT NULL,
      parent_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      is_deleted  INTEGER DEFAULT 0,
      deleted_at  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Post Revisions ────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS post_revisions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      content_md  TEXT NOT NULL,
      content_html TEXT NOT NULL,
      category    TEXT DEFAULT '',
      tags        TEXT DEFAULT '',
      revised_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Messages ──────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id     INTEGER NOT NULL REFERENCES users(id),
      to_id       INTEGER NOT NULL REFERENCES users(id),
      content_md  TEXT NOT NULL,
      content_html TEXT NOT NULL,
      is_read     INTEGER DEFAULT 0,
      is_deleted  INTEGER DEFAULT 0,
      deleted_at  DATETIME,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Notifications ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      link        TEXT NOT NULL,
      is_read     INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Likes ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS likes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      post_id     INTEGER REFERENCES posts(id),
      comment_id  INTEGER REFERENCES comments(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Bookmarks ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS bookmarks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      post_id     INTEGER NOT NULL REFERENCES posts(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    -- ── Follows ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS follows (
      user_id     INTEGER NOT NULL REFERENCES users(id),
      follow_id   INTEGER NOT NULL REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, follow_id)
    );

    -- ── Check-ins ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS checkins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      checkin_date DATE NOT NULL DEFAULT (date('now')),
      xp_earned    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, checkin_date)
    );

    -- ── XP Log ────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS xp_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      amount      INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      ref_id      INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Attachments ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS attachments (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      filename      TEXT NOT NULL,
      stored_name   TEXT NOT NULL,
      virtual_path  TEXT DEFAULT '/',
      file_size     INTEGER DEFAULT 0,
      mime_type     TEXT DEFAULT '',
      download_count INTEGER DEFAULT 0,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Email Codes ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS email_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      code        TEXT NOT NULL,
      attempts    INTEGER DEFAULT 0,
      expires_at  DATETIME NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Reports ───────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      reporter_id INTEGER NOT NULL REFERENCES users(id),
      type        TEXT NOT NULL CHECK(type IN ('post','comment')),
      target_id   INTEGER NOT NULL,
      reason      TEXT DEFAULT '',
      status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','resolved','dismissed')),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_by INTEGER REFERENCES users(id),
      resolved_at DATETIME
    );

    -- ── Login Logs ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS login_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      ip          TEXT DEFAULT '',
      user_agent  TEXT DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Site Views ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS site_views (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT DEFAULT '',
      ip          TEXT DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** @param {import('better-sqlite3').Database} db */
function initIndexes(db) {
  db.exec(`
    -- Unique indexes for likes (SQLite partial unique indexes)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_post
      ON likes(user_id, post_id) WHERE comment_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_comment
      ON likes(user_id, comment_id) WHERE post_id IS NULL;

    -- Core indexes
    CREATE INDEX IF NOT EXISTS idx_posts_slug       ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_author     ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_posts_category   ON posts(category);
    CREATE INDEX IF NOT EXISTS idx_posts_created    ON posts(created_at);
    CREATE INDEX IF NOT EXISTS idx_comments_post    ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author  ON comments(author_id);
    CREATE INDEX IF NOT EXISTS idx_revisions_post   ON post_revisions(post_id);
    CREATE INDEX IF NOT EXISTS idx_messages_to      ON messages(to_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_messages_from    ON messages(from_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user   ON bookmarks(user_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_post   ON bookmarks(post_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user       ON notifications(user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_notif_created    ON notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_checkins_user    ON checkins(user_id, checkin_date);
    CREATE INDEX IF NOT EXISTS idx_xp_log_user      ON xp_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_likes_post       ON likes(post_id);
    CREATE INDEX IF NOT EXISTS idx_likes_comment    ON likes(comment_id);
    CREATE INDEX IF NOT EXISTS idx_follows_follow   ON follows(follow_id);
    CREATE INDEX IF NOT EXISTS idx_reports_status   ON reports(status);
    CREATE INDEX IF NOT EXISTS idx_login_logs_user  ON login_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_name ON attachments(filename);
    CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, expires_at);
  `);
}

/** @param {import('better-sqlite3').Database} db */
function initFTS(db) {
  // Drop old FTS table and triggers (may exist from previous schema without category)
  db.exec(`
    DROP TRIGGER IF EXISTS posts_fts_insert;
    DROP TRIGGER IF EXISTS posts_fts_delete;
    DROP TRIGGER IF EXISTS posts_fts_update;
    DROP TABLE IF EXISTS posts_fts;
  `);

  // Full-text search — includes category so searching by section name works
  db.exec(`
    CREATE VIRTUAL TABLE posts_fts
      USING fts5(title, content_md, tags, category, content=posts, content_rowid=id,
                 tokenize='unicode61 remove_diacritics 2');
  `);

  // Populate existing posts into FTS
  db.exec(`
    INSERT INTO posts_fts(rowid, title, content_md, tags, category)
      SELECT id, title, content_md, tags, category FROM posts
  `);

  // Triggers to keep FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, content_md, tags, category)
        VALUES (new.id, new.title, new.content_md, new.tags, new.category);
    END;

    CREATE TRIGGER IF NOT EXISTS posts_fts_delete AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, content_md, tags, category)
        VALUES('delete', old.id, old.title, old.content_md, old.tags, old.category);
    END;

    CREATE TRIGGER IF NOT EXISTS posts_fts_update AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, content_md, tags, category)
        VALUES('delete', old.id, old.title, old.content_md, old.tags, old.category);
      INSERT INTO posts_fts(rowid, title, content_md, tags, category)
        VALUES (new.id, new.title, new.content_md, new.tags, new.category);
    END;
  `);
}

/** @param {import('better-sqlite3').Database} db */
function runMigrations(db) {
  const migrations = [
    ['users', 'xp', 'INTEGER DEFAULT 0'],
    ['users', 'level', 'INTEGER DEFAULT 1'],
    ['users', 'consecutive_days', 'INTEGER DEFAULT 0'],
    ['users', 'last_checkin', 'DATE'],
    ['users', 'avatar', "TEXT DEFAULT '/img/default-avatar.png'"],
    ['users', 'email', "TEXT DEFAULT ''"],
    ['users', 'banned', 'INTEGER DEFAULT 0'],
    ['users', 'banned_until', 'DATETIME'],
    ['users', 'deleted_at', 'DATETIME'],
    ['users', 'role', 'INTEGER DEFAULT 1'],
    ['users', 'desc', "TEXT DEFAULT ''"],
    ['posts', 'is_draft', 'INTEGER DEFAULT 0'],
    ['posts', 'is_deleted', 'INTEGER DEFAULT 0'],
    ['posts', 'deleted_at', 'DATETIME'],
    ['posts', 'view_count', 'INTEGER DEFAULT 0'],
    ['posts', 'is_pinned', 'INTEGER DEFAULT 0'],
    ['posts', 'license', "TEXT DEFAULT ''"],
    ['categories', 'type', "TEXT DEFAULT 'blog' CHECK(type IN ('blog','forum'))"],
    ['categories', 'image', "TEXT DEFAULT ''"],
    ['categories', 'moderator_id', 'INTEGER REFERENCES users(id)'],
    ['comments', 'is_deleted', 'INTEGER DEFAULT 0'],
    ['comments', 'deleted_at', 'DATETIME'],
    ['messages', 'is_deleted', 'INTEGER DEFAULT 0'],
    ['messages', 'deleted_at', 'DATETIME'],
  ];

  for (const [table, col, type] of migrations) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (_) { /* exists */ }
  }
}

/** @param {import('better-sqlite3').Database} db */
function seedDefaults(db) {
  const bcrypt = require('bcryptjs');

  // Owner account
  const owner = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!owner) {
    const hash = bcrypt.hashSync(config.OWNER_PASSWORD, 10);
    db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, email)
      VALUES (?, ?, ?, 128, ?)
    `).run(config.OWNER_NAME.toLowerCase(), hash, config.OWNER_NAME, config.OWNER_EMAIL);
  }

  // Default categories (blog + forum)
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO categories (name, slug, description, type, sort_order) VALUES (?, ?, ?, ?, ?)');
    const cats = [
      // blog
      ['计算机', 'computer', '信息', 'blog', 1],
      ['数学',   'math',     '数学', 'blog', 2],
      ['自然',   'nature',   '自然', 'blog', 3],
      ['生活',   'life',     '生活', 'blog', 4],
      ['杂谈',   'misc',     '杂谈', 'blog', 5],
      // forum
      ['综合讨论', 'general',  '各类话题自由讨论', 'forum', 1],
      ['技术交流', 'tech',     '编程与技术',       'forum', 2],
      ['分享创造', 'share',    '分享你的作品',     'forum', 3],
      ['提问求助', 'help',     '问答互助',         'forum', 4],
      ['日常闲聊', 'daily',    '闲聊与日常',       'forum', 5],
    ];
    for (const c of cats) insert.run(...c);
  }
}

module.exports = { createConnection, initSchema, initIndexes, initFTS, runMigrations, seedDefaults };
