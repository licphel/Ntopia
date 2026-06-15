function xpForLevel(level) {
  if (level <= 1) return 0;
  let total = 0, req = 5;
  for (let i = 2; i <= level; i++) { total += Math.round(req); req = Math.round(req * 1.5); }
  return total;
}

function _addXP(db, userId, amount, reason, refId) {
  db.prepare('INSERT INTO xp_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)').run(userId, amount, reason, refId || null);
  db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(amount, userId);
  const user = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(userId);
  let newLevel = user.level;
  while (user.xp >= xpForLevel(newLevel + 1)) newLevel++;
  if (newLevel !== user.level) db.prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, userId);
}

const { today: netToday } = require('./time');

// Daily limit helper: max `limit` XP per day from `reason`
function _dailyLimit(db, userId, reason, limit) {
  const today = netToday();
  const row = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM xp_log WHERE user_id = ? AND reason = ? AND date(created_at) = ?").get(userId, reason, today);
  return row.total < limit;
}

// Public XP award functions with daily limits
function awardPostXP(db, userId, postId) { _addXP(db, userId, 3, '发布文章', postId); }
function awardCommentXP(db, userId, commentId) {
  if (_dailyLimit(db, userId, '评论', 10)) _addXP(db, userId, 1, '评论', commentId);
}
function awardCheckinXP(db, userId, amount) { _addXP(db, userId, amount, '签到', null); }

function awardLikeReceivedXP(db, userId, postId) {
  if (_dailyLimit(db, userId, '被点赞', 5)) _addXP(db, userId, 1, '被点赞', postId);
}
function awardBookmarkReceivedXP(db, userId, postId) {
  if (_dailyLimit(db, userId, '被收藏', 3)) _addXP(db, userId, 2, '被收藏', postId);
}

module.exports = { xpForLevel, _addXP, awardPostXP, awardCommentXP, awardCheckinXP, awardLikeReceivedXP, awardBookmarkReceivedXP };
