// Admin routes.
const auth = require('../lib/auth');
const express = require('express');
const adminService = require('../service/admin');

const router = express.Router();
const needAdmin = auth.requireRole(auth.LEVEL.ADMIN);
const needMod   = auth.requireRole(auth.LEVEL.MOD);

function _err(res, msg, back) {
  return res.status(400).render('page/error', { title: '错误', code: 400, message: msg, detail: '', back });
}

router.get('/', needAdmin, (req, res) => {
  res.render('page/admin', { title: '管理后台', ...adminService.dashboard(), LEVEL: auth.LEVEL, hideSidebar: true });
});

router.post('/categories', needAdmin, (req, res) => {
  adminService.createCategory(req.body.name, req.body.description); res.redirect('/admin');
});
router.post('/categories/:id/delete', needAdmin, (req, res) => {
  adminService.deleteCategory(req.params.id); res.redirect('/admin');
});

router.post('/posts/:id(\\d+)/delete', needMod, (req, res) => { adminService.deletePost(req.params.id); res.redirect('/'); });
router.post('/posts/:id(\\d+)/purge', needAdmin, (req, res) => { adminService.purgePost(req.params.id); res.redirect('/admin'); });
router.post('/posts/:id(\\d+)/restore', needAdmin, (req, res) => { adminService.restorePost(req.params.id); res.redirect('/admin'); });
router.post('/posts/:id(\\d+)/pin', needMod, (req, res) => { adminService.togglePin(req.params.id); res.redirect(req.get('Referer') || '/'); });

router.post('/comments/:id/delete-mod', needMod, (req, res) => {
  const postId = adminService.deleteComment(req.params.id);
  if (!postId) return res.status(404).render('page/404', { title: '404' });
  res.redirect('/posts/' + postId);
});

router.post('/users/:id/ban', needAdmin, (req, res) => {
  const r = adminService.banUser(req.params.id, req.session.user);
  if (!r.ok) return _err(res, r.error, '/admin');
  res.redirect('/users/' + r.id);
});
router.post('/users/:id/unban', needAdmin, (req, res) => {
  const u = adminService.unbanUser(req.params.id); res.redirect('/users/' + (u || ''));
});
router.post('/users/:id/promote', auth.requireAuth, (req, res) => {
  const r = adminService.promoteUser(req.params.id, req.session.user);
  if (!r.ok) return _err(res, r.error, '/admin');
  res.redirect('/users/' + r.id);
});
router.post('/users/:id/demote', auth.requireAuth, (req, res) => {
  const r = adminService.demoteUser(req.params.id, req.session.user);
  if (!r.ok) return _err(res, r.error, '/admin');
  res.redirect('/users/' + r.id);
});
router.post('/users/:id/delete', auth.requireAuth, (req, res) => {
  const r = adminService.deleteUser(req.params.id, req.session.user);
  if (!r.ok) return _err(res, r.error, '/admin');
  res.redirect('/users/' + r.id);
});

module.exports = router;
