const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const coreDb = new Database(path.join(DATA_DIR, 'core.db'));
coreDb.pragma('journal_mode = WAL');
coreDb.pragma('foreign_keys = ON');
// Checkpoint on startup to flush any WAL backlog into the main DB
coreDb.pragma('wal_checkpoint(RESTART)');

const volatileDb = new Database(path.join(DATA_DIR, 'volatile.db'));
volatileDb.pragma('journal_mode = WAL');
volatileDb.pragma('foreign_keys = ON');
volatileDb.pragma('wal_checkpoint(RESTART)');

const VOLATILE_TABLES = ['checkins', 'xp_log', 'likes', 'notifications'];

// Proxy: auto-routes queries to core or volatile based on table name
const db = new Proxy(coreDb, {
  get(target, prop) {
    if (prop === 'prepare') {
      return function(sql) {
        const lower = sql.toLowerCase();
        const isVolatile = VOLATILE_TABLES.some(t => lower.includes(t));
        return (isVolatile ? volatileDb : coreDb).prepare(sql);
      };
    }
    if (prop === 'exec') {
      return function(sql) {
        coreDb.exec(sql);
        volatileDb.exec(sql);
      };
    }
    const val = target[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  }
});

function initDB() {
  // Core tables
  coreDb.exec(`
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      type TEXT DEFAULT 'forum',
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
      type TEXT DEFAULT 'post',
      forum_category TEXT DEFAULT '',
      is_pinned INTEGER DEFAULT 0,
      is_deleted INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      content_md TEXT NOT NULL,
      content_html TEXT NOT NULL,
      parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_posts_type ON posts(type);
    CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
    CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id);
    CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
    CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(author_id);
  `);

  // Volatile tables
  volatileDb.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      checkin_date DATE NOT NULL DEFAULT (date('now')),
      xp_earned INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, checkin_date)
    );

    CREATE TABLE IF NOT EXISTS xp_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, checkin_date);
    CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id);
  `);

  // Migration: add columns that might not exist from older schema
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
    ['posts', 'deleted_at', 'DATETIME'],
    ['comments', 'is_deleted', 'INTEGER DEFAULT 0'],
    ['comments', 'deleted_at', 'DATETIME'],
    ['posts', 'is_draft', 'INTEGER DEFAULT 0'],
    ['posts', 'is_deleted', 'INTEGER DEFAULT 0'],
  ]) {
    try { db.exec(`ALTER TABLE ${col[0]} ADD COLUMN ${col[1]} ${col[2]}`); } catch(e) {}
  }
  

  // Messages & Notifications (new tables)
  try { db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id INTEGER NOT NULL REFERENCES users(id),
    to_id INTEGER NOT NULL REFERENCES users(id),
    content_md TEXT NOT NULL,
    content_html TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_id, is_read)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_id)`); } catch(e) {}

  volatileDb.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    link TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  volatileDb.exec(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)`);

  // Likes (volatile) & Bookmarks (core)
  volatileDb.exec(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER,
    comment_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id, comment_id)
  )`);
  coreDb.exec(`CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    post_id INTEGER NOT NULL REFERENCES posts(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, post_id)
  )`);

  // Post revision history
  coreDb.exec(`CREATE TABLE IF NOT EXISTS post_revisions (
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
  coreDb.exec('CREATE INDEX IF NOT EXISTS idx_revisions_post ON post_revisions(post_id)');

  // Cleanup posts soft-deleted over 60 days ago (core)
  coreDb.prepare("DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days'))").run();
  coreDb.prepare("DELETE FROM comments WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days')").run();
  coreDb.prepare("DELETE FROM posts WHERE is_deleted = 1 AND deleted_at < datetime('now', '-60 days')").run();

  // Create owner from .env if not exists
  const bcrypt = require('bcryptjs');
  const ownerName = process.env.OWNER_NAME || 'admin';
  const owner = db.prepare('SELECT id FROM users WHERE id = 1').get();
  if (!owner) {
    const hash = bcrypt.hashSync(process.env.OWNER_PASSWORD || 'admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, 128, ?)')
      .run(ownerName.toLowerCase(), hash, ownerName, process.env.OWNER_EMAIL || '');
  }

  // Insert default categories if none
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c === 0) {
    const cats = [
      ['杂谈', 'misc', '杂谈', 'forum', 1],
      ['计算机', 'computer', '计算机', 'forum', 2],
      ['自然', 'nature', '自然', 'forum', 3],
      ['数学', 'math', '数学', 'forum', 4],
      ['杂谈', 'blog-misc', '杂谈', 'blog', 1],
      ['计算机', 'blog-computer', '计算机', 'blog', 2],
      ['自然', 'blog-nature', '自然', 'blog', 3],
      ['数学', 'blog-math', '数学', 'blog', 4],
    ];
    const insert = db.prepare('INSERT OR IGNORE INTO categories (name, slug, description, type, sort_order) VALUES (?, ?, ?, ?, ?)');
    for (const c of cats) insert.run(...c);
  }
}

// Periodic WAL checkpoint — TRUNCATE blocks briefly but guarantees the WAL
// is flushed and the file truncated to 0 bytes. PASSIVE would silently skip
// under concurrent reads, causing unbounded WAL growth on a live server.
const walInterval = setInterval(() => {
  coreDb.pragma('wal_checkpoint(TRUNCATE)');
  volatileDb.pragma('wal_checkpoint(TRUNCATE)');
}, 30 * 60 * 1000);
walInterval.unref(); // don't keep the process alive just for this timer

// Graceful shutdown: flush WAL and close databases so PM2 / Docker restarts
// never leave stale WAL backlog behind
function shutdownDB() {
  console.log('[db] Checkpointing WAL before shutdown...');
  coreDb.pragma('wal_checkpoint(RESTART)');
  volatileDb.pragma('wal_checkpoint(RESTART)');
  coreDb.close();
  volatileDb.close();
  console.log('[db] Databases closed. Exiting.');
  process.exit(0);
}
process.once('SIGINT', shutdownDB);
process.once('SIGTERM', shutdownDB);

// XP & Level helpers (in lib/xp.js)
const xpLib = require('./lib/xp');
const xpForLevel = xpLib.xpForLevel;
const awardPostXP = (uid, pid) => xpLib.awardPostXP(db, uid, pid);
const awardForumXP = (uid, pid) => xpLib.awardForumXP(db, uid, pid);
const awardCommentXP = (uid, cid) => xpLib.awardCommentXP(db, uid, cid);
const awardCheckinXP = (uid, amt) => xpLib.awardCheckinXP(db, uid, amt);
const awardLikeReceivedXP = (uid, pid) => xpLib.awardLikeReceivedXP(db, uid, pid);
const awardBookmarkReceivedXP = (uid, pid) => xpLib.awardBookmarkReceivedXP(db, uid, pid);

const LEVEL = { GUEST: 0, USER: 1, MOD: 16, ADMIN: 32, SUPER: 64, OWNER: 128 };

function roleBadge(role) {
  if (role >= LEVEL.OWNER) return { text: 'Owner', bg: '#f3e5f5', color: '#8e44ad' };
  if (role >= LEVEL.SUPER) return { text: 'Super', bg: '#fce4e4', color: '#c0392b' };
  if (role >= LEVEL.ADMIN) return { text: 'Admin', bg: '#fef5e7', color: '#e67e22' };
  if (role >= LEVEL.MOD)   return { text: 'Mod',   bg: '#eaf0f8', color: '#2b7cbe' };
  return { text: 'User', bg: '#ecf0f1', color: '#7f8c8d' };
}

module.exports = { db, initDB, xpForLevel, LEVEL, roleBadge, awardPostXP, awardForumXP, awardCommentXP, awardCheckinXP, awardLikeReceivedXP, awardBookmarkReceivedXP };



