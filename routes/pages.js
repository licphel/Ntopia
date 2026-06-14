const express = require('express');
const fs = require('fs');
const path = require('path');
const { renderMarkdown } = require('../lib/helpers');
const router = express.Router();

const PAGES_DIR = path.join(__dirname, '..', 'pages');

router.get('/:slug', (req, res) => {
  const filePath = path.join(PAGES_DIR, req.params.slug + '.md');
  if (!fs.existsSync(filePath)) return res.status(404).render('404', { title: '404' });
  const raw = fs.readFileSync(filePath, 'utf8');
  // Parse YAML frontmatter
  let title = req.params.slug, body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('---', 3);
    if (end > 0) {
      const fm = raw.slice(3, end);
      body = raw.slice(end + 3);
      const m = fm.match(/title:\s*(.+)/);
      if (m) title = m[1].trim();
    }
  }
  const html = renderMarkdown(body);
  res.render('page', { title, content: html });
});

module.exports = router;
