const express = require('express');
const rb = require('../lib/rb');
const router = express.Router();

// Red-black list page
router.get('/rb', (req, res) => {
  const q = (req.query.q || '').trim();
  const field = req.query.field || 'all';
  let results = [];
  if (q) results = rb.search(q, field);
  const teachers = rb.getTeachers();
  res.render('rb', { title: '红黑榜', q, field, results, teachers });
});

// Search API (JSON)
router.get('/rb/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const field = req.query.field || 'all';
  if (!q) return res.json([]);
  const results = rb.search(q, field);
  res.json(results.slice(0, 100));
});

// Add evaluation
router.post('/rb/add', (req, res) => {
  const { teacher, course_name, year, review } = req.body;
  if (!teacher || !course_name || !review) {
    return res.json({ ok: false, error: '请填写老师、课程和评价内容' });
  }
  if (teacher.length > 64 || course_name.length > 128 || review.length > 5000) {
    return res.json({ ok: false, error: '输入过长' });
  }
  try {
    rb.addEvaluation(teacher.trim(), course_name.trim(), (year || '').trim() || '-', review.trim());
    res.json({ ok: true });
  } catch (e) {
    console.error('[rb] Add error:', e.message);
    res.json({ ok: false, error: '保存失败，请稍后重试' });
  }
});

module.exports = router;
