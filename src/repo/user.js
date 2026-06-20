// User data access — all user-related queries in one place.
const { getDB } = require('../database');

const userRepo = {
  /** List users with pagination. */
  list({ page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;
    const total = getDB().prepare('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NULL').get();
    const users = getDB().prepare(`
      SELECT id, username, display_name, role, email, created_at, deleted_at
      FROM users WHERE deleted_at IS NULL ORDER BY id LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { users, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Find user by ID (returns full row). */
  findById(id) {
    return getDB().prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  /** Find user by username (case-insensitive). */
  findByUsername(username) {
    return getDB().prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  },

  /** Find user by email. */
  findByEmail(email) {
    return getDB().prepare('SELECT id FROM users WHERE email = ?').get(email);
  },

  /** Check if username is taken (optionally excluding a user ID). */
  usernameExists(username, excludeId) {
    const row = getDB().prepare(
      'SELECT id FROM users WHERE username = ? AND id != ?'
    ).get(username.toLowerCase(), excludeId || 0);
    return !!row;
  },

  /** Create a new user. Returns the new user's ID. */
  create({ username, passwordHash, displayName, email }) {
    const info = getDB().prepare(`
      INSERT INTO users (username, password_hash, display_name, role, avatar, email)
      VALUES (?, ?, ?, 1, '/img/default-avatar.png', ?)
    `).run(username.toLowerCase(), passwordHash, displayName || username, email || '');
    return info.lastInsertRowid;
  },

  /** Update user profile fields. */
  updateProfile(id, { displayName, bio, desc }) {
    getDB().prepare(`
      UPDATE users SET display_name = ?, bio = ?, desc = ? WHERE id = ?
    `).run(displayName, (bio || '').slice(0, 64), desc || '', id);
  },

  /** Update username. */
  updateUsername(id, username) {
    getDB().prepare('UPDATE users SET username = ? WHERE id = ?').run(username.toLowerCase(), id);
  },

  /** Update password hash. */
  updatePassword(id, hash) {
    getDB().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  },

  /** Update avatar URL. */
  updateAvatar(id, url) {
    getDB().prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, id);
  },

  /** Bind/update email. */
  updateEmail(id, email) {
    getDB().prepare('UPDATE users SET email = ? WHERE id = ?').run(email, id);
  },

  /** Update role. */
  updateRole(id, role) {
    getDB().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  },

  /** Ban a user. */
  ban(id, until) {
    getDB().prepare('UPDATE users SET banned = 1, banned_until = ? WHERE id = ?').run(until || null, id);
  },

  /** Unban a user. */
  unban(id) {
    getDB().prepare('UPDATE users SET banned = 0, banned_until = NULL WHERE id = ?').run(id);
  },

  /** Soft-delete a user (scramble password, mark deleted). */
  softDelete(id, scrambledHash) {
    getDB().prepare(`
      UPDATE users SET banned = 1, deleted_at = CURRENT_TIMESTAMP, password_hash = ? WHERE id = ?
    `).run(scrambledHash, id);
  },

  /** Refresh a user's session data from DB. */
  refreshSession(id) {
    return getDB().prepare(`
      SELECT id, xp, level, banned, banned_until, deleted_at, display_name, avatar, role, email
      FROM users WHERE id = ?
    `).get(id);
  },

  /** Recalculate and persist level from XP. */
  recalcLevel(id, newLevel) {
    getDB().prepare('UPDATE users SET level = ? WHERE id = ?').run(newLevel, id);
  },

  /** Get check-in streak info. */
  checkinStreak(id, yesterdayStr) {
    return {
      yesterday: getDB().prepare(
        'SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?'
      ).get(id, yesterdayStr),
      stats: getDB().prepare(
        'SELECT consecutive_days FROM users WHERE id = ?'
      ).get(id),
    };
  },

  /** Record a check-in and update streak. */
  doCheckin(id, todayStr, xpEarned, streak) {
    getDB().prepare(
      'INSERT INTO checkins (user_id, checkin_date, xp_earned) VALUES (?, ?, ?)'
    ).run(id, todayStr, xpEarned);
    getDB().prepare(
      'UPDATE users SET consecutive_days = ?, last_checkin = ? WHERE id = ?'
    ).run(streak, todayStr, id);
  },

  /** Get check-in count for a user. */
  checkinCount(id) {
    return getDB().prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(id);
  },

  /** Check if user checked in today. */
  checkedInToday(id, todayStr) {
    return !!getDB().prepare(
      'SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?'
    ).get(id, todayStr);
  },

  /** Get follower/following counts. */
  followCounts(id) {
    const followers = getDB().prepare(
      'SELECT COUNT(*) as c FROM follows WHERE follow_id = ?'
    ).get(id);
    const following = getDB().prepare(
      'SELECT COUNT(*) as c FROM follows WHERE user_id = ?'
    ).get(id);
    return { followers: followers.c, following: following.c };
  },

  /** Get last login IP (owner-only). */
  lastLogin(id) {
    return getDB().prepare(
      'SELECT ip, created_at FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(id);
  },

  /** Search users by name/bio. */
  search(query, limit = 10) {
    const like = `%${query}%`;
    return getDB().prepare(`
      SELECT u.*, (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
      FROM users u
      WHERE u.username LIKE ? OR u.display_name LIKE ? OR u.bio LIKE ?
      ORDER BY post_count DESC LIMIT ?
    `).all(like, like, like, limit);
  },

  /** Ban a user until a given time. */
  ban(id, until) {
    getDB().prepare('UPDATE users SET banned = 1, banned_until = ? WHERE id = ?').run(until, id);
  },

  /** Record login. */
  logLogin(userId, ip, userAgent) {
    getDB().prepare(
      'INSERT INTO login_logs (user_id, ip, user_agent) VALUES (?, ?, ?)'
    ).run(userId, ip || '', (userAgent || '').slice(0, 500));
  },
};

module.exports = userRepo;
