const { LEVEL, canPost, canEdit, canDelete, canManageUser } = require('../lib/perm');
const express = require('express');
const { renderMarkdown, slugify, computeDepth, extractTOC, injectHeadingIds, extractMentions, linkMentions } = require('../lib/helpers');
const { db, awardPostXP, awardCommentXP } = require('../db');
const router = express.Router();





// My drafts
router.get('/drafts', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const page = parseInt(req.query.page) || 1;
  const limit = 20;
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

  const categories = db.prepare("SELECT * FROM categories WHERE type = 'blog' ORDER BY sort_order").all();

  let posts, total;
  const baseQuery = `SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
        COALESCE(cat.name, p.category) as category_name,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug AND cat.type = 'blog'
    WHERE p.type = 'post' AND (p.is_deleted = 0 OR p.is_deleted IS NULL) AND p.is_draft = 0`;
  if (cat) {
    posts = db.prepare(`${baseQuery} AND p.category = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(cat, limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'post' AND category = ? AND is_deleted = 0").get(cat);
  } else {
    posts = db.prepare(`${baseQuery} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'post' AND is_deleted = 0").get();
  }
  if (sort === 'replies') posts.sort((a, b) => b.comment_count - a.comment_count);
  else if (sort === 'hot') posts.sort((a, b) => { let ha = a.comment_count / Math.max((Date.now() - new Date(a.created_at).getTime()) / 3600000, 1); let hb = b.comment_count / Math.max((Date.now() - new Date(b.created_at).getTime()) / 3600000, 1); return hb - ha; });

  const totalPages = Math.ceil(total.c / limit);

  res.render('index', { title: '首页', posts, page, totalPages, sort, categories, currentCat: cat });
});

// Single blog post
router.get('/posts/:slug', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug AND cat.type = 'blog'
    WHERE p.slug = ? AND p.type = 'post' AND p.is_draft = 0
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  if (post.is_deleted && post.author_id !== (req.session.user ? req.session.user.id : 0) && (req.session.user ? (req.session.user.role || 0) : 0) < 128) return res.status(404).render('404', { title: '404' });

  db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(post.id);

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

  const cmtPage = parseInt(req.query.cp) || 1;
  res.render("post", { title: post.title, post, comments, toc: toc.length > 1 ? toc : null, cmtPage });
});

