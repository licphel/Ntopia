const express = require('express');
const { marked } = require('marked');
const { db } = require('../db');
const router = express.Router();

// Require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// Inbox
router.get('/', requireLogin, (req, res) => {
  const msgs = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM messages m JOIN users u ON m.from_id = u.id
    WHERE m.to_id = ? ORDER BY m.created_at DESC LIMIT 50
  `).all(req.session.user.id);

  const sent = db.prepare(`
    SELECT m.*, u.username, u.display_name
    FROM messages m JOIN users u ON m.to_id = u.id
    WHERE m.from_id = ? ORDER BY m.created_at DESC LIMIT 20
  `).all(req.session.user.id);

  // Mark all as read
  db.prepare('UPDATE messages SET is_read = 1 WHERE to_id = ? AND is_read = 0').run(req.session.user.id);

  res.render('messages', { title: '私信', msgs, sent });
});

// Send message page
router.get('/send/:username?', requireLogin, (req, res) => {
  const toUser = req.params.username
    ? db.prepare('SELECT username, display_name FROM users WHERE username = ?').get(req.params.username)
    : null;
  res.render('send-message', { title: '发送私信', toUser, error: null });
});

// Send message POST
router.post('/send', requireLogin, (req, res) => {
  const { to_username, content } = req.body;
  const toUser = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get(to_username);
  if (!toUser) {
    return res.render('send-message', { title: '发送私信', toUser: null, error: '用户不存在' });
  }
  if (toUser.id === req.session.user.id) {
    return res.render('send-message', { title: '发送私信', toUser, error: '不能给自己发私信' });
  }
  const html = marked.parse(content || '');
  db.prepare('INSERT INTO messages (from_id, to_id, content_md, content_html) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, toUser.id, content, html);

  // Create notification for recipient
  db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'message', ?, ?)`)
    .run(toUser.id,
      `${req.session.user.display_name || req.session.user.username} 给你发了一条私信`,
      '/messages');

  res.redirect('/messages');
});

module.exports = router;
