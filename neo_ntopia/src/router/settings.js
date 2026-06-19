// Settings routes — one page per action.
const express = require('express');
const userService = require('../service/user');
const auth = require('../lib/auth');
const router = express.Router();

router.get('/password', auth.requireAuth, (req, res) => {
  res.render('page/settings-password', { title: '修改密码', error: null, ok: null });
});
router.post('/password', auth.requireAuth, (req, res) => {
  const r = userService.changePassword(req.session.user, req.body.new_password, req.body.new_password2, req.body.email_code);
  if (!r.ok) return res.render('page/settings-password', { title: '修改密码', error: r.error, ok: null });
  res.render('page/settings-password', { title: '修改密码', error: null, ok: '密码修改成功' });
});

router.get('/email', auth.requireAuth, (req, res) => {
  res.render('page/settings-email', { title: '邮箱绑定', error: null, ok: null });
});
router.post('/email', auth.requireAuth, (req, res) => {
  const r = userService.changeEmail(req.session.user, req.body.new_email, req.body.email_code);
  if (!r.ok) return res.render('page/settings-email', { title: '邮箱绑定', error: r.error, ok: null });
  req.session.user.email = r.email; req.session.user.needsEmail = false; req.session.save();
  res.render('page/settings-email', { title: '邮箱绑定', error: null, ok: '邮箱绑定成功' });
});

router.get('/delete', auth.requireAuth, (req, res) => {
  res.render('page/settings-delete', { title: '删除账号', error: null });
});
router.post('/delete', auth.requireAuth, (req, res) => {
  const r = userService.deleteAccount(req.session.user, req.body.email_code);
  if (!r.ok) return res.render('page/settings-delete', { title: '删除账号', error: r.error });
  req.session.destroy();
  res.redirect('/forum');
});

module.exports = router;
