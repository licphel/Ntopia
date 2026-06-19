// Tools routes — 红黑榜 etc.
const express = require('express');
const router = express.Router();
const rb = require('../../../lib/rb'); // parent project's rb module

router.get('/tools/rb', (req, res) => {
  const q = (req.query.q || '').trim();
  const field = req.query.field || 'all';
  let results = [];
  if (q) results = rb.search(q, field);
  const teachers = rb.getTeachers();
  res.render('page/rb', { title: '红黑榜', q, field, results, teachers });
});

router.get('/tools/rb/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const field = req.query.field || 'all';
  if (!q) return res.json([]);
  res.json(rb.search(q, field).slice(0, 100));
});

router.post('/tools/rb/add', (req, res) => {
  const { teacher, course_name, year, review } = req.body;
  if (!teacher || !course_name || !review) return res.json({ ok: false, error: '请填写老师、课程和评价内容' });
  if (teacher.length > 64 || course_name.length > 128 || review.length > 5000) return res.json({ ok: false, error: '输入过长' });
  try {
    rb.addEvaluation(teacher.trim(), course_name.trim(), (year || '').trim() || '-', review.trim());
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: '保存失败，请稍后重试' });
  }
});

module.exports = router;
