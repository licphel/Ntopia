// Notification data access.
const { getDB } = require('../database');

const notificationRepo = {
  /** Get notifications for a user. */
  listByUser(userId, limit = 50) {
    return getDB().prepare(`
      SELECT * FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?
    `).all(userId, limit);
  },

  /** Create a notification. */
  create(userId, type, content, link) {
    getDB().prepare(`
      INSERT INTO notifications (user_id, type, content, link) VALUES (?, ?, ?, ?)
    `).run(userId, type, content, link);
  },

  /** Mark all notifications as read for a user. */
  markAllRead(userId) {
    getDB().prepare(
      'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0'
    ).run(userId);
  },

  /** Get unread notification count. */
  unreadCount(userId) {
    return getDB().prepare(
      'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0'
    ).get(userId).c;
  },

  /** Delete all notifications for a user. */
  deleteAll(userId) {
    getDB().prepare('DELETE FROM notifications WHERE user_id = ?').run(userId);
  },
};

module.exports = notificationRepo;
