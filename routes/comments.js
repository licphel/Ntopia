// Comment routes
// Mounted at /posts in lib/app.js

const express = require('express');
const { renderMarkdown, extractMentions, linkMentions } = require('../lib/helpers');
const { db, awardCommentXP } = require('../lib/db');
const time = require('../lib/time');
const router = express.Router();

// Add comment
router.post('/:slug/comment', async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (user && (user.banned || !user.email)) return res.status(403).render('error', { title: '错误', code: 403, message: '账号受限', detail: user.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  const post = db.prepare('SELECT id, slug, author_id FROM posts WHERE slug = ? AND is_deleted = 0').get(req.params.slug);
  if (!post) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  const { content, parent_id } = req.body;

  // Reject reply to deleted comment
  if (parent_id) {
    const parent = db.prepare('SELECT id, is_deleted FROM comments WHERE id = ?').get(parent_id);
    if (!parent) return res.status(404).render('error', { title: '错误', code: 404, message: '评论不存在', detail: '', back: '/' });
    if (parent.is_deleted) return res.status(400).render('error', { title: '错误', code: 400, message: '无法回复', detail: '该评论已被删除，无法回复', back: '/' });
  }

  // AI moderation — illegal content only, admin+ exempt
  if ((req.session.user.role || 0) < 32) {
    const { reviewComment } = require('../lib/moderation');
    const result = await reviewComment(content);
    if (!result.pass) {
      db.prepare("UPDATE users SET banned = 1, banned_until = ? WHERE id = ?").run(time.sqlFromNow('+1 minute'), req.session.user.id);
      //req.session.user = null;
      return res.status(403).render('error', { title: '错误', code: 403, message: '评论审核未通过', detail: `你的评论未通过审核：${result.reason}。账号已被封禁1分钟。`, back: '/' });
    }
  }

  // @mention processing
  const mentions = extractMentions(content);
  let mentionUsers = [];
  if (mentions.length) {
    const placeholders = mentions.map(() => '?').join(',');
    mentionUsers = db.prepare(`SELECT username FROM users WHERE LOWER(username) IN (${placeholders})`).all(...mentions);
  }
  const linkedContent = linkMentions(content, mentionUsers.map(u => u.username));
  const html = renderMarkdown(linkedContent);
  const info = db.prepare('INSERT INTO comments (post_id, author_id, content_md, content_html, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(post.id, req.session.user.id, content, html, parent_id || null);
  awardCommentXP(req.session.user.id, info.lastInsertRowid);
  req.session.user.xp = (req.session.user.xp || 0) + 1;

  const myName = req.session.user.display_name || req.session.user.username;
  const base = '/posts/';

  // Notify post author (unless commenting on own post)
  if (post.author_id !== req.session.user.id) {
    db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'reply', ?, ?)`)
      .run(post.author_id, `${myName} 评论了你的文章`, base + post.slug);
  }

  // Notify @mentioned users
  if (mentionUsers.length) {
    const mentionStmt = db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'mention', ?, ?)`);
    mentionUsers.forEach(u => {
      const target = db.prepare('SELECT id FROM users WHERE LOWER(username) = ?').get(u.username.toLowerCase());
      if (target && target.id !== req.session.user.id && target.id !== post.author_id) {
        mentionStmt.run(target.id, `${myName} 在评论中提到了你`, base + post.slug);
      }
    });
  }

  // Notify parent comment author (already validated parent exists and not deleted)
  if (parent_id) {
    const parent = db.prepare('SELECT author_id FROM comments WHERE id = ?').get(parent_id);
    if (parent && parent.author_id !== req.session.user.id) {
      db.prepare(`INSERT INTO notifications (user_id, type, content, link) VALUES (?, 'reply', ?, ?)`)
        .run(parent.author_id, `${myName} 回复了你的评论`, base + post.slug);
    }
  }

  // Redirect to the root of this reply thread (one level up if nested)
  let threadId = parent_id;
  if (parent_id) {
    const parent = db.prepare('SELECT parent_id FROM comments WHERE id = ?').get(parent_id);
    if (parent && parent.parent_id) threadId = parent.parent_id;
  }
  res.redirect(threadId ? base + post.slug + '/comment/' + threadId : base + post.slug);
});

// Sub-thread: single comment + all its replies
router.get('/:slug/comment/:id', (req, res) => {
  const post = db.prepare(`
    SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM posts p JOIN users u ON p.author_id = u.id
    WHERE p.slug = ? AND (p.is_deleted = 0 OR p.is_deleted IS NULL)
  `).get(req.params.slug);
  if (!post) return res.status(404).render('404', { title: '404' });
  if (post.is_draft && post.author_id !== (req.session.user ? req.session.user.id : 0)) return res.status(404).render('404', { title: '404' });

  const root = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role
    FROM comments c JOIN users u ON c.author_id = u.id
    WHERE c.id = ? AND c.post_id = ?
  `).get(req.params.id, post.id);
  if (!root) return res.status(404).render('404', { title: '404' });

  const allComments = db.prepare(`
    SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
      p2.username as parent_username, p2.display_name as parent_display
    FROM comments c JOIN users u ON c.author_id = u.id
    JOIN posts p ON c.post_id = p.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
    WHERE c.post_id = ? AND ((c.is_deleted = 0 OR c.is_deleted IS NULL) OR ? >= 128) ORDER BY c.created_at ASC
  `).all(post.id, (req.session.user ? (req.session.user.role || 0) : 0));

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

  res.render('thread', { title: '帖子: ' + post.title, post, root, replies, replyCount: countDescendants(root.id) });
});

// Delete own comment (author or admin)
router.post('/comments/:id/delete', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const cmt = db.prepare('SELECT c.*, p.slug FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(req.params.id);
  if (!cmt) return res.status(404).render('error', { title: '错误', code: 404, message: '内容不存在', detail: '该内容可能已被删除或链接错误', back: '/' });
  if (cmt.author_id !== req.session.user.id && (req.session.user.role || 0) <= 16) // LEVEL.MOD = 16
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  const base = '/posts/';
  res.redirect(base + cmt.slug);
});

module.exports = router;
