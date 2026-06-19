// Tools routes — 红黑榜 etc.
const express = require('express');
const router = express.Router();

let rb = null;
rb = require('../lib/rb');

router.get('/tools/rb', (req, res) => {
  const q = (req.query.q || '').trim();
  let results = [], teachers = [];
  if (rb) {
    if (q) results = rb.search(q, req.query.field || 'all');
    teachers = rb.getTeachers();
  }
  res.render('page/rb', { title: '红黑榜', q, field: req.query.field || 'all', results, teachers });
});

router.get('/tools/rb/search', (req, res) => {
  if (!rb) return res.json([]);
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(rb.search(q, req.query.field || 'all').slice(0, 100));
});

router.post('/tools/rb/add', (req, res) => {
  if (!rb) return res.json({ ok: false, error: '功能暂未开放' });
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
