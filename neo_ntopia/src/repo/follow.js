// Follow data access.
const { getDB } = require('../database');

const followRepo = {
  /** Check if user A follows user B. */
  isFollowing(userId, targetId) {
    return !!getDB().prepare(
      'SELECT 1 FROM follows WHERE user_id = ? AND follow_id = ?'
    ).get(userId, targetId);
  },

  /** Toggle follow: returns { following }. */
  toggle(userId, targetId) {
    const db = getDB();
    const existing = this.isFollowing(userId, targetId);

    if (existing) {
      db.prepare('DELETE FROM follows WHERE user_id = ? AND follow_id = ?').run(userId, targetId);
      return { following: false };
    } else {
      db.prepare('INSERT INTO follows (user_id, follow_id) VALUES (?, ?)').run(userId, targetId);
      return { following: true };
    }
  },

  /** Get followers of a user. */
  followers(username, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const users = getDB().prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.bio, f.created_at as followed_at
      FROM follows f JOIN users u ON f.user_id = u.id
      WHERE f.follow_id = (SELECT id FROM users WHERE username = ?)
      ORDER BY f.created_at DESC LIMIT ? OFFSET ?
    `).all(username, limit, offset);
    const count = getDB().prepare(
      'SELECT COUNT(*) as c FROM follows WHERE follow_id = (SELECT id FROM users WHERE username = ?)'
    ).get(username);
    return { users, total: count.c, page, totalPages: Math.ceil(count.c / limit) };
  },

  /** Get users that a user follows. */
  following(username, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const users = getDB().prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.bio, f.created_at as followed_at
      FROM follows f JOIN users u ON f.follow_id = u.id
      WHERE f.user_id = (SELECT id FROM users WHERE username = ?)
      ORDER BY f.created_at DESC LIMIT ? OFFSET ?
    `).all(username, limit, offset);
    const count = getDB().prepare(
      'SELECT COUNT(*) as c FROM follows WHERE user_id = (SELECT id FROM users WHERE username = ?)'
    ).get(username);
    return { users, total: count.c, page, totalPages: Math.ceil(count.c / limit) };
  },

  /** Who among a list of IDs does the viewer follow. */
  followedSet(viewerId, targetIds) {
    if (!viewerId || !targetIds.length) return new Set();
    const rows = getDB().prepare(
      `SELECT follow_id FROM follows WHERE user_id = ? AND follow_id IN (${targetIds.map(() => '?').join(',')})`
    ).all(viewerId, ...targetIds);
    return new Set(rows.map(r => r.follow_id));
  },
};

module.exports = followRepo;
