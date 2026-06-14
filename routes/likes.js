const express = require('express');
const { db, awardLikeReceivedXP } = require('../db');
const router = express.Router();

router.post('/toggle', (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false });
  const { post_id, comment_id } = req.body;
  const uid = req.session.user.id;
  const existing = db.prepare('SELECT id FROM likes WHERE user_id = ? AND post_id IS ? AND comment_id IS ?')
    .get(uid, post_id || null, comment_id || null);
  if (existing) {
    db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO likes (user_id, post_id, comment_id) VALUES (?, ?, ?)').run(uid, post_id || null, comment_id || null);
    // Award XP to content author
    if (post_id) {
      const post = db.prepare('SELECT author_id FROM posts WHERE id = ?').get(post_id);
      if (post && post.author_id !== uid) awardLikeReceivedXP(post.author_id, post_id);
    }
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM likes WHERE post_id IS ? AND comment_id IS ?')
    .get(post_id || null, comment_id || null);
  res.json({ ok: true, liked: !existing, count: count.c });
});

module.exports = router;
