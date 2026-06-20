// Post routes — forum, single post, CRUD, revisions.
const api = require('../lib/res');
const auth = require('../lib/auth');
const express = require('express');
const postService = require('../service/post');
const { postRepo, categoryRepo, subCategoryRepo, sectionFollowRepo, sectionSubModRepo, userRepo } = require('../repo');
const config = require('../config');
const time = require('../util/time');
const xpRepo = require('../repo/xp');
const { getInfoPages } = require('../lib/view-data');

const router = express.Router();

// Helper: check section moderation (owner, sub-mod, or global MOD+)
function canMod(user, section) {
  if (!user || !section) return false;
  const isSub = sectionSubModRepo.isSubMod(section.id, user.id);
  return auth.canModerateSection(user, section, isSub);
}

router.get('/', (req, res) => {
  res.render('page/home', { title: 'Ntopia', infoPages: getInfoPages() });
});

// Forum main — show sections with pagination
router.get('/forum', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const { sections, total, totalPages } = postRepo.forumSections({ page, limit: config.PAGE_SIZE });
  const user = req.session.user;
  res.render('page/forum', {
    title: '论坛', sections, page, totalPages,
    followedSections: user ? sectionFollowRepo.listByUser(user.id, 10) : [],
  });
});

// All forum sections with pagination (must be before /forum/:id(\\d+))
router.get('/forum/sections', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const r = postService.listForumSections(page);
  res.render('page/forum-sections', {
    title: '全部板块', sections: r.sections,
    page: r.page, totalPages: r.totalPages
  });
});

// Forum section — show posts in a section
router.get('/forum/:id(\\d+)', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const sort = req.query.sort || 'newest';
  const subCat = req.query.sub || '';
  const featured = req.query.featured === '1';
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).render('page/404', { title: '404' });
  const r = postService.listPosts(parseInt(req.params.id), sort, page, { subCategory: subCat, isFeatured: featured });
  const user = req.session.user;
  const subCategories = subCategoryRepo.listWithCounts(section.id);
  const sectionTotal = categoryRepo.countPosts(section.id);
  // Fetch moderator and sub-mod user info for section header
  const sectionMod = section.moderator_id ? userRepo.findById(section.moderator_id) : null;
  const sectionSubMods = sectionSubModRepo.listBySection(section.id);
  const sectionSubModIds = new Set(sectionSubMods.map(m => m.id));
  res.render('page/index', {
    title: section.name, ...r, sort, subCat, featured,
    section, subCategories, sectionTotal,
    sectionFollowed: user ? sectionFollowRepo.isFollowing(user.id, section.id) : false,
    followerCount: sectionFollowRepo.countFollowers(section.id),
    isSectionMod: user ? canMod(user, section) : false,
    sectionMod, sectionSubMods,
    sectionModId: section.moderator_id,
    sectionSubModIds,
  });
});

// Create forum section (level >= 5 or MOD+)
router.post('/forum/sections', auth.requireAuth, (req, res) => {
  if (!auth.canCreateSection(req.session.user))
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/forum' });
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.redirect('/forum');
  const newId = categoryRepo.create(name.trim(), description || '');
  categoryRepo.setModerator(newId, req.session.user.id);
  res.redirect('/forum');
});

// Edit forum section (moderator or MOD+)
router.post('/forum/:id(\\d+)/edit', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).render('page/404', { title: '404' });
  if (!canMod(req.session.user, section))
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '只有版主或Mod才能编辑板块', back: '/forum' });
  if (req.body.name) categoryRepo.update(section.id, req.body.name, req.body.description || '');
  res.redirect('/forum/' + req.params.id);
});

// Delete section (moderator or MOD+) — only if no posts
router.post('/forum/:id(\\d+)/delete', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.json(api.err('板块不存在', 404));
  if (!canMod(req.session.user, section))
    return res.json(api.err('权限不足', 403));
  const postCount = categoryRepo.countPosts(section.id);
  if (postCount > 0) return res.json(api.err('板块内有 ' + postCount + ' 篇文章，无法删除', 400));
  categoryRepo.deleteCascade(section.id);
  res.json(api.ok({}));
});

// Upload section image (moderator or MOD+)
router.post('/forum/:id(\\d+)/image', auth.requireAuth, async (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.json({ ok: false, error: '板块不存在' });
  if (!canMod(req.session.user, section))
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
  const fileService = require('../service/file');
  const result = await fileService.processImage(file.path, file.originalname);
  if (!result.ok) return res.json(result);
  categoryRepo.setImage(section.id, result.url);
  res.json({ ok: true, url: result.url });
});

router.get('/drafts', auth.requireAuth, (req, res) => {
  const r = postService.listDrafts(req.session.user.id, parseInt(req.query.page) || 1);
  res.render('page/drafts', { title: '我的草稿', drafts: r.drafts, draftPage: r.page, draftTotalPages: r.totalPages });
});

