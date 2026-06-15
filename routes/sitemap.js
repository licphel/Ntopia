const express = require('express');
const { db } = require('../lib/db');
const router = express.Router();

router.get('/', (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  const posts = db.prepare("SELECT slug, updated_at FROM posts WHERE is_deleted = 0 ORDER BY updated_at DESC").all();
  let urls = `<url><loc>${siteUrl}</loc></url>\n`;
  posts.forEach(p => {
    urls += `<url><loc>${siteUrl}/posts/${p.slug}</loc><lastmod>${p.updated_at.slice(0,10)}</lastmod></url>\n`;
  });
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`);
});

module.exports = router;
