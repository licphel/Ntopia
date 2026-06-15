const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { verifyCode } = require('../lib/mail');
const router = express.Router();

const vars = { accountError: null, accountOk: null, emailError: null, emailOk: null };

// Helper to build render params with new tab/subtab structure
function renderSettings(res, opts) {
  const tab = opts.tab || 'appearance';
  const subtab = opts.subtab || (tab === 'account' ? 'password' : 'theme');
  res.render('settings', Object.assign({ title: '设置', tab, subtab }, vars, opts));
}

router.get('/', (req, res) => {
  renderSettings(res, { tab: req.query.tab, subtab: req.query.sub });
});

router.post('/account', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const { new_password, new_password2, email_code } = req.body;
  if (!req.session.user.email) {
    return renderSettings(res, { tab: 'account', subtab: 'password', accountError: '请先绑定邮箱' });
  }
  if (!email_code) {
    return renderSettings(res, { tab: 'account', subtab: 'password', accountError: '请输入邮箱验证码' });
  }
  if (!verifyCode(req.session.user.email, email_code)) {
    return renderSettings(res, { tab: 'account', subtab: 'password', accountError: '验证码错误或已过期' });
  }
  if (new_password.length < 4) {
    return renderSettings(res, { tab: 'account', subtab: 'password', accountError: '新密码至少4个字符' });
  }
  if (new_password !== new_password2) {
    return renderSettings(res, { tab: 'account', subtab: 'password', accountError: '两次密码不一致' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), req.session.user.id);
  renderSettings(res, { tab: 'account', subtab: 'password', accountOk: '密码修改成功' });
});

router.post('/email', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const { new_email, email_code } = req.body;
  if (!new_email || !email_code) {
    return renderSettings(res, { tab: 'account', subtab: 'email', emailError: '请填写邮箱和验证码' });
  }
  if (!verifyCode(new_email, email_code)) {
    return renderSettings(res, { tab: 'account', subtab: 'email', emailError: '验证码错误或已过期' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(new_email, req.session.user.id);
  if (exists) {
    return renderSettings(res, { tab: 'account', subtab: 'email', emailError: '该邮箱已被其他账号绑定' });
  }
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(new_email, req.session.user.id);
  req.session.user.email = new_email;
  req.session.user.needsEmail = false;
  renderSettings(res, { tab: 'account', subtab: 'email', emailOk: '邮箱绑定成功' });
});

// Account deletion — Super Admin+ only (content preserved for legal compliance)
router.post('/delete-account', (req, res) => {
  if (!req.session.user || (req.session.user.role || 0) < 64) {
    return res.redirect('/auth/login');
  }
  const { email_code } = req.body;
  const uid = req.session.user.id;
  const email = req.session.user.email;

  if (!email) {
    return renderSettings(res, { tab: 'account', subtab: 'delete', accountError: '请先绑定邮箱' });
  }
  if (!email_code) {
    return renderSettings(res, { tab: 'account', subtab: 'delete', accountError: '请输入邮箱验证码以确认删除' });
  }
  if (!verifyCode(email, email_code)) {
    return renderSettings(res, { tab: 'account', subtab: 'delete', accountError: '验证码错误或已过期' });
  }

  // Soft-delete: ban user, scramble password, soft-delete all posts/comments
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(uid);
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(uid);
  db.prepare('DELETE FROM messages WHERE from_id = ? OR to_id = ?').run(uid, uid);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(uid);
  db.prepare('UPDATE users SET banned = 1, password_hash = ? WHERE id = ?').run(bcrypt.hashSync(Math.random().toString(), 10), uid);

  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