router.get('/posts/:id(\\d+)', (req, res) => {
  const r = postService.getPost(req.params.id, req.session.user, { cookieHeader: req.headers.cookie || '' });
  if (r.notFound) return res.status(404).render('page/404', { title: '404' });
  if (r.post._trackView) {
    const m = (req.headers.cookie || '').match(/(?:^|;\s*)ntopia_views=([^;]*)/);
    const viewed = m ? m[1].split(',') : [];
    viewed.push(String(r.post.id)); if (viewed.length > 20) viewed.shift();
    res.cookie('ntopia_views', viewed.join(','), { maxAge: 86400000, httpOnly: true, sameSite: 'lax' });
  }
  // Section staff info for in-section display (post author + comments)
  let sectionModId = null;
  let sectionSubModIds = new Set();
  if (r.post.category_id) {
    const sec = categoryRepo.findById(r.post.category_id);
    if (sec) {
      sectionModId = sec.moderator_id;
      sectionSubModIds = new Set(sectionSubModRepo.listBySection(sec.id).map(m => m.id));
    }
  }
  res.render('page/post', {
    title: r.post.title, post: r.post, comments: r.comments, toc: r.toc,
    cmtPage: parseInt(req.query.cp) || 1, metaDesc: r.metaDesc, bibtex: r.bibtex,
    userLiked: r.userLiked, userBookmarked: r.userBookmarked,
    likeCount: r.likeCount, bookmarkCount: r.bookmarkCount,
    sectionModId, sectionSubModIds,
  });
});

router.get('/new-post', auth.requireActive, (req, res) => {
  const cat = req.query.cat || '';
  if (!cat) return res.redirect('/forum');
  const section = categoryRepo.findById(parseInt(cat));
  if (!section) return res.redirect('/forum');
  const presetSub = req.query.sub || '';
  res.render('page/editor', {
    title: '发帖', post: null,
    presetCategory: section.id, sectionName: section.name,
    presetSubCategory: presetSub, subCategories: subCategoryRepo.listBySection(section.id),
  });
});

router.post('/new-post', auth.requireActive, async (req, res) => {
  const { title, content, category, sub_category } = req.body;
  const isDraft = req.body.is_draft === '1';
  const r = await postService.createPost(
    { title, content, category: parseInt(category) || null, subCategory: sub_category || '', isDraft }, req.session.user);
  if (!r.ok) {
    if (r.banned) {
      userRepo.ban(req.session.user.id, time.sqlFromNow(r.banDuration));
      return res.status(403).render('page/error', { title: '错误', code: 403, message: '内容审核未通过', detail: r.error, back: '/' });
    }
    return res.status(400).render('page/error', { title: '错误', code: 400, message: r.error, detail: '', back: '/' });
  }
  if (isDraft) return res.redirect('/drafts');
  const u = xpRepo.getRefreshed(req.session.user.id);
  req.session.user.xp = u.xp; req.session.user.level = u.level; req.session.save();
  res.redirect('/posts/' + r.id);
});

router.get('/posts/:id(\\d+)/edit', auth.requireAuth, (req, res) => {
  const p = postRepo.findByIdAny(req.params.id);
  const secEdit = p && p.category_id ? categoryRepo.findById(p.category_id) : null;
  const isSecMod = secEdit ? canMod(req.session.user, secEdit) : false;
  if (!auth.canEditPost(req.session.user, p, isSecMod, p.role)) return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  res.render('page/editor', { title: '编辑文章', post: p, presetCategory: p.category_id, subCategories: subCategoryRepo.listBySection(p.category_id) });
});

router.post('/posts/:id(\\d+)/edit', auth.requireAuth, (req, res) => {
  const { title, content, category, sub_category } = req.body;
  const isDraft = req.body.is_draft === '1';
  const r = postService.editPost(req.params.id,
    { title, content, category: parseInt(category) || null, subCategory: sub_category || '', isDraft }, req.session.user);
  if (!r.ok) return res.status(403).render('page/error', { title: '错误', code: 403, message: r.error, detail: '', back: '/' });
  res.redirect(isDraft ? '/drafts' : '/posts/' + r.id);
});

