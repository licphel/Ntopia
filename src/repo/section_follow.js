// Section follow data access.
const { getDB } = require('../database');

const sectionFollowRepo = {
  /** Toggle follow/unfollow. Returns { following: true/false }. */
  toggle(userId, sectionId) {
    const row = getDB().prepare(
      'SELECT 1 as x FROM section_follows WHERE user_id = ? AND section_id = ?'
    ).get(userId, sectionId);
    if (row) {
      getDB().prepare('DELETE FROM section_follows WHERE user_id = ? AND section_id = ?').run(userId, sectionId);
      return { following: false };
    }
    getDB().prepare('INSERT INTO section_follows (user_id, section_id) VALUES (?,?)').run(userId, sectionId);
    return { following: true };
  },

  /** Check if a user follows a section. */
  isFollowing(userId, sectionId) {
    return !!getDB().prepare(
      'SELECT 1 as x FROM section_follows WHERE user_id = ? AND section_id = ?'
    ).get(userId, sectionId);
  },

  /** Count followers for a section. */
  countFollowers(sectionId) {
    return getDB().prepare(
      'SELECT COUNT(*) as c FROM section_follows WHERE section_id = ?'
    ).get(sectionId)?.c || 0;
  },

  /** List sections followed by a user (with section info). */
  listByUser(userId, limit = 20) {
    return getDB().prepare(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM section_follows sf
      JOIN categories c ON sf.section_id = c.id
      LEFT JOIN posts p ON p.category_id = c.id AND p.is_deleted = 0 AND p.is_draft = 0
      WHERE sf.user_id = ?
      GROUP BY c.id ORDER BY c.sort_order LIMIT ?
    `).all(userId, limit);
  },

  /** List followers of a section (with user info). */
  listFollowers(sectionId, limit = 50) {
    return getDB().prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.level, sf.created_at
      FROM section_follows sf
      JOIN users u ON sf.user_id = u.id
      WHERE sf.section_id = ?
      ORDER BY sf.created_at DESC LIMIT ?
    `).all(sectionId, limit);
  },
};

module.exports = sectionFollowRepo;
