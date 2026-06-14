const express = require('express');
const { marked } = require('marked');
const { db, addXP } = require('../db');
const router = express.Router();

function slugify(text) {
  return text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

// Forum index
router.get('/', (req, res) => {
  const cat = req.query.cat || '';
  const page = parseInt(req.query.page) || 1;
  const limit = 15;
  const offset = (page - 1) * limit;

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'forum' ORDER BY sort_order").all();

  let topics, total;
  const baseQuery = `SELECT p.*, u.username, u.display_name, u.avatar, u.level,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.type = 'forum' AND p.is_deleted = 0`;
  if (cat) {
    topics = db.prepare(`${baseQuery} AND p.forum_category = ? ORDER BY p.is_pinned DESC, p.updated_at DESC LIMIT ? OFFSET ?`)
      .all(cat, limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'forum' AND forum_category = ? AND is_deleted = 0").get(cat);
  } else {
    topics = db.prepare(`${baseQuery} ORDER BY p.is_pinned DESC, p.updated_at DESC LIMIT ? OFFSET ?`)
      .all(limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'forum' AND is_deleted = 0").get();
  }
  const totalPages = Math.ceil(total.c / limit);

  res.render('forum', { title: '论坛', topics, categories, currentCat: cat, page, totalPages });
});

// New forum topic page — category dropdown
router.get('/new-topic', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned FROM users WHERE id = ?').get(req.session.user.id);
  if (user && user.banned) return res.status(403).render('error', { title: '错误', code: 403, message: '账号已被封禁', detail: '你的账号已被管理员封禁，无法执行此操作', back: '/' });
  const categories = db.prepare("SELECT * FROM categories WHERE type = 'forum' ORDER BY sort_order").all();
  res.render('editor', { title: '发布新主题', post: null, type: 'forum', categories, canPost: true });
});

// New forum topic POST
router.post('/new-topic', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned FROM users WHERE id = ?').get(req.session.user.id);
  if (user && user.banned) return res.status(403).render('error', { title: '错误', code: 403, message: '账号已被封禁', detail: '你的账号已被管理员封禁，无法执行此操作', back: '/' });
  const { title, forum_category, content } = req.body;
  const slug = slugify(title) + '-' + Date.now();
  const html = marked.parse(content || '');
  db.prepare(`INSERT INTO posts (title, slug, content_md, content_html, author_id, type, forum_category)
    VALUES (?, ?, ?, ?, ?, 'forum', ?)`)
    .run(title, slug, content, html, req.session.user.id, forum_category || 'general');
  const post = db.prepare('SELECT id FROM posts WHERE slug = ?').get(slug);
  addXP(req.session.user.id, 3, '发布论坛主题', post.id);
  req.session.user.xp = (req.session.user.xp || 0) + 3;
  res.redirect('/forum/' + slug + '/comments');
});

// Full comments page for forum topic
router.get('/:slug/comments', (req, res) => {
  const topic = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.type = 'forum' AND p.is_deleted = 0
  `).get(req.params.slug);
  if (!topic) return res.status(404).render('404', { title: '404' });

  db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(topic.id);

  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(topic.id);

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

  res.render('comments', { title: '讨论: ' + topic.title, post: topic, comments });
});

// Sub-thread for forum
router.get('/:slug/comment/:id', (req, res) => {
  const topic = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.type = 'forum' AND p.is_deleted = 0
  `).get(req.params.slug);
  if (!topic) return res.status(404).render('404', { title: '404' });

  const root = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level
    FROM comments c JOIN users u ON c.author_id = u.id
    WHERE c.id = ? AND c.post_id = ?
  `).get(req.params.id, topic.id);
  if (!root) return res.status(404).render('404', { title: '404' });

  const allComments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(topic.id);

  function getDescendants(parentId) {
    const result = [];
    for (const c of allComments) {
      if (c.parent_id === parentId) { result.push(c); result.push(...getDescendants(c.id)); }
    }
    return result;
  }
  const replies = getDescendants(root.id);

  function countDescendants(parentId) {
    let count = 0;
    for (const c of allComments) {
      if (c.parent_id === parentId) count += 1 + countDescendants(c.id);
    }
    return count;
  }

  res.render('thread', { title: '帖子: ' + topic.title, post: topic, root, replies, replyCount: countDescendants(root.id) });
});

// Single forum topic — must be AFTER new-topic, comments, and comment sub-threads
router.get('/:slug', (req, res) => {
  const topic = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND p.type = 'forum' AND p.is_deleted = 0
  `).get(req.params.slug);
  if (!topic) return res.status(404).render('404', { title: '404' });

  db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(topic.id);

  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? ORDER BY c.created_at ASC
  `).all(topic.id);

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

  res.render('topic', { title: topic.title, topic, comments });
});

module.exports = router;
