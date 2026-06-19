const express = require('express');
const { db, awardBookmarkReceivedXP } = require('../lib/db');
const { requireLogin, requireLoginAPI } = require('../lib/middleware');
const router = express.Router();

// Toggle bookmark
router.post('/toggle', requireLoginAPI, (req, res) => {
  const { post_id } = req.body;
  const uid = req.session.user.id;
  const existing = db.prepare('SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?').get(uid, post_id);
  if (existing) {
    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)').run(uid, post_id);
    const post = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(post_id);
    if (post && post.author_id !== uid) awardBookmarkReceivedXP(post.author_id, post_id);
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE post_id = ?').get(post_id);
  res.json({ ok: true, bookmarked: !existing, count: count.c });
});

// View user's bookmarks
router.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const posts = db.prepare(`
    SELECT p.*, u.username, u.display_name, b.created_at as bookmarked_at
    FROM bookmarks b JOIN posts p ON b.post_id = p.id JOIN users u ON p.author_id = u.id
    WHERE b.user_id = ? AND p.is_deleted = 0 ORDER BY b.created_at DESC LIMIT ? OFFSET ?
  `).all(req.session.user.id, limit, (page - 1) * limit);
  const total = db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ?').get(req.session.user.id);
  res.render('bookmarks', { title: '收藏', posts, bmPage: page, bmTotalPages: Math.ceil(total.c / limit) });
});

module.exports = router;
