// RSS + Sitemap routes.
const express = require('express');
const postService = require('../service/post');
const router = express.Router();

router.get('/rss.xml', (_, res) => { res.type('application/xml').send(postService.generateRSS()); });
router.get('/sitemap.xml', (_, res) => { res.type('application/xml').send(postService.generateSitemap()); });

module.exports = router;
const { requireAuth, requireAuthAPI, requireActive, requireRole } = require('../middleware/auth');
module.exports = router;
