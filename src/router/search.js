// Search routes.
const express = require('express');
const postService = require('../service/post');
const router = express.Router();

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  const sort = req.query.sort || 'newest';
  const type = req.query.type || 'all';
  const cat = parseInt(req.query.cat) || null;
  const r = postService.search(q, type, page, sort, cat);
  res.render('page/search', { title: q ? `搜索: ${q}` : '搜索', query: q, type, page, sort, cat, ...r });
});

module.exports = router;
