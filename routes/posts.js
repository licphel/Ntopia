const { LEVEL } = require('../lib/perm');
const express = require('express');
const { renderMarkdown, slugify, computeDepth, extractTOC, injectHeadingIds, firstNLines } = require('../lib/helpers');
const { db, awardPostXP } = require('../lib/db');
const { LICENSES, licenseText } = require('../lib/license');
const { requireLogin, requireActive, requireRole } = require('../lib/middleware');
const time = require('../lib/time');
const router = express.Router();

// Landing page
router.get('/', (req, res) => {
  const stats = {
    posts:    db.prepare("SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 AND is_draft = 0").get().c,
    comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE is_deleted = 0 OR is_deleted IS NULL").get().c,
    users:    db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    views:    db.prepare('SELECT COUNT(*) as c FROM site_views').get().c,
    todayViews: db.prepare("SELECT COUNT(*) as c FROM site_views WHERE date(created_at) = date('now')").get().c,
    likes:    db.prepare('SELECT COUNT(*) as c FROM likes').get().c,
    bookmarks: db.prepare('SELECT COUNT(*) as c FROM bookmarks').get().c,
    checkins: db.prepare('SELECT COUNT(*) as c FROM checkins').get().c,
  };
  res.render('home', { title: '首页', stats });
});

