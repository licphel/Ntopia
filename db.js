const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'ntopia.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDB() {
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
    ['users', 'banned', 'INTEGER DEFAULT 0'],
    ['users', 'role', 'INTEGER DEFAULT 1'],
    ['posts', 'is_deleted', 'INTEGER DEFAULT 0'],
  ]) {
    try { db.exec(`ALTER TABLE ${col[0]} ADD COLUMN ${col[1]} ${col[2]}`); } catch(e) {}
  }
  
  try { db.exec(`CREATE TABLE IF NOT EXISTS xp_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log(user_id)`); } catch(e) {}

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

  try { db.exec(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    link TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read)`); } catch(e) {}

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

// XP & Level helpers
function xpForLevel(level) {
  // LV1→LV2: 5, each subsequent: ×1.5
  if (level <= 1) return 0;
  let total = 0, req = 5;
  for (let i = 2; i <= level; i++) {
    total += Math.round(req);
    req = Math.round(req * 1.5);
  }
  return total;
}

function addXP(userId, amount, reason, refId) {
  db.prepare('INSERT INTO xp_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)').run(userId, amount, reason, refId || null);
  db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
  const user = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
  let newLevel = user.level;
  while (user.xp >= xpForLevel(newLevel + 1)) newLevel++;
  if (newLevel !== user.level) {
    db.prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, userId);
  }
}

const LEVEL = { GUEST: 0, USER: 1, MOD: 16, ADMIN: 32, SUPER: 64, OWNER: 128 };

function roleBadge(role) {
  if (role >= LEVEL.OWNER) return { text: 'Owner', bg: '#f3e5f5', color: '#8e44ad' };
  if (role >= LEVEL.SUPER) return { text: 'Super', bg: '#fce4e4', color: '#c0392b' };
  if (role >= LEVEL.ADMIN) return { text: 'Admin', bg: '#fef5e7', color: '#e67e22' };
  if (role >= LEVEL.MOD)   return { text: 'Mod',   bg: '#eaf0f8', color: '#2b7cbe' };
  return { text: 'User', bg: '#ecf0f1', color: '#7f8c8d' };
}

module.exports = { db, initDB, addXP, xpForLevel, LEVEL, roleBadge };



