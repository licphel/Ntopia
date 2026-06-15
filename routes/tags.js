const express = require('express');
const { db } = require('../lib/db');
const router = express.Router();

router.get('/:tag', (req, res) => {
  const tag = req.params.tag;
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  const posts = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.is_deleted = 0 AND p.is_draft = 0
      AND (',' || p.tags || ',') LIKE ?
    ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?
  `).all('%,' + tag + ',%', limit, offset);

  const count = db.prepare(`
    SELECT COUNT(*) as c FROM posts
    WHERE is_deleted = 0 AND is_draft = 0
      AND (',' || tags || ',') LIKE ?
  `).get('%,' + tag + ',%');

  const totalPages = Math.ceil(count.c / limit);
  res.render('tags', { title: '#' + tag, tag, posts, page, totalPages });
});

module.exports = router;
