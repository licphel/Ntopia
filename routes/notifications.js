const express = require('express');
const { db } = require('../db');
const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// View all notifications
router.get('/', requireLogin, (req, res) => {
  const notifs = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(req.session.user.id);

  // Mark all as read
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(req.session.user.id);

  // Clear badge count
  req.session.unreadNotifs = 0;
  if (req.session.user) req.session.user.unreadNotifs = 0;

  res.render('notifications', { title: '消息通知', notifs });
});

module.exports = router;
