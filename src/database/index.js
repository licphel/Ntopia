// Database connection lifecycle — initialize, cleanup, graceful shutdown.
const { createConnection, initSchema, initIndexes, initFTS, seedDefaults } = require('./schema');
const config = require('../config');
const time = require('../util/time');

/** @type {import('better-sqlite3').Database} */
let db = null;

function initDB(opts) {
  const migrateOnly = !!(opts && opts.migrateOnly);

  db = createConnection();
  initSchema(db);
  initIndexes(db);
  initFTS(db);
  seedDefaults(db);

  // Periodic WAL checkpoint (every 30 min)
  setInterval(() => {
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) { }
  }, 30 * 60 * 1000).unref();

  // Data retention cleanup (every 10 min)
  setInterval(() => {
    try { runCleanup(); } catch (_) { }
  }, 10 * 60 * 1000).unref();

  // Graceful shutdown
  const shutdown = () => {
    console.log('[db] Checkpointing before shutdown...');
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (_) { }
    db.close();
    console.log('[db] Closed. Exiting.');
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function getDB() {
  if (!db) throw new Error('Database not initialized. Call initDB() first.');
  return db;
}

function runCleanup() {
  const RET = config.RETENTION;
  const now = time.toSQL();
  const past = time.sqlFromNow('-' + RET);

  db.exec(`
    -- Posts past retention → cascade likes, bookmarks, reports
    DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}');
    DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}');
    DELETE FROM reports WHERE type = 'post' AND target_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}');

    -- Comments under deleted posts
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}'));
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}'));
    DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}');

    -- Deleted comments + their nested children (recursive via parent_id chain)
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE is_deleted = 1 AND deleted_at < '${past}');
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE is_deleted = 1 AND deleted_at < '${past}');
    DELETE FROM comments WHERE parent_id IN (SELECT id FROM comments WHERE is_deleted = 1 AND deleted_at < '${past}');
    DELETE FROM comments WHERE is_deleted = 1 AND deleted_at < '${past}';

    -- Deleted posts themselves
    DELETE FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}';

    -- Expired email codes
    DELETE FROM email_codes WHERE expires_at < '${now}';

    -- Deleted users → cascade likes/bookmarks/reports on their content
    DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    DELETE FROM reports WHERE type = 'post' AND target_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    -- Their comments (children first, then parent)
    DELETE FROM comments WHERE parent_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    DELETE FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    -- Comments under their posts (from other users too)
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}')));
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}')));
    DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'));
    -- Their posts
    DELETE FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    -- Their likes/bookmarks
    DELETE FROM likes WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM bookmarks WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    -- Social graph
    DELETE FROM follows WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}') OR follow_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM xp_log WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM checkins WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM messages WHERE from_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}') OR to_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM section_sub_mods WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM section_follows WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM reports WHERE reporter_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM login_logs WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM attachments WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}');
    DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}';

    -- Old messages
    DELETE FROM messages WHERE is_deleted = 1 AND deleted_at < '${past}';

    -- Old logs and views
    DELETE FROM login_logs WHERE created_at < '${past}';
    DELETE FROM site_views WHERE created_at < date('now', '-90 days');
  `);
}

module.exports = { initDB, getDB, runCleanup };
