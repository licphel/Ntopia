const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { verifyCode } = require('../lib/mail');
const router = express.Router();

const vars = { accountError: null, accountOk: null, emailError: null, emailOk: null };

router.get('/', (req, res) => {
  res.render('settings', { title: '设置', tab: req.query.tab || 'theme', ...vars });
});

router.post('/account', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const { new_password, new_password2, email_code } = req.body;
  if (!req.session.user.email) {
    return res.render('settings', { title: '设置', tab: 'account', ...vars, accountError: '请先绑定邮箱' });
  }
  if (!email_code) {
    return res.render('settings', { title: '设置', tab: 'account', ...vars, accountError: '请输入邮箱验证码' });
  }
  if (!verifyCode(req.session.user.email, email_code)) {
    return res.render('settings', { title: '设置', tab: 'account', ...vars, accountError: '验证码错误或已过期' });
  }
  if (new_password.length < 4) {
    return res.render('settings', { title: '设置', tab: 'account', ...vars, accountError: '新密码至少4个字符' });
  }
  if (new_password !== new_password2) {
    return res.render('settings', { title: '设置', tab: 'account', ...vars, accountError: '两次密码不一致' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.session.user.id);
  res.render('settings', { title: '设置', tab: 'account', ...vars, accountOk: '密码修改成功' });
});

router.post('/email', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const { new_email, email_code } = req.body;
  if (!new_email || !email_code) {
    return res.render('settings', { title: '设置', tab: 'email', ...vars, emailError: '请填写邮箱和验证码' });
  }
  if (!verifyCode(new_email, email_code)) {
    return res.render('settings', { title: '设置', tab: 'email', ...vars, emailError: '验证码错误或已过期' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(new_email, req.session.user.id);
  if (exists) {
    return res.render('settings', { title: '设置', tab: 'email', ...vars, emailError: '该邮箱已被其他账号绑定' });
  }
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(new_email, req.session.user.id);
  req.session.user.email = new_email;
  req.session.user.needsEmail = false;
  res.render('settings', { title: '设置', tab: 'email', ...vars, emailOk: '邮箱绑定成功' });
});

module.exports = router;
