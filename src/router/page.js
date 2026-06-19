// Static page routes.
const express = require('express');
const fs = require('fs');
const path = require('path');
const { renderMarkdown } = require('../util/markdown');
const router = express.Router();

const PAGES_DIR = path.join(__dirname, '..', '..', 'public', 'pages');

router.get('/pages/:slug', (req, res) => {
  const slug = req.params.slug.replace(/\.\./g, '').replace(/[/\\]/g, '');
  const fp = path.resolve(PAGES_DIR, slug + '.md');
  if (!fp.startsWith(path.resolve(PAGES_DIR) + path.sep) || !fs.existsSync(fp))
    return res.status(404).render('page/404', { title: '404' });
  const raw = fs.readFileSync(fp, 'utf8');
  let title = slug, body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('---', 3);
    if (end > 0) { body = raw.slice(end + 3); const m = raw.slice(3, end).match(/title:\s*(.+)/); if (m) title = m[1].trim(); }
  }
  res.render('page/page', { title, content: renderMarkdown(body) });
});

module.exports = router;
