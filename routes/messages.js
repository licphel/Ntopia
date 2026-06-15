const express = require('express');
const { renderMarkdown } = require('../lib/helpers');
const { db } = require('../lib/db');
const router = express.Router();

// Require login
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// Inbox
router.get('/', requireLogin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  const msgs = db.prepare(`
    SELECT m.*, u.username, u.display_name, u.avatar
    FROM messages m JOIN users u ON m.from_id = u.id
    WHERE m.to_id = ? AND (m.is_deleted = 0 OR m.is_deleted IS NULL) ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(req.session.user.id, limit, offset);

  const msgTotal = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(req.session.user.id);

  const sPage = parseInt(req.query.sp) || 1;
  const sOffset = (sPage - 1) * limit;
  const sent = db.prepare(`
    SELECT m.*, u.username, u.display_name
    FROM messages m JOIN users u ON m.to_id = u.id
    WHERE m.from_id = ? AND (m.is_deleted = 0 OR m.is_deleted IS NULL) ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(req.session.user.id, limit, sOffset);
  const sentTotal = db.prepare('SELECT COUNT(*) as c FROM messages WHERE from_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(req.session.user.id);

  // Mark all as read
  db.prepare('UPDATE messages SET is_read = 1 WHERE to_id = ? AND is_read = 0').run(req.session.user.id);

  res.render('messages', {
    title: '私信', msgs, sent,
    msgPage: page, msgTotalPages: Math.ceil(msgTotal.c / limit),
    sentPage: sPage, sentTotalPages: Math.ceil(sentTotal.c / limit),
  });
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
  const toUser = db.prepare('SELECT id, username, display_name FROM users WHERE username = ?').get((to_username || '').toLowerCase());
  if (!toUser) {
    return res.render('send-message', { title: '发送私信', toUser: null, error: '用户不存在' });
  }
  if (toUser.id === req.session.user.id) {
    return res.render('send-message', { title: '发送私信', toUser, error: '不能给自己发私信' });
  }
  const html = renderMarkdown(content || '');
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
