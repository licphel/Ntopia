const { LEVEL, canPost, canEdit, canDelete, canManageUser } = require('../lib/perm');
const express = require('express');
const { renderMarkdown, slugify, computeDepth, extractTOC, injectHeadingIds, firstNLines } = require('../lib/helpers');
const { db, awardPostXP } = require('../lib/db');
const { LICENSES, licenseText } = require('../lib/license');
const time = require('../lib/time');
const router = express.Router();





// My drafts
router.get('/drafts', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const drafts = db.prepare(`
    SELECT * FROM posts WHERE author_id = ? AND is_draft = 1 AND is_deleted = 0
    ORDER BY updated_at DESC LIMIT ? OFFSET ?
  `).all(req.session.user.id, limit, (page - 1) * limit);
  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE author_id = ? AND is_draft = 1 AND is_deleted = 0').get(req.session.user.id);
  res.render('drafts', { title: '我的草稿', drafts, draftPage: page, draftTotalPages: Math.ceil(total.c / limit) });
});

// Homepage — blog listing
router.get('/', (req, res) => {
  const cat = req.query.cat || '';
  const page = parseInt(req.query.page) || 1;
  const sort = req.query.sort || 'newest';
  const limit = 10;
  const offset = (page - 1) * limit;

  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();

  let posts, total;
  const baseQuery = `SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
        COALESCE(cat.name, p.category) as category_name,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug
    WHERE (p.is_deleted = 0 OR p.is_deleted IS NULL) AND p.is_draft = 0`;
  const catFilter = cat ? 'AND p.category = ?' : '';
  const catParam = cat ? [cat] : [];
  if (cat) {
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE category = ? AND is_deleted = 0").get(cat);
  } else {
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0").get();
  }

  if (sort === 'replies') {
    posts = db.prepare(`${baseQuery} ${catFilter} ORDER BY p.is_pinned DESC, comment_count DESC LIMIT ? OFFSET ?`).all(...catParam, limit, offset);
  } else if (sort === 'hot') {
    const hotNow = time.toSQL().split(' ')[0];
    posts = db.prepare(`
      SELECT * FROM (${baseQuery} ${catFilter})
      ORDER BY is_pinned DESC, (comment_count * 3.0 + view_count * 0.1) / ((julianday(?) - julianday(created_at)) * 24.0 + 4.0) DESC
      LIMIT ? OFFSET ?
    `).all(...catParam, hotNow, limit, offset);
  } else {
    posts = db.prepare(`${baseQuery} ${catFilter} ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`).all(...catParam, limit, offset);
  }

  const totalPages = Math.ceil(total.c / limit);

  // Generate preview from first 5 lines of rendered HTML
  posts.forEach(p => { p.preview_html = firstNLines(p.content_html, 5); });

  res.render('index', { title: '首页', posts, page, totalPages, sort, categories, currentCat: cat });
});

// Single blog post
router.get('/posts/:slug', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
      COALESCE(cat.name, p.category) as category_name,
      (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug
    WHERE p.slug = ? AND p.is_draft = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  if (post.is_deleted && post.author_id !== (req.session.user ? req.session.user.id : 0) && (req.session.user ? (req.session.user.role || 0) : 0) < 128) return res.status(404).render('404', { title: '404' });

  // View count dedup via cookie — only count once per post per day
  const viewedKey = 'ntopia_views';
  const viewedCookie = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${viewedKey}=([^;]*)`));
  const viewed = viewedCookie ? viewedCookie[1].split(',') : [];
  if (!viewed.includes(String(post.id))) {
    db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(post.id);
    post.view_count += 1;
    viewed.push(String(post.id));
    // Keep only last 20, cookie expires in 24h
    if (viewed.length > 20) viewed.shift();
    res.cookie(viewedKey, viewed.join(','), { maxAge: 24 * 3600 * 1000, httpOnly: true, sameSite: 'lax' });
  }

  // Like & bookmark status for current user
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

  // SEO meta description
  const metaDesc = post.content_md.replace(/[#*`>\[\]()!~|\\]/g,'').replace(/\s+/g,' ').trim().slice(0, 160);

  // BibTeX citation
  const siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  const authorName = post.display_name || post.username;
  const postYear = new Date(post.created_at).getFullYear();
  const citeKey = 'ntopia-' + (post.username || 'anon') + '-' + post.slug.slice(-8);
  const todayStr = require('../lib/time').now().toISOString().slice(0, 10);
  const bibtex = `@misc{${citeKey},
  author = {${authorName}},
  title = {${post.title}},
  year = {${postYear}},
  howpublished = {\\url{${siteUrl}/posts/${post.slug}}},
  note = {Accessed: ${todayStr}}
}`;

  const cmtPage = parseInt(req.query.cp) || 1;
  res.render("post", { title: post.title, post, comments, toc: toc.length > 1 ? toc : null, cmtPage, metaDesc, bibtex, userLiked, userBookmarked, likeCount, bookmarkCount });
});

