const express = require('express');
const bcrypt = require('bcryptjs');
const { db, addXP } = require('../db');
const { verifyCode } = require('../mail');
const router = express.Router();

// Rate limit: 5 attempts per 15 minutes per IP
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: '请求过于频繁，请15分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', (req, res) => {
  res.render('login', { title: '登录', error: null });
});

  const { username, password } = req.body;
  if (username.length > 64 || password.length > 64) return res.render('login', { title: '登录', error: '用户名或密码过长' });
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { title: '登录', error: '用户名或密码错误' });
  }
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar: user.avatar, xp: user.xp, level: user.level };
  res.redirect('/');
});

router.get('/register', (req, res) => {
  res.render('register', { title: '注册', error: null });
});

  const { username, password, password2, display_name, email, email_code } = req.body;
  if (username.length > 64 || password.length > 64 || (display_name||"").length > 64) return res.render('register', { title: '注册', error: '输入过长' });
  if (!email || !email_code) return res.render('register', { title: '注册', error: '请先验证邮箱' });
  if (!verifyCode(email, email_code)) return res.render('register', { title: '注册', error: '验证码错误或已过期' });
  if (password !== password2) return res.render('register', { title: '注册', error: '两次密码不一致' });
  if (username.length < 2 || password.length < 4) return res.render('register', { title: '注册', error: '用户名至少2字符，密码至少4字符' });
  const uname = username.toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) return res.render('register', { title: '注册', error: '用户名已被占用' });
  const hash = bcrypt.hashSync(password, 10);
  const isFirst = db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0;
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, avatar, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uname, hash, display_name || uname, isFirst ? 128 : 1, '/img/default-avatar.svg', email);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar: user.avatar, xp: user.xp, level: user.level };
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

router.post('/checkin', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  const uid = req.session.user.id;
  const today = new Date().toISOString().slice(0, 10);

  const exists = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').get(uid, today);
  if (exists) {
    const count = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(uid);
    return res.json({ ok: false, already: true, total: count.c });
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const yesterdayCheckin = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').get(uid, yesterday);
  const user = db.prepare('SELECT consecutive_days FROM users WHERE id = ?').get(uid);
  let streak = yesterdayCheckin ? user.consecutive_days + 1 : 1;
  const xpEarned = 1 + Math.floor(streak / 5);

  db.prepare('INSERT INTO checkins (user_id, checkin_date, xp_earned) VALUES (?, ?, ?)').run(uid, today, xpEarned);
  db.prepare('UPDATE users SET consecutive_days = ?, last_checkin = ? WHERE id = ?').run(streak, today, uid);
  addXP(uid, xpEarned, '签到', null);

  const updated = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(uid);
  req.session.user.xp = updated.xp;
  req.session.user.level = updated.level;

  const count = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(uid);
  res.json({ ok: true, total: count.c, xpEarned, streak, xp: updated.xp, level: updated.level });
});

module.exports = router;
