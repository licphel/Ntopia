const express = require('express');
const { db } = require('../db');
const router = express.Router();

// Search results page
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  const type = req.query.type || 'all'; // all, posts, forum, users

  let postResults = [], forumResults = [], userResults = [];

  if (q) {
    const like = `%${q}%`;

    if (type === 'all' || type === 'posts') {
      postResults = db.prepare(`
        SELECT p.*, u.username, u.display_name,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts p JOIN users u ON p.author_id = u.id
        WHERE p.type = 'post' AND (p.title LIKE ? OR p.content_md LIKE ? OR p.tags LIKE ?)
        ORDER BY p.created_at DESC LIMIT 20
      `).all(like, like, like);
    }

    if (type === 'all' || type === 'forum') {
      forumResults = db.prepare(`
        SELECT p.*, u.username, u.display_name,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts p JOIN users u ON p.author_id = u.id
        WHERE p.type = 'forum' AND (p.title LIKE ? OR p.content_md LIKE ?)
        ORDER BY p.created_at DESC LIMIT 20
      `).all(like, like);
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
    forumResults,
    userResults,
  });
});

module.exports = router;
