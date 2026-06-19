// Search routes.
const express = require('express');
const postService = require('../service/post');
const router = express.Router();

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  const r = postService.search(q, req.query.type || 'all', page);
  res.render('page/search', { title: q ? `搜索: ${q}` : '搜索', query: q, type: req.query.type || 'all', page, ...r });
});

module.exports = router;