// Shared listing helper
function listPosts(catFilter, params, req, res, opts) {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const sort = req.query.sort || 'newest';
  const limit = 10;
  const offset = (page - 1) * limit;
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();

  const base = `SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
    COALESCE(cat.name, p.category) as category_name,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug
    WHERE (p.is_deleted = 0 OR p.is_deleted IS NULL) AND p.is_draft = 0 ${catFilter}`;

  const countBase = catFilter.replace(/p\./g, '');
  const total = db.prepare(`SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 AND is_draft = 0 ${countBase}`).get(...params);

  let posts;
  if (sort === 'replies') {
    posts = db.prepare(`${base} ORDER BY p.is_pinned DESC, comment_count DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  } else if (sort === 'hot') {
    const hotNow = time.toSQL().split(' ')[0];
    posts = db.prepare(`SELECT * FROM (${base}) ORDER BY is_pinned DESC,
      (comment_count * 3.0 + view_count * 0.1) / ((julianday(?) - julianday(created_at)) * 24.0 + 4.0) DESC
      LIMIT ? OFFSET ?`).all(...params, hotNow, limit, offset);
  } else {
    posts = db.prepare(`${base} ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  }

  const totalPages = Math.ceil(total.c / limit);
  posts.forEach(p => { p.preview_html = firstNLines(p.content_html, 5); });
  res.render('index', Object.assign({ posts, page, totalPages, sort, categories }, opts));
}

router.get('/blog', (req, res) => {
  const cat = req.query.cat || '';
  const f = cat ? "AND p.category = ?" : "AND (p.category != 'forum' OR p.category IS NULL OR p.category = '')";
  listPosts(f, cat ? [cat] : [], req, res, { title: '博客', currentCat: cat, isBlog: true });
});

router.get('/forum', (req, res) => {
  listPosts("AND p.category = 'forum'", [], req, res, { title: '论坛', isForum: true });
});

// My drafts
router.get('/drafts', requireLogin, (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 10;
  const drafts = db.prepare(`SELECT * FROM posts WHERE author_id = ? AND is_draft = 1 AND is_deleted = 0 ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(req.session.user.id, limit, (page - 1) * limit);
  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE author_id = ? AND is_draft = 1 AND is_deleted = 0').get(req.session.user.id);
  res.render('drafts', { title: '我的草稿', drafts, draftPage: page, draftTotalPages: Math.ceil(total.c / limit) });
});

// Single post
router.get('/posts/:slug', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
      COALESCE(cat.name, p.category) as category_name,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug
    WHERE p.slug = ? AND p.is_draft = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  if (post.is_deleted && (req.session.user ? req.session.user.role || 0 : 0) < LEVEL.OWNER && (req.session.user ? req.session.user.id : 0) !== post.author_id) {
    return res.status(404).render('404', { title: '404' });
  }

  // View dedup
  const viewedCookie = (req.headers.cookie || '').match(/(?:^|;\s*)ntopia_views=([^;]*)/);
  const viewed = viewedCookie ? viewedCookie[1].split(',') : [];
  if (!viewed.includes(String(post.id))) {
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(post.id);
    post.view_count++;
    viewed.push(String(post.id));
    if (viewed.length > 20) viewed.shift();
    res.cookie('ntopia_views', viewed.join(','), { maxAge: 86400000, httpOnly: true, sameSite: 'lax' });
  }

  // User like/bookmark status
  let userLiked = false, userBookmarked = false, likeCount = 0, bookmarkCount = 0;
  likeCount = (db.prepare('SELECT COUNT(*) as c FROM likes WHERE post_id = ?').get(post.id) || {}).c || 0;
  bookmarkCount = (db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE post_id = ?').get(post.id) || {}).c || 0;
  if (req.session.user) {
    userLiked = !!db.prepare('SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?').get(req.session.user.id, post.id);
    userBookmarked = !!db.prepare('SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?').get(req.session.user.id, post.id);
  }

  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    JOIN posts p ON c.post_id = p.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? AND ((c.is_deleted = 0 OR c.is_deleted IS NULL) OR ? >= 128) ORDER BY c.created_at ASC
  `).all(post.id, (req.session.user ? (req.session.user.role || 0) : 0));

  computeDepth(comments);
  const toc = extractTOC(post.content_html);
  if (toc.length) post.content_html = injectHeadingIds(post.content_html);
  const metaDesc = post.content_md.replace(/[#*`>\[\]()!~|\\]/g,'').replace(/\s+/g,' ').trim().slice(0, 160);
  const bibtex = _bibtex(post, req.params.slug);

  res.render("post", { title: post.title, post, comments, toc: toc.length > 1 ? toc : null, cmtPage: parseInt(req.query.cp) || 1, metaDesc, bibtex, userLiked, userBookmarked, likeCount, bookmarkCount });
});

function _bibtex(post, slug) {
  const siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  const author = post.display_name || post.username;
  const year = new Date(post.created_at).getFullYear();
  const key = 'ntopia-' + (post.username || 'anon') + '-' + slug.slice(-8);
  return `@misc{${key},\n  author = {${author}},\n  title = {${post.title}},\n  year = {${year}},\n  howpublished = {\\url{${siteUrl}/posts/${slug}}},\n  note = {Accessed: ${time.now().toISOString().slice(0, 10)}}\n}`;
}

// Create post — form
router.get('/new-post', requireActive, (req, res) => {
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  res.render('editor', { title: '撰写文章', post: null, categories, licenses: LICENSES });
});

// Create post — submit
router.post('/new-post', requireActive, async (req, res) => {
  const { title, category, tags, content, license } = req.body;
  const validLicense = LICENSES.some(l => l.key === license) ? (license || '') : '';
  const isDraft = req.body.is_draft === '1' ? 1 : 0;
  const slug = slugify(title) + '-' + time.now().getTime();
  const html = renderMarkdown(content);

  if (!isDraft && (req.session.user.role || 0) < LEVEL.ADMIN) {
    const { review } = require('../lib/moderation');
    const result = await review(title, content, category || '');
    if (!result.pass) {
      db.prepare("UPDATE users SET banned = 1, banned_until = ? WHERE id = ?").run(time.sqlFromNow('+1 hour'), req.session.user.id);
      return res.status(403).render('error', { title: '错误', code: 403, message: '内容审核未通过', detail: `你的文章未通过审核：${result.reason}。账号已被封禁1小时。`, back: '/' });
    }
  }

  db.prepare(`INSERT INTO posts (title, slug, content_md, content_html, category, tags, author_id, is_draft, license) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(title, slug, content, html, category || '', tags || '', req.session.user.id, isDraft, validLicense);
  if (isDraft) return res.redirect('/drafts');
  awardPostXP(req.session.user.id, db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug).id);
  req.session.user.xp = (req.session.user.xp || 0) + 3;
  res.redirect('/posts/' + slug);
});

// Edit post — form
router.get('/posts/:slug/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || !_canEdit(req.session.user, post)) return _forbidden(res);
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  res.render('editor', { title: '编辑文章', post, categories, licenses: LICENSES });
});

// Edit post — submit
router.post('/posts/:slug/edit', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || !_canEdit(req.session.user, post)) return _forbidden(res);
  const { title, content, category, tags, license } = req.body;
  const validLicense = LICENSES.some(l => l.key === license) ? (license || '') : '';
  const isDraft = req.body.is_draft === '1' ? 1 : 0;
  const html = renderMarkdown(content);

  db.prepare(`INSERT INTO post_revisions (post_id, title, content_md, content_html, category, tags, revised_by) VALUES (?,?,?,?,?,?,?)`)
    .run(post.id, post.title, post.content_md, post.content_html, post.category || '', post.tags || '', req.session.user.id);
  db.prepare(`DELETE FROM post_revisions WHERE id IN (SELECT id FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 10)`).run(post.id);
  db.prepare(`UPDATE posts SET title=?,content_md=?,content_html=?,category=?,tags=?,is_draft=?,license=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(title, content, html, category || '', tags || '', isDraft, validLicense, post.id);
  res.redirect(isDraft ? '/drafts' : '/posts/' + post.slug);
});

// Download MD
router.get('/posts/:slug/download', (req, res) => {
  const post = db.prepare(`SELECT p.title, p.content_md, p.license, p.created_at, u.display_name, u.username FROM posts p JOIN users u ON p.author_id = u.id WHERE p.slug = ? AND p.is_deleted = 0 AND p.is_draft = 0`).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  const author = post.display_name || post.username;
  const siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  const filename = encodeURIComponent(post.title.slice(0, 40).replace(/[/\\?*:|"<>]/g, '')) + '.md';
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(`---\ntitle: ${post.title}\nauthor: ${author}\ndate: ${post.created_at}\n---\n\n${post.content_md}\n\n---\n\n${licenseText(post.license || '', { author, year: new Date(post.created_at).getFullYear(), url: siteUrl + '/posts/' + req.params.slug })}`);
});

// Delete own post
router.post('/posts/:slug/delete-self', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '', back: '/' });
  if (!_canEdit(req.session.user, post)) return _forbidden(res);
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
  res.redirect('/');
});

// Revisions
router.get('/posts/:slug/revisions', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  if (!_canEdit(req.session.user, post)) return _forbidden(res);
  const revisions = db.prepare('SELECT r.*, u.username, u.display_name FROM post_revisions r JOIN users u ON r.revised_by = u.id WHERE r.post_id = ? ORDER BY r.created_at DESC').all(post.id);
  res.render('revisions', { title: '编辑历史: ' + post.title, post, revisions });
});

// Restore revision
router.post('/posts/:slug/restore/:revId', requireLogin, (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
  if (!post || !_canEdit(req.session.user, post)) return _forbidden(res);
  const rev = db.prepare('SELECT * FROM post_revisions WHERE id = ? AND post_id = ?').get(req.params.revId, post.id);
  if (!rev) return res.status(404).render('404', { title: '404' });
  db.prepare(`INSERT INTO post_revisions (post_id, title, content_md, content_html, category, tags, revised_by) VALUES (?,?,?,?,?,?,?)`)
    .run(post.id, post.title, post.content_md, post.content_html, post.category || '', post.tags || '', req.session.user.id);
  db.prepare(`UPDATE posts SET title=?,content_md=?,content_html=?,category=?,tags=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(rev.title, rev.content_md, rev.content_html, rev.category || '', rev.tags || '', post.id);
  res.redirect('/posts/' + post.slug);
});

// ── Helpers ────────────────────────────────────────────────────
function _canEdit(user, post) {
  return user && (user.id === post.author_id || (user.role || 0) > LEVEL.MOD);
}
function _forbidden(res) {
  return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
}

module.exports = router;
