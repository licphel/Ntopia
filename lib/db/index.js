// Unified DB module — single SQLite database
const core = require('./core');

const { db } = core;

function initDB() {
  core.init();

  // Periodic WAL checkpoint
  const interval = setInterval(() => {
    try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (_) {}
  }, 30 * 60 * 1000);
  interval.unref();

  // Graceful shutdown
  function shutdown() {
    console.log('[db] Checkpointing before shutdown...');
    try { db.pragma('wal_checkpoint(RESTART)'); } catch (_) {}
    db.close();
    console.log('[db] Closed. Exiting.');
    process.exit(0);
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// Level & badge system
const LEVEL = { GUEST: 0, USER: 1, MOD: 16, ADMIN: 32, SUPER: 64, OWNER: 128 };

function roleBadge(role) {
  if (role >= LEVEL.OWNER) return { text: 'Owner', bg: '#f3e5f5', color: '#8e44ad' };
  if (role >= LEVEL.SUPER) return { text: 'Super', bg: '#fce4e4', color: '#c0392b' };
  if (role >= LEVEL.ADMIN) return { text: 'Admin', bg: '#fef5e7', color: '#e67e22' };
  if (role >= LEVEL.MOD)   return { text: 'Mod',   bg: '#eaf0f8', color: '#2b7cbe' };
  return { text: 'User', bg: '#ecf0f1', color: '#7f8c8d' };
}

// XP helpers
const xpLib = require('../xp');
const xpForLevel = xpLib.xpForLevel;
const awardPostXP = (uid, pid) => xpLib.awardPostXP(db, uid, pid);
const awardCommentXP = (uid, cid) => xpLib.awardCommentXP(db, uid, cid);
const awardCheckinXP = (uid, amt) => xpLib.awardCheckinXP(db, uid, amt);
const awardLikeReceivedXP = (uid, pid) => xpLib.awardLikeReceivedXP(db, uid, pid);
const awardBookmarkReceivedXP = (uid, pid) => xpLib.awardBookmarkReceivedXP(db, uid, pid);

module.exports = {
  db, initDB,
  LEVEL, roleBadge, xpForLevel,
  awardPostXP, awardCommentXP, awardCheckinXP,
  awardLikeReceivedXP, awardBookmarkReceivedXP,
};
