const express = require('express');
const { marked } = require('marked');
const { db, addXP } = require('../db');
const router = express.Router();

marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(md) { return marked.parse(md || ''); }
function slugify(text) { return text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'untitled'; }

// Check if user can post a blog today
function canPostBlog(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const count = db.prepare("SELECT COUNT(*) as c FROM posts WHERE author_id = ? AND type = 'post' AND date(created_at) = ? AND is_deleted = 0").get(userId, today);
  return count.c === 0;
}

// Homepage — blog listing
router.get('/', (req, res) => {
  const cat = req.query.cat || '';
  const page = parseInt(req.query.page) || 1;
  const sort = req.query.sort || 'newest';
  const limit = 10;
  const offset = (page - 1) * limit;

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'blog' ORDER BY sort_order").all();

  let orderBy = 'p.created_at DESC';
  if (sort === 'replies') orderBy = 'comment_count DESC, p.created_at DESC';
  else if (sort === 'hot') orderBy = "(CAST(comment_count AS REAL) / MAX((julianday('now') - julianday(p.created_at)) * 24, 1)) DESC, p.created_at DESC";

  let posts, total;
  const baseQuery = `SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.type = 'post' AND p.is_deleted = 0`;
  if (cat) {
    posts = db.prepare(`${baseQuery} AND p.category = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(cat, limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'post' AND category = ? AND is_deleted = 0").get(cat);
  } else {
    posts = db.prepare(`${baseQuery} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'post' AND is_deleted = 0").get();
  }
  const totalPages = Math.ceil(total.c / limit);

  res.render('index', { title: '首页', posts, page, totalPages, sort, categories, currentCat: cat });
});

// Single blog post
router.get('/posts/:slug', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.type = 'post' AND p.is_deleted = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });

  db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(post.id);

  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(post.id);

  // Compute nesting depth
  const depthMap = {};
  function getDepth(c) {
    if (depthMap[c.id] !== undefined) return depthMap[c.id];
    if (!c.parent_id) { depthMap[c.id] = 0; return 0; }
    const parent = comments.find(x => x.id === c.parent_id);
    const d = parent ? getDepth(parent) + 1 : 0;
    depthMap[c.id] = Math.min(d, 5); // max 5 levels
    return depthMap[c.id];
  }
  comments.forEach(c => { c.depth = getDepth(c); });

  res.render('post', { title: post.title, post, comments });
});

// Create post page — uses category dropdown
router.get('/new-post', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned FROM users WHERE id = ?').get(req.session.user.id);
  if (user && user.banned) return res.status(403).render('error', { title: '错误', code: 403, message: '账号已被封禁', detail: '你的账号已被管理员封禁，无法执行此操作', back: '/' });
  const blogCats = db.prepare("SELECT * FROM categories WHERE type = 'blog' ORDER BY sort_order").all();
  res.render('editor', { title: '撰写文章', post: null, type: 'post', categories: blogCats, canPost: canPostBlog(req.session.user.id) });
});

// Create post POST
router.post('/new-post', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned FROM users WHERE id = ?').get(req.session.user.id);
  if (user && user.banned) return res.status(403).render('error', { title: '错误', code: 403, message: '账号已被封禁', detail: '你的账号已被管理员封禁，无法执行此操作', back: '/' });
  if (!canPostBlog(req.session.user.id)) {
    return res.status(429).render('error', { title: '错误', code: 429, message: '发布限制', detail: '每天只能发布一篇博客文章，请明天再试', back: '/' });
  }
  const { title, category, tags, excerpt, content } = req.body;
  const slug = slugify(title) + '-' + Date.now();
  const html = renderMarkdown(content);
  db.prepare(`INSERT INTO posts (title, slug, content_md, content_html, excerpt, category, tags, author_id, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'post')`)
    .run(title, slug, content, html, excerpt || '', category || '', tags || '', req.session.user.id);
  const post = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
  addXP(req.session.user.id, 3, '发布文章', post.id);
  req.session.user.xp = (req.session.user.xp || 0) + 3;
  res.redirect('/posts/' + slug);
});

// Edit post
router.get('/posts/:slug/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= 16)) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  const blogCats = db.prepare("SELECT * FROM categories WHERE type = 'blog' ORDER BY sort_order").all();
  res.render('editor', { title: '编辑文章', post, type: 'post', categories: blogCats, canPost: true });
});

