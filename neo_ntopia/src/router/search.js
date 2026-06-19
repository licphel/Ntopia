// Search + Tags routes.
const express = require('express');
const postService = require('../service/post');
const router = express.Router();

router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.startsWith('#tag:') || q.startsWith('#t:')) {
    const tag = q.replace(/^#(tag|t):/, '').trim();
    if (tag) return res.redirect('/tags/' + encodeURIComponent(tag));
  }
  if (q.startsWith('#') && !q.includes(' ')) return res.redirect('/tags/' + encodeURIComponent(q.slice(1)));
  const page = parseInt(req.query.page) || 1;
  const r = postService.search(q, req.query.type || 'all', page);
  res.render('page/search', { title: q ? `搜索: ${q}` : '搜索', query: q, type: req.query.type || 'all', page, ...r });
});

router.get('/tags/:tag', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const r = postService.listByTag(req.params.tag, page);
  res.render('page/tags', { title: '#' + req.params.tag, tag: req.params.tag, posts: r.posts, page: r.page, totalPages: r.totalPages });
});

module.exports = router;
