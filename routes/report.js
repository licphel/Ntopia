const express = require('express');
const { db } = require('../lib/db');
const { LEVEL } = require('../lib/perm');
const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: '请先登录' });
  next();
}

// Submit a report
router.post('/submit', requireLogin, (req, res) => {
  const { type, target_id, reason } = req.body;
  if (!type || !target_id) return res.json({ ok: false, error: '参数错误' });

  // Check not already reported by this user
  const dup = db.prepare("SELECT id FROM reports WHERE reporter_id = ? AND type = ? AND target_id = ? AND status = 'pending'").get(req.session.user.id, type, target_id);
  if (dup) return res.json({ ok: false, error: '你已经举报过了' });

  db.prepare('INSERT INTO reports (reporter_id, type, target_id, reason) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, type, target_id, reason || '');

  res.json({ ok: true });
});

// Admin: list reports
router.get('/admin', (req, res) => {
  if (!req.session.user || (req.session.user.role || 0) < 32) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '', back: '/' });
  }
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
  const reports = db.prepare(`
    SELECT r.*, u1.username as reporter_name, u1.display_name as reporter_display
    FROM reports r JOIN users u1 ON r.reporter_id = u1.id
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, (page - 1) * limit);
  const total = db.prepare("SELECT COUNT(*) as c FROM reports").get();

  // Fetch titles/content for each report
  const enriched = reports.map(r => {
    if (r.type === 'post') {
      const post = db.prepare('SELECT title, slug FROM posts WHERE id = ?').get(r.target_id);
      return Object.assign(r, { title: post ? post.title : '(已删除)', link: post ? '/posts/' + post.slug : '#' });
    } else {
      const cmt = db.prepare('SELECT c.content_md, p.slug FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(r.target_id);
      const preview = cmt ? (cmt.content_md || '').slice(0, 80) : '(已删除)';
      return Object.assign(r, { title: preview, link: cmt ? '/posts/' + cmt.slug + '/comment/' + r.target_id : '#' });
    }
  });

  res.render('reports-admin', {
    title: '举报管理', reports: enriched, page,
    totalPages: Math.ceil(total.c / limit),
  });
});

// Admin: resolve/dismiss
router.post('/resolve/:id', (req, res) => {
  if (!req.session.user || (req.session.user.role || 0) < 32) return res.redirect('/');
  const { action } = req.body; // 'resolved' or 'dismissed'
  db.prepare('UPDATE reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(action || 'resolved', req.session.user.id, req.params.id);
  res.redirect('/report/admin');
});

module.exports = router;
