const express = require('express');
const { db } = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  const posts = db.prepare(`
    SELECT p.*, u.display_name, u.username
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.type = 'post' AND p.is_deleted = 0
    ORDER BY p.created_at DESC LIMIT 20
  `).all();

  let items = '';
  posts.forEach(p => {
    const desc = (p.excerpt || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const title = p.title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const date = new Date(p.created_at).toUTCString();
    items += `<item>
      <title>${title}</title>
      <link>${siteUrl}/posts/${p.slug}</link>
      <description>${desc}</description>
      <author>${p.display_name || p.username}</author>
      <pubDate>${date}</pubDate>
      <guid>${siteUrl}/posts/${p.slug}</guid>
    </item>\n`;
  });

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Ntopia</title>
  <link>${siteUrl}</link>
  <description>记录思考，分享技术，探索世界</description>
  <language>zh-CN</language>
  <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
${items}</channel>
</rss>`;

  res.type('application/xml').send(rss);
});

module.exports = router;
