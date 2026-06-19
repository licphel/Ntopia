// Notification service — read, mark, and manage user notifications.
const { notificationRepo } = require('../repo');

const notificationService = {
  /** Get notifications for a user and mark all as read. */
  getAndMarkRead(userId, limit = 50) {
    const notifs = notificationRepo.listByUser(userId, limit);
    notificationRepo.markAllRead(userId);
    return notifs;
  },

  /** Get unread counts for messages and notifications. */
  getUnreadCounts(userId) {
    const { messageRepo } = require('../repo');
    return {
      notifs: notificationRepo.unreadCount(userId),
      messages: messageRepo.unreadCount(userId),
    };
  },
};

module.exports = notificationService;
