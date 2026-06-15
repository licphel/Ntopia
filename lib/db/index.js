// Unified DB module — proxies queries to the correct database file
const core = require('./core');
const volatile = require('./volatile');
const social = require('./social');

const ROUTING = {
  // core.db
  users: core.db, posts: core.db, comments: core.db, categories: core.db, post_revisions: core.db,
  // volatile.db
  notifications: volatile.db, checkins: volatile.db, xp_log: volatile.db, likes: volatile.db,
  // social.db
  messages: social.db, bookmarks: social.db,
};

// Proxy: auto-routes .prepare() and .exec() to the correct DB based on SQL content
const db = new Proxy(core.db, {
  get(target, prop) {
    if (prop === 'prepare') {
      return function(sql) {
        const lower = sql.toLowerCase();
        for (const [table, instance] of Object.entries(ROUTING)) {
          if (lower.includes(table)) return instance.prepare(sql);
        }
        return target.prepare(sql);
      };
    }
    if (prop === 'exec') {
      return function(sql) {
        const lower = sql.toLowerCase();
        for (const [table, instance] of Object.entries(ROUTING)) {
          if (lower.includes(table)) { instance.exec(sql); return; }
        }
        target.exec(sql);
      };
    }
    const val = target[prop];
    return typeof val === 'function' ? val.bind(target) : val;
  }
});

function initDB() {
  core.init();
  volatile.init();
  social.init();

  // Periodic WAL checkpoint
  const interval = setInterval(() => {
    core.db.pragma('wal_checkpoint(PASSIVE)');
    volatile.db.pragma('wal_checkpoint(PASSIVE)');
    social.db.pragma('wal_checkpoint(PASSIVE)');
  }, 30 * 60 * 1000);
  interval.unref();

  // Graceful shutdown
  function shutdown() {
    console.log('[db] Checkpointing before shutdown...');
    core.db.pragma('wal_checkpoint(RESTART)');
    volatile.db.pragma('wal_checkpoint(RESTART)');
    social.db.pragma('wal_checkpoint(RESTART)');
    core.db.close();
    volatile.db.close();
    social.db.close();
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

// XP helpers — delegated to lib/xp.js
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
