// XP system data access — experience points, leveling, and daily limits.
const { getDB } = require('../database');
const time = require('../util/time');

const xpRepo = {
  /** Calculate XP required for a given level. */
  xpForLevel(level) {
    if (level <= 1) return 0;
    let total = 0, req = 5;
    for (let i = 2; i <= level; i++) {
      total += Math.round(req);
      req = Math.round(req * 1.5);
    }
    return total;
  },

  /** Award XP to a user. */
  award(userId, amount, reason, refId) {
    const db = getDB();
    db.prepare(
      'INSERT INTO xp_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)'
    ).run(userId, amount, reason, refId || null);
    db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);

    // Recalculate level
    const user = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
    let newLevel = user.level;
    while (user.xp >= this.xpForLevel(newLevel + 1)) newLevel++;
    if (newLevel !== user.level) {
      db.prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, userId);
    }
  },

  /** Get refreshed user XP/level. */
  getRefreshed(userId) {
    return getDB().prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
  },

  /** Check daily limit for a reason. */
  checkDailyLimit(userId, reason, maxPerDay) {
    const today = time.today();
    const row = getDB().prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM xp_log
      WHERE user_id = ? AND reason = ? AND date(created_at) = ?
    `).get(userId, reason, today);
    return row.total < maxPerDay;
  },
};

module.exports = xpRepo;
