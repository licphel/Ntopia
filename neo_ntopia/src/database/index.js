// Database connection lifecycle — initialize, cleanup, graceful shutdown.
const { createConnection, initSchema, initIndexes, initFTS, runMigrations, seedDefaults } = require('./schema');
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
  runMigrations(db);
  seedDefaults(db);

  if (migrateOnly) return;

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
    DELETE FROM comments WHERE post_id IN (
      SELECT id FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}'
    );
    DELETE FROM comments WHERE is_deleted = 1 AND deleted_at < '${past}';
    DELETE FROM posts WHERE is_deleted = 1 AND deleted_at < '${past}';
    DELETE FROM email_codes WHERE expires_at < '${now}';
    DELETE FROM likes WHERE user_id IN (
      SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'
    );
    DELETE FROM bookmarks WHERE user_id IN (
      SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}'
    );
    DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < '${past}';
    DELETE FROM messages WHERE is_deleted = 1 AND deleted_at < '${past}';
    DELETE FROM login_logs WHERE created_at < '${past}';
    DELETE FROM site_views WHERE created_at < date('now', '-90 days');
  `);
}

module.exports = { initDB, getDB, runCleanup };
