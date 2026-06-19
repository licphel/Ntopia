// Post routes — blog, forum, single post, CRUD, revisions.
const api = require('../lib/res');
const auth = require('../lib/auth');
const { sidebarData } = require('../lib/view-data');
const express = require('express');
const postService = require('../service/post');
const { postRepo, categoryRepo } = require('../repo');
const { LICENSES, licenseText } = require('../lib/license');
const config = require('../config');
const time = require('../util/time');
const xpRepo = require('../repo/xp');

const router = express.Router();

router.get('/', (req, res) => res.redirect('/forum'));

router.get('/blog', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const sort = req.query.sort || 'newest';
  const cat  = req.query.cat || '';
  const r = postService.listPosts(cat, sort, page, { categoryType: 'blog' });
  res.render('page/index', { title: '博客', ...r, sort, categories: categoryRepo.all('blog'), currentCat: cat, isBlog: true, ...sidebarData() });
});

// Forum main — show sections with pagination
router.get('/forum', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const { sections, total, totalPages } = postRepo.forumSections({ page, limit: config.PAGE_SIZE });
  res.render('page/forum', {
    title: '论坛', sections, page, totalPages, ...sidebarData(),
  });
});

// All forum sections with pagination (must be before /forum/:section)
router.get('/forum/sections', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const r = postService.listForumSections(page);
  res.render('page/forum-sections', {
    title: '全部板块', sections: r.sections,
    page: r.page, totalPages: r.totalPages, ...sidebarData(),
  });
});

// Forum section — show posts in a section
router.get('/forum/:section', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const sort = req.query.sort || 'newest';
  const section = categoryRepo.findBySlug(req.params.section);
  if (!section) return res.status(404).render('page/404', { title: '404' });
  const r = postService.listPosts(req.params.section, sort, page, { categoryType: 'forum' });
  res.render('page/index', {
    title: section.name, ...r, sort,
    section, isForum: true, ...sidebarData(),
  });
});

// Create forum section (level >= 5 or MOD+)
router.post('/forum/sections', auth.requireAuth, (req, res) => {
  if (!auth.canCreateSection(req.session.user))
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '需要等级5或Mod权限才能创建板块', back: '/forum' });
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.redirect('/forum');
  categoryRepo.create(name.trim(), require('../util/slug').slugify(name) + '-' + Date.now(), description || '', 'forum');
  // Set creator as moderator
  const db = require('../database').getDB();
  const slug = require('../util/slug').slugify(name) + '-' + Date.now();
  db.prepare('UPDATE categories SET moderator_id = ? WHERE slug = ?').run(req.session.user.id, slug);
  res.redirect('/forum');
});

// Edit forum section (moderator or MOD+)
router.post('/forum/:section/edit', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findBySlug(req.params.section);
  if (!section) return res.status(404).render('page/404', { title: '404' });
  if (!auth.canModerateSection(req.session.user, section))
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '只有版主或Mod才能编辑板块', back: '/forum' });
  const db = require('../database').getDB();
  if (req.body.name) db.prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(req.body.name.trim(), (req.body.description || '').trim(), section.id);
  res.redirect('/forum/' + req.params.section);
});

// Upload section image (moderator or MOD+)
router.post('/forum/:section/image', auth.requireAuth, async (req, res) => {
  const section = categoryRepo.findBySlug(req.params.section);
  if (!section) return res.json({ ok: false, error: '板块不存在' });
  if (!auth.canModerateSection(req.session.user, section))
    return res.json({ ok: false, error: '权限不足' });
  const multer = require('multer');
  const path = require('path');
  const upload = multer({
    storage: multer.diskStorage({ destination: config.UPLOADS_DIR, filename: (r, f, cb) => cb(null, 'section-' + section.id + '-' + Date.now() + path.extname(f.originalname)) }),
    limits: { fileSize: config.MAX_IMAGE_SIZE },
    fileFilter: (r, f, cb) => { const ext = path.extname(f.originalname).toLowerCase(); cb(null, config.ALLOWED_IMAGE_MIME.includes(f.mimetype) && config.ALLOWED_IMAGE_EXT.includes(ext)); },
  }).single('image');
  const file = await new Promise((res, rej) => upload(req, res, (e) => e ? rej(e) : res(req.file)));
  if (!file) return res.json({ ok: false, error: '请选择文件' });
  const { fileService } = require('../service/file');
  const result = await fileService.processImage(file.path, file.originalname);
  if (!result.ok) return res.json(result);
  require('../database').getDB().prepare('UPDATE categories SET image = ? WHERE id = ?').run(result.url, section.id);
  res.json({ ok: true, url: result.url });
});

router.get('/drafts', auth.requireAuth, (req, res) => {
  const r = postService.listDrafts(req.session.user.id, parseInt(req.query.page) || 1);
  res.render('page/drafts', { title: '我的草稿', drafts: r.drafts, draftPage: r.page, draftTotalPages: r.totalPages });
});

