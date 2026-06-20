// Database initialization — clean schema, no legacy columns.
const Database = require('better-sqlite3');
const fs = require('fs');
const config = require('../config');

function createConnection() {
  if (!fs.existsSync(config.DATA_DIR)) {
    fs.mkdirSync(config.DATA_DIR, { recursive: true, mode: 0o700 });
  }
  const db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initSchema(db) {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      image       TEXT DEFAULT '',
      moderator_id INTEGER REFERENCES users(id),
      sort_order  INTEGER DEFAULT 0,
      is_private  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS posts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      content_md  TEXT NOT NULL,
      content_html TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      sub_category TEXT DEFAULT '',
      author_id   INTEGER NOT NULL REFERENCES users(id),
      is_draft    INTEGER DEFAULT 0,
      is_deleted  INTEGER DEFAULT 0,
      is_pinned   INTEGER DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      view_count  INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at  DATETIME
    );

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

    CREATE TABLE IF NOT EXISTS post_revisions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      content_md  TEXT NOT NULL,
      content_html TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      revised_by  INTEGER NOT NULL REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      type        TEXT NOT NULL,
      content     TEXT NOT NULL,
      link        TEXT NOT NULL,
      is_read     INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS likes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      post_id     INTEGER REFERENCES posts(id),
      comment_id  INTEGER REFERENCES comments(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      post_id     INTEGER NOT NULL REFERENCES posts(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      user_id     INTEGER NOT NULL REFERENCES users(id),
      follow_id   INTEGER NOT NULL REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, follow_id)
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      checkin_date DATE NOT NULL DEFAULT (date('now')),
      xp_earned    INTEGER DEFAULT 1,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, checkin_date)
    );

    CREATE TABLE IF NOT EXISTS xp_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      amount      INTEGER NOT NULL,
      reason      TEXT NOT NULL,
      ref_id      INTEGER,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS email_codes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT NOT NULL,
      code        TEXT NOT NULL,
      attempts    INTEGER DEFAULT 0,
      expires_at  DATETIME NOT NULL,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS login_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      ip          TEXT DEFAULT '',
      user_agent  TEXT DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_views (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      path        TEXT DEFAULT '',
      ip          TEXT DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS section_sub_mods (
      section_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (section_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS section_follows (
      user_id     INTEGER NOT NULL REFERENCES users(id),
      section_id  INTEGER NOT NULL REFERENCES categories(id),
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, section_id)
    );

    CREATE TABLE IF NOT EXISTS sub_categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id  INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      sort_order  INTEGER DEFAULT 0,
      UNIQUE(section_id, name)
    );
  `);
}

function initIndexes(db) {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_post ON likes(user_id, post_id) WHERE comment_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_likes_user_comment ON likes(user_id, comment_id) WHERE post_id IS NULL;
    CREATE INDEX IF NOT EXISTS idx_posts_author     ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_posts_category   ON posts(category_id);
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
    CREATE TABLE IF NOT EXISTS guestbook (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      board       TEXT NOT NULL DEFAULT 'general',
      content     TEXT NOT NULL,
      parent_id   INTEGER REFERENCES guestbook(id),
      ip          TEXT DEFAULT '',
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_name ON attachments(filename);
    CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, expires_at);
  `);

  // Migration: add is_private to categories if missing
  const cols = db.prepare("PRAGMA table_info(categories)").all().map(c => c.name);
  if (!cols.includes('is_private')) {
    db.exec('ALTER TABLE categories ADD COLUMN is_private INTEGER DEFAULT 0');
  }

  // Migration: add board to guestbook if missing
  const gbCols = db.prepare("PRAGMA table_info(guestbook)").all().map(c => c.name);
  if (gbCols.length > 0 && !gbCols.includes('board')) {
    db.exec("ALTER TABLE guestbook ADD COLUMN board TEXT NOT NULL DEFAULT 'general'");
  }
}

function initFTS(db) {
  db.exec(`
    DROP TABLE IF EXISTS posts_fts;
    CREATE VIRTUAL TABLE posts_fts
      USING fts5(title, content_md, content=posts, content_rowid=id,
                 tokenize='unicode61');
    INSERT INTO posts_fts(rowid, title, content_md) SELECT id, title, content_md FROM posts;
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS posts_fts_insert AFTER INSERT ON posts BEGIN
      INSERT INTO posts_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
    END;
    CREATE TRIGGER IF NOT EXISTS posts_fts_delete AFTER DELETE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, content_md) VALUES('delete', old.id, old.title, old.content_md);
    END;
    CREATE TRIGGER IF NOT EXISTS posts_fts_update AFTER UPDATE ON posts BEGIN
      INSERT INTO posts_fts(posts_fts, rowid, title, content_md) VALUES('delete', old.id, old.title, old.content_md);
      INSERT INTO posts_fts(rowid, title, content_md) VALUES (new.id, new.title, new.content_md);
    END;
  `);
}

function seedDefaults(db) {
  const bcrypt = require('bcryptjs');

  const owner = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!owner) {
    const hash = bcrypt.hashSync(config.OWNER_PASSWORD, 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, 128, ?)')
      .run(config.OWNER_NAME.toLowerCase(), hash, config.OWNER_NAME, config.OWNER_EMAIL);
  }

  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    const insert = db.prepare('INSERT INTO categories (name, description, sort_order) VALUES (?, ?, ?)');
    const cats = [
      ['综合讨论', '各类话题自由讨论', 1],
      ['技术交流', '编程与技术', 2],
      ['分享创造', '分享你的作品', 3],
      ['提问求助', '问答互助', 4],
      ['日常闲聊', '闲聊与日常', 5],
    ];
    for (const c of cats) insert.run(...c);
  }

  // Seed sub-categories for sections that have none
  const sections = db.prepare('SELECT id FROM categories').all();
  const insertSC = db.prepare('INSERT OR IGNORE INTO sub_categories (section_id, name, sort_order) VALUES (?,?,?)');
  const defaults = [];
  for (const s of sections) {
    const count = db.prepare('SELECT COUNT(*) as c FROM sub_categories WHERE section_id = ?').get(s.id);
    if (count.c === 0) {
      for (const d of defaults) insertSC.run(s.id, d[0], d[1]);
    }
  }
}

module.exports = { createConnection, initSchema, initIndexes, initFTS, seedDefaults };
