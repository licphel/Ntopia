// Message data access.
const { getDB } = require('../database');

const messageRepo = {
  /** Get inbox messages for a user. */
  inbox(userId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const msgs = getDB().prepare(`
      SELECT m.*, u.username, u.display_name, u.avatar, u.role, u.level
      FROM messages m JOIN users u ON m.from_id = u.id
      WHERE m.to_id = ? AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
      ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = getDB().prepare(
      'SELECT COUNT(*) as c FROM messages WHERE to_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
    ).get(userId);
    return { msgs, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Get sent messages for a user. */
  sent(userId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const sent = getDB().prepare(`
      SELECT m.*, u.username, u.display_name, u.role, u.level
      FROM messages m JOIN users u ON m.to_id = u.id
      WHERE m.from_id = ? AND (m.is_deleted = 0 OR m.is_deleted IS NULL)
      ORDER BY m.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = getDB().prepare(
      'SELECT COUNT(*) as c FROM messages WHERE from_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
    ).get(userId);
    return { sent, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Send a message. */
  send(fromId, toId, contentMd, contentHtml) {
    getDB().prepare(`
      INSERT INTO messages (from_id, to_id, content_md, content_html) VALUES (?, ?, ?, ?)
    `).run(fromId, toId, contentMd, contentHtml);
  },

  /** Mark all messages as read for a recipient. */
  markAllRead(userId) {
    getDB().prepare(
      'UPDATE messages SET is_read = 1 WHERE to_id = ? AND is_read = 0'
    ).run(userId);
  },

  /** Get unread message count. */
  unreadCount(userId) {
    return getDB().prepare(
      'SELECT COUNT(*) as c FROM messages WHERE to_id = ? AND is_read = 0'
    ).get(userId).c;
  },

  /** Soft-delete user's messages (for account deletion). */
  softDeleteUserMessages(userId) {
    getDB().prepare(`
      UPDATE messages SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP
      WHERE (from_id = ? OR to_id = ?) AND is_deleted = 0
    `).run(userId, userId);
  },
};

module.exports = messageRepo;