router.get('/posts/:slug', (req, res) => {
  const r = postService.getPost(req.params.slug, req.session.user, { cookieHeader: req.headers.cookie || '' });
  if (r.notFound) return res.status(404).render('page/404', { title: '404' });
  if (r.post._trackView) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)ntopia_views=([^;]*)/);
    const viewed = m ? m[1].split(',') : [];
    viewed.push(String(r.post.id)); if (viewed.length > 20) viewed.shift();
    res.cookie('ntopia_views', viewed.join(','), { maxAge: 86400000, httpOnly: true, sameSite: 'lax' });
  }
  res.render('page/post', {
    title: r.post.title, post: r.post, comments: r.comments, toc: r.toc,
    cmtPage: parseInt(req.query.cp) || 1, metaDesc: r.metaDesc, bibtex: r.bibtex,
    userLiked: r.userLiked, userBookmarked: r.userBookmarked,
    likeCount: r.likeCount, bookmarkCount: r.bookmarkCount,
  });
});

router.get('/new-post', auth.requireActive, (req, res) => {
  const isForum = req.query.cat === 'forum' || (req.query.cat && categoryRepo.findBySlug(req.query.cat)?.type === 'forum');
  const presetCategory = req.query.cat || '';
  res.render('page/editor', {
    title: isForum ? '发帖' : '撰写文章', post: null,
    categories: categoryRepo.all(isForum ? 'forum' : 'blog'),
    licenses: LICENSES, isForum, presetCategory,
  });
});

router.post('/new-post', auth.requireActive, async (req, res) => {
  const { title, content, category, tags, license } = req.body;
  // Strip tags for forum posts — forums don't use tags
  const catMeta = category ? categoryRepo.findBySlug(category) : null;
  const finalTags = (catMeta && catMeta.type === 'forum') ? '' : (tags || '');
  const isDraft = req.body.is_draft === '1';
  const r = await postService.createPost(
    { title, content, category, tags: finalTags, license, isDraft }, req.session.user);
  if (!r.ok) {
    if (r.banned) {
      require('../database').getDB().prepare("UPDATE users SET banned=1,banned_until=? WHERE id=?")
        .run(time.sqlFromNow(r.banDuration), req.session.user.id);
      return res.status(403).render('page/error', { title: '错误', code: 403, message: '内容审核未通过', detail: r.error, back: '/' });
    }
    return res.status(400).render('page/error', { title: '错误', code: 400, message: r.error, detail: '', back: '/' });
  }
  if (isDraft) return res.redirect('/drafts');
  const u = xpRepo.getRefreshed(req.session.user.id);
  req.session.user.xp = u.xp; req.session.user.level = u.level; req.session.save();
  res.redirect('/posts/' + r.slug);
});

router.get('/posts/:slug/edit', auth.requireAuth, (req, res) => {
  const p = postRepo.findBySlugAny(req.params.slug);
  if (!auth.canEditPost(req.session.user, p)) return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  const isForum = categoryRepo.findBySlug(p.category)?.type === 'forum';
  res.render('page/editor', { title: '编辑文章', post: p, categories: categoryRepo.all(isForum ? 'forum' : 'blog'), licenses: LICENSES, isForum, presetCategory: p.category });
});

router.post('/posts/:slug/edit', auth.requireAuth, (req, res) => {
  const { title, content, category, tags, license } = req.body;
  // Strip tags for forum posts — forums don't use tags
  const catMeta = category ? categoryRepo.findBySlug(category) : null;
  const finalTags = (catMeta && catMeta.type === 'forum') ? '' : (tags || '');
  const isDraft = req.body.is_draft === '1';
  const r = postService.editPost(req.params.slug,
    { title, content, category, tags: finalTags, license, isDraft }, req.session.user);
  if (!r.ok) return res.status(403).render('page/error', { title: '错误', code: 403, message: r.error, detail: '', back: '/' });
  res.redirect(isDraft ? '/drafts' : '/posts/' + r.slug);
});

router.get('/posts/:slug/download', (req, res) => {
  const post = postService.getDownloadData(req.params.slug);
  if (!post) return res.status(404).json(api.err('Not Found', 404));
  const author = post.display_name || post.username;
  const fn = encodeURIComponent(post.title.slice(0, 40).replace(/[/\\?*:|"<>]/g, '')) + '.md';
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${fn}`);
  res.send(`---\ntitle: ${post.title}\nauthor: ${author}\ndate: ${post.created_at}\n---\n\n${post.content_md}\n\n---\n\n${licenseText(post.license || '', { author, year: new Date(post.created_at).getFullYear(), url: config.SITE_URL + '/posts/' + req.params.slug })}`);
});

router.post('/posts/:slug/delete-self', auth.requireAuth, (req, res) => {
  const r = postService.deletePost(req.params.slug, req.session.user);
  if (!r.ok) return res.status(403).json(api.err(r.error, 403));
  res.json(api.redirect('/'));
});

router.get('/posts/:slug/revisions', auth.requireAuth, (req, res) => {
  const d = postService.getRevisions(req.params.slug, req.session.user);
  if (!d) return res.status(403).json(api.err('权限不足', 403));
  res.json(api.ok(d));
});

router.post('/posts/:slug/restore/:revId', auth.requireAuth, (req, res) => {
  const r = postService.restoreRevision(req.params.slug, req.params.revId, req.session.user);
  if (!r.ok) return res.status(403).json(api.err(r.error, 403));
  res.json(api.redirect('/posts/' + req.params.slug));
});

module.exports = router;