router.get('/posts/:id(\\d+)/download', (req, res) => {
  const post = postService.getDownloadData(req.params.id);
  if (!post) return res.status(404).json(api.err('Not Found', 404));
  const author = post.display_name || post.username;
  const fn = encodeURIComponent(post.title.slice(0, 40).replace(/[/\\?*:|"<>]/g, '')) + '.md';
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${fn}`);
  res.send(`---\ntitle: ${post.title}\nauthor: ${author}\ndate: ${post.created_at}\n---\n\n${post.content_md}`);
});

router.post('/posts/:id(\\d+)/delete-self', auth.requireAuth, (req, res) => {
  const r = postService.deletePost(req.params.id, req.session.user);
  if (!r.ok) return res.status(403).render('page/error', { title: '错误', code: 403, message: r.error, detail: '', back: '/' });
  res.redirect('/drafts');
});

router.get('/posts/:id(\\d+)/revisions', auth.requireAuth, (req, res) => {
  const d = postService.getRevisions(req.params.id, req.session.user);
  if (!d) return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '', back: '/' });
  res.render('page/revisions', { title: '编辑历史', post: d.post, revisions: d.revisions });
});

router.post('/posts/:id(\\d+)/restore/:revId', auth.requireAuth, (req, res) => {
  const r = postService.restoreRevision(req.params.id, req.params.revId, req.session.user);
  if (!r.ok) return res.status(403).json(api.err(r.error, 403));
  res.json(api.redirect('/posts/' + req.params.id));
});

// Toggle featured (精华) — section mod or MOD+
router.post('/posts/:id(\\d+)/toggle-featured', auth.requireAuth, (req, res) => {
  const p = postRepo.findByIdAny(req.params.id);
  if (!p) return res.json(api.err('文章不存在', 404));
  const section = p.category_id ? categoryRepo.findById(p.category_id) : null;
  if (!canMod(req.session.user, section))
    return res.json(api.err('权限不足', 403));
  postRepo.toggleFeatured(p.id, p.is_featured);
  res.json(api.ok({ featured: !p.is_featured }));
});

// Toggle pin (置顶) — section mod or MOD+
router.post('/posts/:id(\\d+)/toggle-pin', auth.requireAuth, (req, res) => {
  const p = postRepo.findByIdAny(req.params.id);
  if (!p) return res.json(api.err('文章不存在', 404));
  const section = p.category_id ? categoryRepo.findById(p.category_id) : null;
  if (!canMod(req.session.user, section))
    return res.json(api.err('权限不足', 403));
  postRepo.togglePin(p.id, p.is_pinned);
  res.json(api.ok({ pinned: !p.is_pinned }));
});

// ── Section follow ────────────────────────────────────────────────
router.post('/forum/:id(\\d+)/follow', auth.requireAuthAPI, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.json(api.err('板块不存在', 404));
  const r = sectionFollowRepo.toggle(req.session.user.id, section.id);
  res.json(api.ok({ following: r.following, count: sectionFollowRepo.countFollowers(section.id) }));
});

router.get('/forum/:id(\\d+)/followers', (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).render('page/404', { title: '404' });
  const followers = sectionFollowRepo.listFollowers(section.id);
  res.render('page/followers', { title: section.name + ' 的关注者', followers, section });
});

// ── Section sub-moderator management ──────────────────────────────
// List moderators (owner + sub-mods)
router.get('/forum/:id(\\d+)/mods', (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  const subMods = sectionSubModRepo.listBySection(section.id);
  const owner = section.moderator_id ? userRepo.findById(section.moderator_id) : null;
  res.json(api.ok({ owner, subMods }));
});

// Add sub-moderator (only section owner)
router.post('/forum/:id(\\d+)/mods', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  if (!auth.isSectionOwner(req.session.user, section))
    return res.status(403).json(api.err('仅大版主可提拔小版主', 403));
  const { username } = req.body;
  if (!username) return res.json(api.err('请输入用户名', 400));
  const target = userRepo.findByUsername(username.toLowerCase());
  if (!target) return res.json(api.err('用户不存在', 404));
  if (target.id === section.moderator_id) return res.json(api.err('不能提拔大版主自己', 400));
  sectionSubModRepo.add(section.id, target.id);
  res.json(api.ok({ id: target.id, username: target.username }));
});

// Remove sub-moderator (only section owner)
router.post('/forum/:id(\\d+)/mods/:userId/remove', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  if (!auth.isSectionOwner(req.session.user, section))
    return res.status(403).json(api.err('仅大版主可解雇小版主', 403));
  sectionSubModRepo.remove(section.id, parseInt(req.params.userId));
  res.json(api.ok({}));
});

// Transfer moderator ownership (only section owner)
router.post('/forum/:id(\\d+)/transfer', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  if (!auth.isSectionOwner(req.session.user, section))
    return res.status(403).json(api.err('仅大版主或超级管理员可转让', 403));
  const { username } = req.body;
  if (!username) return res.json(api.err('请输入用户名', 400));
  const target = userRepo.findByUsername(username.toLowerCase());
  if (!target) return res.json(api.err('用户不存在', 404));
  if (target.id === section.moderator_id) return res.json(api.err('不能转让给自己', 400));
  // Transfer: set new moderator, demote old owner to sub-mod
  categoryRepo.setModerator(section.id, target.id);
  sectionSubModRepo.remove(section.id, target.id); // remove from sub-mods if present
  sectionSubModRepo.add(section.id, req.session.user.id); // old owner becomes sub-mod
  res.json(api.ok({ newOwner: { id: target.id, username: target.username } }));
});

// ── Section settings ──────────────────────────────────────────────
router.get('/forum/:id(\\d+)/settings', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).render('page/404', { title: '404' });
  if (!canMod(req.session.user, section))
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '仅版主可编辑板块设置', back: '/forum/' + section.id });
  res.render('page/section-settings', {
    title: '板块设置 — ' + section.name, section,
    isOwner: auth.isSectionOwner(req.session.user, section),
    subMods: sectionSubModRepo.listBySection(section.id),
    subCats: subCategoryRepo.listWithCounts(section.id),
  });
});

router.post('/forum/:id(\\d+)/settings', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).render('page/404', { title: '404' });
  if (!canMod(req.session.user, section))
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '', back: '/forum/' + section.id });
  const { name, description } = req.body;
  if (name && name.trim()) categoryRepo.update(section.id, name, description || '');
  res.redirect('/forum/' + req.params.id);
});

router.post('/forum/:id(\\d+)/settings/image', auth.requireAuth, async (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.json(api.err('板块不存在', 404));
  if (!canMod(req.session.user, section))
    return res.json(api.err('权限不足', 403));
  const multer = require('multer');
  const path = require('path');
  const upload = multer({
    storage: multer.diskStorage({ destination: config.UPLOADS_DIR, filename: (r, f, cb) => cb(null, 'section-' + section.id + '-' + Date.now() + path.extname(f.originalname)) }),
    limits: { fileSize: config.MAX_IMAGE_SIZE },
    fileFilter: (r, f, cb) => { const ext = path.extname(f.originalname).toLowerCase(); cb(null, config.ALLOWED_IMAGE_MIME.includes(f.mimetype) && config.ALLOWED_IMAGE_EXT.includes(ext)); },
  }).single('image');
  try {
    const data = await new Promise((resolve) => {
      upload(req, res, (e) => {
        if (e) return resolve({ error: e.message });
        if (!req.file) return resolve({ error: '请选择文件' });
        resolve({ file: req.file });
      });
    });
    if (data.error) return res.json(api.err(data.error, 400));
    const fileService = require('../service/file');
    const result = await fileService.processImage(data.file.path, data.file.originalname);
    if (!result.ok) return res.json({ ok: false, error: result.error });
    categoryRepo.setImage(section.id, result.url);
    res.json({ ok: true, url: result.url });
  } catch (e) {
    console.error('[section-image]', e);
    res.json({ ok: false, error: '上传失败: ' + (e.message || 'unknown') });
  }
});

// ── Sub-category management ───────────────────────────────────────
// List sub-categories for a section (with post counts)
router.get('/forum/:id(\\d+)/subcats', (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  res.json(api.ok(subCategoryRepo.listWithCounts(section.id)));
});

// Create sub-category (moderator or MOD+)
router.post('/forum/:id(\\d+)/subcats', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  if (!canMod(req.session.user, section))
    return res.status(403).json(api.err('权限不足', 403));
  const { name } = req.body;
  if (!name || !name.trim()) return res.json(api.err('名称不能为空', 400));
  subCategoryRepo.create(section.id, name.trim());
  res.json(api.ok({ name: name.trim() }));
});

// Edit sub-category (moderator or MOD+)
router.post('/forum/:id(\\d+)/subcats/:subCat/edit', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  if (!canMod(req.session.user, section))
    return res.status(403).json(api.err('权限不足', 403));
  const sc = subCategoryRepo.findById(parseInt(req.params.subCat));
  if (!sc) return res.status(404).json(api.err('分类不存在', 404));
  const { name } = req.body;
  if (!name || !name.trim()) return res.json(api.err('名称不能为空', 400));
  subCategoryRepo.update(sc.id, name.trim());
  res.json(api.ok({}));
});

// Delete sub-category (moderator or MOD+) — blocked if posts exist
router.post('/forum/:id(\\d+)/subcats/:subCat/delete', auth.requireAuth, (req, res) => {
  const section = categoryRepo.findById(parseInt(req.params.id));
  if (!section) return res.status(404).json(api.err('板块不存在', 404));
  if (!canMod(req.session.user, section))
    return res.status(403).json(api.err('权限不足', 403));
  const sc = subCategoryRepo.findById(parseInt(req.params.subCat));
  if (!sc) return res.status(404).json(api.err('分类不存在', 404));
  const postCount = subCategoryRepo.countPosts(section.id, sc.name);
  if (postCount > 0) return res.json(api.err('该分类下有 ' + postCount + ' 篇文章，无法删除', 400));
  subCategoryRepo.delete(sc.id);
  res.json(api.ok({}));
});

module.exports = router;
