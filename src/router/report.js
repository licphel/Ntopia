// Report routes.
const express = require('express');
const auth = require('../lib/auth');
const adminService = require('../service/admin');
const { reportRepo } = require('../repo');
const router = express.Router();

router.post('/submit', auth.requireAuthAPI, (req, res) => {
  const { type, target_id, reason } = req.body;
  if (!type || !target_id) return res.json({ ok: false, error: '参数错误' });
  if (reportRepo.findDuplicate(req.session.user.id, type, target_id)) return res.json({ ok: false, error: '你已经举报过了' });
  reportRepo.create(req.session.user.id, type, target_id, reason || '');
  res.json({ ok: true });
});

router.get('/admin', auth.requireRole(auth.LEVEL.ADMIN), (req, res) => {
  res.render('page/reports-admin', { title: '举报管理', ...adminService.getReports(parseInt(req.query.page) || 1) });
});

router.post('/resolve/:id', auth.requireRole(auth.LEVEL.ADMIN), (req, res) => {
  adminService.resolveReport(req.params.id, req.body.action, req.session.user.id);
  res.redirect('/report/admin');
});

module.exports = router;