// Create post page — uses category dropdown
router.get('/new-post', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (user && (user.banned || !user.email)) return res.status(403).render('error', { title: '错误', code: 403, message: '账号受限', detail: user.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  res.render('editor', { title: '撰写文章', post: null, type: 'post', categories, canPost: true, licenses: LICENSES });
});

// Create post POST
router.post('/new-post', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (user && (user.banned || !user.email)) return res.status(403).render('error', { title: '错误', code: 403, message: '账号受限', detail: user.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  const { title, category, tags, content, license } = req.body;
  // Validate license against whitelist
  const validLicense = LICENSES.some(l => l.key === license) ? (license || '') : '';
  const is_draft = req.body.is_draft === '1' ? 1 : 0;
  const slug = slugify(title) + '-' + time.now().getTime();
  const html = renderMarkdown(content);

  // AI moderation on first publish (not draft). Admin+ exempt.
  if (!is_draft && (req.session.user.role || 0) < LEVEL.ADMIN) {
    const { review } = require('../lib/moderation');
    const result = await review(title, content, category || '');
    if (!result.pass) {
      // Ban user for 1 hour
      db.prepare("UPDATE users SET banned = 1, banned_until = ? WHERE id = ?").run(time.sqlFromNow('+1 hour'), req.session.user.id);
      //req.session.user = null;
      return res.status(403).render('error', { title: '错误', code: 403, message: '内容审核未通过', detail: `你的文章未通过审核：${result.reason}。账号已被封禁1小时。`, back: '/' });
    }
  }

  db.prepare(`INSERT INTO posts (title, slug, content_md, content_html, category, tags, author_id, is_draft, license)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(title, slug, content, html, category || '', tags || '', req.session.user.id, is_draft, validLicense);
  const post = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
  if (is_draft) {
    res.redirect('/drafts');
  } else {
    awardPostXP(req.session.user.id, post.id);
    req.session.user.xp = (req.session.user.xp || 0) + 3;
    res.redirect('/posts/' + slug);
  }
});

// Edit post
router.get('/posts/:slug/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= LEVEL.MOD)) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order").all();
  res.render('editor', { title: '编辑文章', post, type: 'post', categories, canPost: true, licenses: LICENSES });
});

router.post('/posts/:slug/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= LEVEL.MOD)) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  const { title, content, category, tags, license } = req.body;
  const validLicense = LICENSES.some(l => l.key === license) ? (license || '') : '';
  const is_draft = req.body.is_draft === '1' ? 1 : 0;
  const html = renderMarkdown(content);

  // Save revision before updating
  db.prepare(`INSERT INTO post_revisions (post_id, title, content_md, content_html, category, tags, revised_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(post.id, post.title, post.content_md, post.content_html, post.category || '', post.tags || '', req.session.user.id);
  db.prepare(`DELETE FROM post_revisions WHERE id IN (
    SELECT id FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 10
  )`).run(post.id);

  db.prepare(`UPDATE posts SET title=?, content_md=?, content_html=?, category=?, tags=?, is_draft=?, license=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(title, content, html, category || '', tags || '', is_draft, validLicense, post.id);
  res.redirect(is_draft ? '/drafts' : '/posts/' + post.slug);
});

// Download post as Markdown
router.get('/posts/:slug/download', (req, res) => {
  const post = db.prepare(`
    SELECT p.title, p.content_md, p.license, p.created_at, u.display_name, u.username
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.is_deleted = 0 AND p.is_draft = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  const author = post.display_name || post.username;
  const siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  const header = `---\ntitle: ${post.title}\nauthor: ${author}\ndate: ${post.created_at}\n---\n\n`;
  const footer = '\n\n---\n\n' + licenseText(post.license || '', { author, year: new Date(post.created_at).getFullYear(), url: siteUrl + '/posts/' + req.params.slug });
  const filename = encodeURIComponent(post.title.slice(0, 40).replace(/[/\\?*:|"<>]/g, '')) + '.md';
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
  res.send(header + post.content_md + footer);
});

// Delete own post (author or admin)
router.post('/posts/:slug/delete-self', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  if (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= LEVEL.MOD) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
  res.redirect('/');
});


// View revisions for a post
router.get('/posts/:slug/revisions', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  if (post.author_id !== req.session.user.id && (req.session.user.role || 0) < 32)
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '', back: '/' });
  const revisions = db.prepare('SELECT r.*, u.username, u.display_name FROM post_revisions r JOIN users u ON r.revised_by = u.id WHERE r.post_id = ? ORDER BY r.created_at DESC').all(post.id);
  res.render('revisions', { title: '编辑历史: ' + post.title, post, revisions });
});

// Restore a revision
router.post('/posts/:slug/restore/:revId', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ?').get(req.params.slug);
  if (!post || (post.author_id !== req.session.user.id && (req.session.user.role || 0) < 32))
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '', back: '/' });
  const rev = db.prepare('SELECT * FROM post_revisions WHERE id = ? AND post_id = ?').get(req.params.revId, post.id);
  if (!rev) return res.status(404).render('404', { title: '404' });
  // Save current as revision, then restore
  db.prepare(`INSERT INTO post_revisions (post_id, title, content_md, content_html, category, tags, revised_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(post.id, post.title, post.content_md, post.content_html, post.category || '', post.tags || '', req.session.user.id);
  db.prepare(`UPDATE posts SET title=?, content_md=?, content_html=?, category=?, tags=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(rev.title, rev.content_md, rev.content_html, rev.category || '', rev.tags || '', post.id);
  res.redirect('/posts/' + post.slug);
});

module.exports = router;