// Create post page — uses category dropdown
router.get('/new-post', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (user && (user.banned || !user.email)) return res.status(403).render('error', { title: '错误', code: 403, message: '账号受限', detail: user.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  const blogCats = db.prepare("SELECT * FROM categories WHERE type = 'blog' ORDER BY sort_order").all();
  res.render('editor', { title: '撰写文章', post: null, type: 'post', categories: blogCats, canPost: true });
});

// Create post POST
router.post('/new-post', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (user && (user.banned || !user.email)) return res.status(403).render('error', { title: '错误', code: 403, message: '账号受限', detail: user.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  const { title, category, tags, excerpt, content } = req.body;
  const is_draft = req.body.is_draft === '1' ? 1 : 0;
  const slug = slugify(title) + '-' + Date.now();
  const html = renderMarkdown(content);
  db.prepare(`INSERT INTO posts (title, slug, content_md, content_html, excerpt, category, tags, author_id, type, is_draft)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'post', ?)`)
    .run(title, slug, content, html, excerpt || '', category || '', tags || '', req.session.user.id, is_draft);
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
  const blogCats = db.prepare("SELECT * FROM categories WHERE type = 'blog' ORDER BY sort_order").all();
  res.render('editor', { title: '编辑文章', post, type: 'post', categories: blogCats, canPost: true });
});

router.post('/posts/:slug/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const post = db.prepare('SELECT * FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post || (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= LEVEL.MOD)) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  const { title, category, tags, excerpt, content } = req.body;
  const is_draft = req.body.is_draft === '1' ? 1 : 0;
  const html = renderMarkdown(content);
  // Save revision before updating
  db.prepare(`INSERT INTO post_revisions (post_id, title, content_md, content_html, excerpt, category, tags, revised_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(post.id, post.title, post.content_md, post.content_html, post.excerpt || '', post.category || '', post.tags || '', req.session.user.id);
  // Keep only last 10 revisions per post
  db.prepare(`DELETE FROM post_revisions WHERE id IN (
    SELECT id FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 10
  )`).run(post.id);

  db.prepare(`UPDATE posts SET title=?, content_md=?, content_html=?, excerpt=?, category=?, tags=?, is_draft=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(title, content, html, excerpt || '', category || '', tags || '', is_draft, post.id);
  res.redirect(is_draft ? '/drafts' : '/posts/' + post.slug);
});

// Add comment
router.post('/posts/:slug/comment', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (user && (user.banned || !user.email)) return res.status(403).render('error', { title: '错误', code: 403, message: '账号受限', detail: user.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  const post = db.prepare('SELECT id, slug, type, author_id FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  const { content, parent_id } = req.body;

  // @mention processing
  const mentions = extractMentions(content);
  let mentionUsers = [];
  if (mentions.length) {
    const placeholders = mentions.map(() => '?').join(',');
    mentionUsers = db.prepare(`SELECT username FROM users WHERE LOWER(username) IN (${placeholders})`).all(...mentions);
  }
  const linkedContent = linkMentions(content, mentionUsers.map(u => u.username));
  const html = renderMarkdown(linkedContent);
  db.prepare('INSERT INTO comments (post_id, author_id, content_md, content_html, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(post.id, req.session.user.id, content, html, parent_id || null);
  const cmt = db.prepare('SELECT id FROM comments ORDER BY id DESC LIMIT 1').get();
  awardCommentXP(req.session.user.id, cmt.id);
  req.session.user.xp = (req.session.user.xp || 0) + 1;

  const myName = req.session.user.display_name || req.session.user.username;

  // Notify post author (unless commenting on own post)
  if (post.author_id !== req.session.user.id) {
    db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'reply', ?, ?)`)
      .run(post.author_id,
        `${myName} 评论了你的${post.type === 'forum' ? '主题' : '文章'}`,
        '/' + (post.type === 'forum' ? 'forum/' : 'posts/') + post.slug);
  }

  // Notify @mentioned users
  if (mentionUsers.length) {
    const mentionStmt = db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'mention', ?, ?)`);
    const mlink = '/' + (post.type === 'forum' ? 'forum/' : 'posts/') + post.slug;
    mentionUsers.forEach(u => {
      const target = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(u.username.toLowerCase());
      if (target && target.id !== req.session.user.id && target.id !== post.author_id) {
        mentionStmt.run(target.id, `${myName} 在评论中提到了你`, mlink);
      }
    });
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

  const base = post.type === 'forum' ? '/forum/' : '/posts/';
  const redirectUrl = parent_id ? base + post.slug + '/comment/' + parent_id : base + post.slug;
  res.redirect(redirectUrl);

  const comments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    JOIN posts p ON c.post_id = p.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? AND ((c.is_deleted = 0 OR c.is_deleted IS NULL) OR ? >= 128) ORDER BY c.created_at ASC
  `).all(post.id, (req.session.user ? (req.session.user.role || 0) : 0));
});

// Sub-thread: single comment + all its replies
router.get('/posts/:slug/comment/:id', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM posts p JOIN users u ON p.author_id = u.id LEFT JOIN categories cat ON p.category = cat.slug AND cat.type = 'blog'
    WHERE p.slug = ? AND (p.is_deleted = 0 OR p.is_deleted IS NULL) AND p.is_draft = 0
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
    JOIN posts p ON c.post_id = p.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? AND ((c.is_deleted = 0 OR c.is_deleted IS NULL) OR ? >= 128) ORDER BY c.created_at ASC
  `).all(post.id, (req.session.user ? (req.session.user.role || 0) : 0));

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
  if (post.author_id !== req.session.user.id && (req.session.user.role || 0) <= LEVEL.MOD) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
  res.redirect(post.type === 'forum' ? '/forum' : '/');
});

// Delete own comment (author or admin)
router.post('/comments/:id/delete', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const cmt = db.prepare('SELECT c.*, p.slug, p.type FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(req.params.id);
  if (!cmt) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  if (cmt.author_id !== req.session.user.id && (req.session.user.role || 0) <= LEVEL.MOD) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  }
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  const base = cmt.type === 'forum' ? '/forum/' : '/posts/';
  const back = cmt.parent_id ? base + cmt.slug + '/comment/' + cmt.parent_id : base + cmt.slug;
  res.redirect(back);
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
  db.prepare(`INSERT INTO post_revisions (post_id, title, content_md, content_html, excerpt, category, tags, revised_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(post.id, post.title, post.content_md, post.content_html, post.excerpt || '', post.category || '', post.tags || '', req.session.user.id);
  db.prepare(`UPDATE posts SET title=?, content_md=?, content_html=?, excerpt=?, category=?, tags=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(rev.title, rev.content_md, rev.content_html, rev.excerpt || '', rev.category || '', rev.tags || '', post.id);
  res.redirect('/posts/' + post.slug);
});

module.exports = router;
