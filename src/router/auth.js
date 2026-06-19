// Auth routes.
const api = require('../lib/res');
const express = require('express');
const rateLimit = require('express-rate-limit');
const authService = require('../service/auth');
const emailService = require('../service/email');
const config = require('../config');

const router = express.Router();

router.get('/captcha', (req, res) => {
  const svg = authService.generateCaptcha(req.session);
  req.session.save(() => { res.set('Cache-Control', 'no-store'); res.type('svg').send(svg); });
});

router.get('/login', (req, res) => res.render('page/login', { title: '登录', error: null }));
router.get('/register', (req, res) => res.render('page/register', { title: '注册', error: null }));
router.get('/reset-password', (req, res) => res.render('page/reset-password', { title: '重置密码', error: null, ok: null }));

router.post('/login', (req, res) => {
  const { username, password, captcha } = req.body;
  const r = authService.login(username, password, captcha, req.session, { ip: req.ip, userAgent: req.get('User-Agent') });
  if (!r.ok) return res.render('page/login', { title: '登录', error: r.error, form: { username } });
  req.session.user = r.user;
  req.session.save(() => res.redirect('/forum'));
});

router.post('/register', (req, res) => {
  const r = authService.register(req.body, req.session);
  if (!r.ok) return res.render('page/register', { title: '注册', error: r.error, form: { username: req.body.username, email: req.body.email, display_name: req.body.display_name } });
  req.session.user = r.user;
  req.session.save(() => res.redirect('/forum'));
});

router.post('/logout', (req, res) => { req.session.destroy(); res.redirect('/forum'); });

router.post('/reset-password/reset', (req, res) => {
  const r = authService.resetPassword(req.body.email, req.body.code, req.body.new_password, req.body.new_password2);
  if (!r.ok) return res.render('page/reset-password', { title: '重置密码', error: r.error, ok: null });
  res.render('page/reset-password', { title: '重置密码', error: null, ok: '密码重置成功！请前往登录。' });
});

router.post('/reset-password/reset', (req, res) => {
  const r = authService.resetPassword(req.body.email, req.body.code, req.body.new_password, req.body.new_password2);
  if (!r.ok) return res.status(400).json(api.err(r.error));
  res.json(api.ok({ message: '密码重置成功' }));
});

router.get('/checkin-status', (req, res) => {
  if (!req.session.user) return res.json(api.ok({ checkedIn: false }));
  res.json(api.ok(authService.checkinStatus(req.session.user.id)));
});

router.post('/checkin', (req, res) => {
  if (!req.session.user) return res.status(401).json(api.err('请先登录', 401));
  const r = authService.checkin(req.session.user.id);
  if (r.ok) { req.session.user.xp = r.xp; req.session.user.level = r.level; }
  res.json(api.ok(r));
});

router.post('/email/send', rateLimit({ windowMs: 60000, max: 1 }), async (req, res) => {
  const { email } = req.body;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json(api.err('邮箱格式错误'));
  const code = emailService.generateCode(); emailService.setCode(email, code);
  try { await emailService.sendCode(email, code); res.json(api.ok({})); }
  catch (e) { res.json(api.err('邮件发送失败', 500)); }
});

module.exports = router;
const { requireAuth, requireAuthAPI, requireActive, requireRole } = require('../middleware/auth');
module.exports = router;
