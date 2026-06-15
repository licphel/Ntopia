const express = require('express');
const { db } = require('../lib/db');
const router = express.Router();

// Search results page
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'all'; // all, posts, users

  // #tag: syntax — redirect to tag page
  if (q.startsWith('#tag:') || q.startsWith('#t:')) {
    const tag = q.replace(/^#(tag|t):/, '').trim();
    if (tag) return res.redirect('/tags/' + encodeURIComponent(tag));
  }
  // Bare #tag — also redirect to tag page
  if (q.startsWith('#') && !q.includes(' ')) {
    return res.redirect('/tags/' + encodeURIComponent(q.slice(1)));
  }

  let postResults = [], userResults = [];

  if (q) {
    const like = `%${q}%`;

    if (type === 'all' || type === 'posts') {
      postResults = db.prepare(`
        SELECT p.*, u.username, u.display_name,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts p JOIN users u ON p.author_id = u.id
        WHERE p.is_deleted = 0 AND (p.title LIKE ? OR p.content_md LIKE ? OR p.tags LIKE ?)
        ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 20
      `).all(like, like, like);
    }

    if (type === 'all' || type === 'users') {
      userResults = db.prepare(`
        SELECT u.*, (SELECT COUNT(*) FROM posts WHERE author_id = u.id) as post_count
        FROM users u
        WHERE u.username LIKE ? OR u.display_name LIKE ? OR u.bio LIKE ?
        ORDER BY post_count DESC LIMIT 20
      `).all(like, like, like);
    }
  }

  res.render('search', {
    title: q ? `搜索: ${q}` : '搜索',
    query: q,
    type,
    postResults,
    userResults,
  });
});

module.exports = router;
