// Section sub-moderator data access.
const { getDB } = require('../database');

const sectionSubModRepo = {
  /** Add a sub-moderator. */
  add(sectionId, userId) {
    getDB().prepare(
      'INSERT OR IGNORE INTO section_sub_mods (section_id, user_id) VALUES (?,?)'
    ).run(sectionId, userId);
  },

  /** Remove a sub-moderator. */
  remove(sectionId, userId) {
    getDB().prepare(
      'DELETE FROM section_sub_mods WHERE section_id = ? AND user_id = ?'
    ).run(sectionId, userId);
  },

  /** Check if a user is a sub-moderator of a section. */
  isSubMod(sectionId, userId) {
    return !!getDB().prepare(
      'SELECT 1 as x FROM section_sub_mods WHERE section_id = ? AND user_id = ?'
    ).get(sectionId, userId);
  },

  /** List all sub-moderators for a section (with user info). */
  listBySection(sectionId) {
    return getDB().prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, u.role, u.level, ssm.created_at
      FROM section_sub_mods ssm JOIN users u ON ssm.user_id = u.id
      WHERE ssm.section_id = ? ORDER BY ssm.created_at
    `).all(sectionId);
  },
};

module.exports = sectionSubModRepo;
