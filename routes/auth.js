const express = require('express');
const bcrypt = require('bcryptjs');
const { db, addXP } = require('../db');
const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { title: '登录', error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { title: '登录', error: '用户名或密码错误' });
  }
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar: user.avatar, xp: user.xp, level: user.level };
  res.redirect('/');
});

router.get('/register', (req, res) => {
  res.render('register', { title: '注册', error: null });
});

router.post('/register', (req, res) => {
  const { username, password, password2, display_name } = req.body;
  if (password !== password2) return res.render('register', { title: '注册', error: '两次密码不一致' });
  if (username.length < 2 || password.length < 4) return res.render('register', { title: '注册', error: '用户名至少2字符，密码至少4字符' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.render('register', { title: '注册', error: '用户名已被占用' });
  const hash = bcrypt.hashSync(password, 10);
  const isFirst = db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0;
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, avatar) VALUES (?, ?, ?, ?, ?)')
    .run(username, hash, display_name || username, isFirst ? 128 : 1, '/img/default-avatar.svg');
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar: user.avatar, xp: user.xp, level: user.level };
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// Check-in with XP and consecutive days
router.post('/checkin', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  const uid = req.session.user.id;
  const today = new Date().toISOString().slice(0, 10);

  // Already checked in today?
  const exists = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').get(uid, today);
  if (exists) {
    const count = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(uid);
    return res.json({ ok: false, already: true, total: count.c });
  }

  // Calculate consecutive days
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const yesterdayCheckin = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').get(uid, yesterday);
  const user = db.prepare('SELECT consecutive_days FROM users WHERE id = ?').get(uid);
  let streak = yesterdayCheckin ? user.consecutive_days + 1 : 1;

  // XP: base 1 + consecutive bonus (streak/5)
  const xpEarned = 1 + Math.floor(streak / 5);

  db.prepare('INSERT INTO checkins (user_id, checkin_date, xp_earned) VALUES (?, ?, ?)').run(uid, today, xpEarned);
  db.prepare('UPDATE users SET consecutive_days = ?, last_checkin = ? WHERE id = ?').run(streak, today, uid);
  addXP(uid, xpEarned, '签到', null);

  // Refresh session XP/level
  const updated = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(uid);
  req.session.user.xp = updated.xp;
  req.session.user.level = updated.level;

  const count = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(uid);
  res.json({ ok: true, total: count.c, xpEarned, streak, xp: updated.xp, level: updated.level });
});

module.exports = router;