router.post('/posts/:slug/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= 16)) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  const { title, category, tags, excerpt, content } = req.body;
  const html = renderMarkdown(content);
  db.prepare(`UPDATE posts SET title=?, content_md=?, content_html=?, excerpt=?, category=?, tags=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(title, content, html, excerpt || '', category || '', tags || '', post.id);
  res.redirect('/posts/' + post.slug);
});

// Add comment
router.post('/posts/:slug/comment', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned FROM users WHERE id = ?').get(req.session.user.id);
  if (user && user.banned) return res.status(403).render('error', { title: '错误', code: 403, message: '账号已被封禁', detail: '你的账号已被管理员封禁，无法执行此操作', back: '/' });
  const post = db.prepare('SELECT id, slug, type, author_id FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  const { content, parent_id } = req.body;
  const html = renderMarkdown(content);
  db.prepare('INSERT INTO comments (post_id, author_id, content_md, content_html, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(post.id, req.session.user.id, content, html, parent_id || null);
  const cmt = db.prepare('SELECT id FROM comments ORDER BY id DESC LIMIT 1').get();
  addXP(req.session.user.id, 1, '发表评论', cmt.id);
  req.session.user.xp = (req.session.user.xp || 0) + 1;

  const myName = req.session.user.display_name || req.session.user.username;

  // Notify post author (unless commenting on own post)
  if (post.author_id !== req.session.user.id) {
    db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'reply', ?, ?)`)
      .run(post.author_id,
        `${myName} 评论了你的${post.type === 'forum' ? '主题' : '文章'}`,
        '/' + (post.type === 'forum' ? 'forum/' : 'posts/') + post.slug);
  }

  // Notify parent comment author (nested reply)
  if (parent_id) {
    const parent = db.prepare('SELECT author_id FROM comments WHERE id = ?').get(parent_id);
    if (parent && parent.author_id !== req.session.user.id) {
      db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'reply', ?, ?)`)
        .run(parent.author_id,
          `${myName} 回复了你的评论`,
          '/' + (post.type === 'forum' ? 'forum/' : 'posts/') + post.slug);
    }
  }

  const redirectUrl = post.type === 'forum' ? '/forum/' + post.slug + '/comments' : '/posts/' + post.slug + '/comments';
  res.redirect(redirectUrl);
});

// Full comments page
router.get('/posts/:slug/comments', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.type = 'post' AND p.is_deleted = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });

  db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(post.id);

  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(post.id);

  const depthMap = {};
  function getDepth(c) {
    if (depthMap[c.id] !== undefined) return depthMap[c.id];
    if (!c.parent_id) { depthMap[c.id] = 0; return 0; }
    const parent = comments.find(x => x.id === c.parent_id);
    const d = parent ? getDepth(parent) + 1 : 0;
    depthMap[c.id] = Math.min(d, 5);
    return depthMap[c.id];
  }
  comments.forEach(c => { c.depth = getDepth(c); });

  res.render('comments', { title: '评论: ' + post.title, post, comments });
});

// Sub-thread: single comment + all its replies
router.get('/posts/:slug/comment/:id', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.is_deleted = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });

  const root = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM comments c JOIN users u ON c.author_id = u.id
    WHERE c.id = ? AND c.post_id = ?
  `).get(req.params.id, post.id);
  if (!root) return res.status(404).render('404', { title: '404' });

  // Get all descendants recursively
  const allComments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(post.id);

  // Build descendant tree
  function getDescendants(parentId) {
    const result = [];
    for (const c of allComments) {
      if (c.parent_id === parentId) {
        result.push(c);
        result.push(...getDescendants(c.id));
      }
    }
    return result;
  }
  const replies = getDescendants(root.id);

  // Count all descendants
  function countDescendants(parentId) {
    let count = 0;
    for (const c of allComments) {
      if (c.parent_id === parentId) { count += 1 + countDescendants(c.id); }
    }
    return count;
  }
  const replyCount = countDescendants(root.id);

  res.render('thread', { title: '帖子: ' + post.title, post, root, replies, replyCount });
});

// Delete own post (author or admin)
router.post('/posts/:slug/delete-self', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  if (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= 16) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  db.prepare("UPDATE posts SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
  res.redirect(post.type === 'forum' ? '/forum' : '/');
});

// Delete own comment (author or admin)
router.post('/comments/:id/delete', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const cmt = db.prepare('SELECT c.*, p.slug, p.type FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(req.params.id);
  if (!cmt) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  if (cmt.author_id !== req.session.user.id && (req.session.user.role || 0) <= 16) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  const back = cmt.type === 'forum' ? '/forum/' + cmt.slug : '/posts/' + cmt.slug;
  res.redirect(back);
});

module.exports = router;
