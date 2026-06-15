const express = require('express');
const bcrypt = require('bcryptjs');
const svgCaptcha = require('svg-captcha');
const { db, awardCheckinXP } = require('../lib/db');
const { verifyCode } = require('../lib/mail');
const router = express.Router();

// CAPTCHA endpoint
router.get('/captcha', (req, res) => {
  const captcha = svgCaptcha.create({ size: 4, noise: 2, ignoreChars: '0o1il', color: true, background: '#fafaf5' });
  req.session._captcha = captcha.text.toLowerCase();
  req.session.save(() => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.type('svg').send(captcha.data);
  });
});

router.get('/login', (req, res) => {
  res.render('login', { title: '登录', error: null });
});

router.post('/login', (req, res) => {
  const { username, password, captcha } = req.body;
  if (username.length > 64 || password.length > 64) return res.render('login', { title: '登录', error: '用户名或密码过长' });
  if (!captcha || captcha.toLowerCase() !== req.session._captcha) return res.render('login', { title: '登录', error: '验证码错误' });
  req.session._captcha = null;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { title: '登录', error: '用户名或密码错误' });
  }
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar: user.avatar, xp: user.xp, level: user.level, email: user.email, needsEmail: !user.email };
  req.session.save(() => res.redirect('/'));
});

router.get('/register', (req, res) => {
  res.render('register', { title: '注册', error: null });
});

router.post('/register', (req, res) => {
  const { username, password, password2, display_name, email, email_code, captcha, agree } = req.body;
  if (!agree) return res.render('register', { title: '注册', error: '请先阅读并同意用户须知' });
  if (!captcha || captcha.toLowerCase() !== req.session._captcha) return res.render('register', { title: '注册', error: '验证码错误' });
  req.session._captcha = null;
  if (username.length > 64 || password.length > 64 || (display_name || '').length > 64) return res.render('register', { title: '注册', error: '输入过长' });
  if (!email || !email_code) return res.render('register', { title: '注册', error: '请先验证邮箱' });
  if (!verifyCode(email, email_code)) return res.render('register', { title: '注册', error: '验证码错误或已过期' });
  if (password !== password2) return res.render('register', { title: '注册', error: '两次密码不一致' });
  if (username.length < 2 || password.length < 4) return res.render('register', { title: '注册', error: '用户名至少2字符，密码至少4字符' });
  const uname = username.toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
  if (exists) return res.render('register', { title: '注册', error: '用户名已被占用' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (username, password_hash, display_name, role, avatar, email) VALUES (?, ?, ?, 1, ?, ?)')
    .run(uname, hash, display_name || uname, '/img/default-avatar.png', email);
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(uname);
  req.session.user = { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar: user.avatar, xp: user.xp, level: user.level, email: user.email, needsEmail: !user.email };
  req.session.save(() => res.redirect('/'));
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

router.post('/checkin', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  const uid = req.session.user.id;
  const { today, yesterday } = require('../lib/time');
  const todayStr = today();
  const exists = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').get(uid, todayStr);
  if (exists) {
    const count = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(uid);
    return res.json({ ok: false, already: true, total: count.c });
  }
  const yesterdayStr = yesterday();
  const yesterdayCheckin = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?').get(uid, yesterdayStr);
  const user = db.prepare('SELECT consecutive_days FROM users WHERE id = ?').get(uid);
  let streak = yesterdayCheckin ? user.consecutive_days + 1 : 1;
  const xpEarned = 1 + Math.floor(streak / 5);
  db.prepare('INSERT INTO checkins (user_id, checkin_date, xp_earned) VALUES (?, ?, ?)').run(uid, todayStr, xpEarned);
  db.prepare('UPDATE users SET consecutive_days = ?, last_checkin = ? WHERE id = ?').run(streak, todayStr, uid);
  awardCheckinXP(uid, xpEarned, null);
  const updated = db.prepare('SELECT xp, level FROM users WHERE id = ?').get(uid);
  req.session.user.xp = updated.xp;
  req.session.user.level = updated.level;
  const count = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(uid);
  res.json({ ok: true, total: count.c, xpEarned, streak, xp: updated.xp, level: updated.level });
});

module.exports = router;
