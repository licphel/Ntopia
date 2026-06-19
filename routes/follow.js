const express = require('express');
const { db } = require('../lib/db');
const { requireLoginAPI } = require('../lib/middleware');
const router = express.Router();

// Toggle follow
router.post('/:username', requireLoginAPI, (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(req.params.username);
  if (!target || target.id === req.session.user.id) return res.json({ ok: false, error: '无法操作' });

  const existing = db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND follow_id = ?').get(req.session.user.id, target.id);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE user_id = ? AND follow_id = ?').run(req.session.user.id, target.id);
    return res.json({ ok: true, following: false });
  } else {
    db.prepare('INSERT INTO follows (user_id, follow_id) VALUES (?, ?)').run(req.session.user.id, target.id);
    const myName = req.session.user.display_name || req.session.user.username;
    db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'follow', ?, ?)`)
      .run(target.id, `${myName} 关注了你`, '/users/' + req.session.user.username);
    return res.json({ ok: true, following: true });
  }
});

// Followers list
router.get('/:username/followers', (req, res) => {
  const profile = db.prepare('SELECT username, display_name FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.status(404).render('404', { title: '404' });
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.bio, f.created_at as followed_at
    FROM follows f JOIN users u ON f.user_id = u.id
    WHERE f.follow_id = (SELECT id FROM users WHERE username = ?)
    ORDER BY f.created_at DESC LIMIT ? OFFSET ?
  `).all(req.params.username, limit, (page - 1) * limit);
  const count = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follow_id = (SELECT id FROM users WHERE username = ?)').get(req.params.username);
  // Mark which users the current viewer follows
  if (req.session.user && users.length) {
    const ids = users.map(u => u.id);
    const followed = db.prepare(`SELECT follow_id FROM follows WHERE user_id = ? AND follow_id IN (${ids.map(()=>'?').join(',')})`).all(req.session.user.id, ...ids);
    const followedSet = new Set(followed.map(r => r.follow_id));
    users.forEach(u => { u.isFollowed = followedSet.has(u.id); });
  }
  res.render('follow-list', {
    title: profile.display_name + ' 的粉丝',
    profile, users, page,
    totalPages: Math.ceil(count.c / limit),
    listType: 'followers'
  });
});

// Following list
router.get('/:username/following', (req, res) => {
  const profile = db.prepare('SELECT username, display_name FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.status(404).render('404', { title: '404' });
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar, u.bio, f.created_at as followed_at
    FROM follows f JOIN users u ON f.follow_id = u.id
    WHERE f.user_id = (SELECT id FROM users WHERE username = ?)
    ORDER BY f.created_at DESC LIMIT ? OFFSET ?
  `).all(req.params.username, limit, (page - 1) * limit);
  const count = db.prepare('SELECT COUNT(*) as c FROM follows WHERE user_id = (SELECT id FROM users WHERE username = ?)').get(req.params.username);
  if (req.session.user && users.length) {
    const ids = users.map(u => u.id);
    const followed = db.prepare(`SELECT follow_id FROM follows WHERE user_id = ? AND follow_id IN (${ids.map(()=>'?').join(',')})`).all(req.session.user.id, ...ids);
    const followedSet = new Set(followed.map(r => r.follow_id));
    users.forEach(u => { u.isFollowed = followedSet.has(u.id); });
  }
  res.render('follow-list', {
    title: profile.display_name + ' 的关注',
    profile, users, page,
    totalPages: Math.ceil(count.c / limit),
    listType: 'following'
  });
});

module.exports = router;
