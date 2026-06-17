const { LEVEL, canPost, canEdit, canDelete, canManageUser } = require('../lib/perm');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const config = require('../lib/config');
const router = express.Router();

function requireLevel(level) {
  return (req, res, next) => {
    if (!req.session.user || (req.session.user.role || 0) < level) {
      return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '需要更高权限', back: '/' });
    }
    next();
  };
}

// Admin dashboard (>=32)
router.get('/', requireLevel(LEVEL.ADMIN), (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    posts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 OR is_deleted IS NULL').get().c,
    
    comments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
    checkins: db.prepare('SELECT COUNT(*) as c FROM checkins').get().c,
    reports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").get().c,
  };
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  const deletedPosts = db.prepare("SELECT * FROM posts WHERE is_deleted = 1 ORDER BY updated_at DESC LIMIT 10").all();
  const users = db.prepare('SELECT * FROM users ORDER BY role DESC, created_at ASC LIMIT ? OFFSET ?').all(limit, (page-1)*limit);
  const loginLogs = db.prepare(`SELECT l.*, u.username FROM login_logs l JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 20`).all();
  const userTotal = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const totalPages = Math.ceil(userTotal.c / limit);
  res.render('admin', { title: '管理后台', stats, categories, deletedPosts, users, page, totalPages, LEVEL, loginLogs });
});

// Add category (>=32)
router.post('/categories', requireLevel(LEVEL.ADMIN), (req, res) => {
  const { name, description } = req.body;
  const slug = name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + require('../lib/time').now().getTime();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories').get();
  db.prepare('INSERT INTO categories (name, slug, description, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, slug, description || '', (maxOrder.m || 0) + 1);
  res.redirect('/admin');
});

// Delete category (>=32)
router.post('/categories/:id/delete', requireLevel(LEVEL.ADMIN), (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// Soft-delete post (mod and above)
router.post('/posts/:slug/delete', requireLevel(LEVEL.MOD), (req, res) => {
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(req.params.slug);
  res.redirect('/');
});

// Hard delete post (only if past retention period)
router.post('/posts/:slug/purge', requireLevel(LEVEL.ADMIN), (req, res) => {
  const post = db.prepare("SELECT id FROM posts WHERE slug = ? AND is_deleted = 1 AND deleted_at < ?").get(req.params.slug, require('../lib/time').sqlFromNow('-' + config.RETENTION)).get(req.params.slug);
  if (post) {
    db.prepare('DELETE FROM comments WHERE post_id = ?').run(post.id);
    db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  }
  res.redirect('/admin');
});

// Restore post (>=32)
router.post('/posts/:slug/restore', requireLevel(LEVEL.ADMIN), (req, res) => {
  db.prepare("UPDATE posts SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(req.params.slug);
  res.redirect('/admin');
});

// Toggle pin post (>=16)
router.post('/posts/:slug/pin', requireLevel(LEVEL.MOD), (req, res) => {
  const post = db.prepare('SELECT id, is_pinned FROM posts WHERE slug = ?').get(req.params.slug);
  if (post) {
    db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').run(post.is_pinned ? 0 : 1, post.id);
  }
  const back = req.get('Referer') || '';
  res.redirect(back.startsWith('/') ? back : '/');
});

// Ban user (must be strictly higher level than target)
router.post('/users/:id/ban', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  if (myRole < LEVEL.ADMIN) return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '需要管理员权限', back: '/' });
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin');
  if (target.id === req.session.user.id) return res.status(400).render('error', { title: '错误', code: 400, message: '不能封禁自己', detail: '', back: '/admin' });
  if (myRole <= target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '无法封禁同级或更高级用户', back: '/admin' });
  db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  res.redirect('/users/' + (u ? u.username : ''));
});

// Unban user (>=32)
router.post('/users/:id/unban', requireLevel(LEVEL.ADMIN), (req, res) => {
  db.prepare('UPDATE users SET banned = 0 WHERE id = ? AND banned = 1').run(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  res.redirect('/users/' + (u ? u.username : ''));
});

// Promote user
router.post('/users/:id/promote', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const target = db.prepare('SELECT id, role, username, banned FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.banned) return res.redirect('/users/' + (target ? target.username : ''));
  if (myRole <= target.role + 1) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '只能提升权限低于你的用户', back: '/users/' + target.username });
  // Step up through levels, must stay strictly below myRole
  const steps = [LEVEL.USER, LEVEL.MOD, LEVEL.ADMIN, LEVEL.SUPER, LEVEL.OWNER];
  let newRole = target.role;
  for (const s of steps) { if (s > target.role && s < myRole) { newRole = s; break; } }
  if (newRole === target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '无法提权', detail: '已达到你权限下最高等级', back: '/users/' + target.username });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, req.params.id);
  res.redirect('/users/' + target.username);
});

// Demote user
router.post('/users/:id/demote', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const target = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/');
  if (myRole <= target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '只能降级权限低于你的用户', back: '/users/' + target.username });
  // Step down through levels, minimum USER(1)
  const steps = [LEVEL.OWNER, LEVEL.SUPER, LEVEL.ADMIN, LEVEL.MOD, LEVEL.USER];
  let newRole = target.role;
  for (const s of steps) { if (s < target.role) { newRole = s; break; } }
  if (newRole === target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '无法降权', detail: '该用户已是最低权限', back: '/users/' + target.username });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, req.params.id);
  res.redirect('/users/' + target.username);
});

// Soft-delete any comment (mod and above), never truly delete
router.post('/comments/:id/delete-mod', requireLevel(LEVEL.MOD), (req, res) => {
  const cmt = db.prepare('SELECT c.*, p.slug FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(req.params.id);
  if (!cmt) return res.status(404).render('error', { title: '错误', code: 404, message: '评论不存在', detail: '', back: '/' });
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.redirect('/posts/' + cmt.slug);
});

// Delete user — soft-delete content, mark user for cleanup after 60 days
router.post('/users/:id/delete', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const target = db.prepare('SELECT id, role, username, banned, deleted_at FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/');
  if (target.deleted_at) return res.status(400).render('error', { title: '错误', code: 400, message: '用户已被删除', detail: '该用户已在等待清理中', back: '/users/' + target.username });
  if (myRole <= target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '只能删除权限低于你的用户', back: '/users/' + target.username });
  // Soft-delete all content
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(target.id);
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(target.id);
  db.prepare("UPDATE messages SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE (from_id = ? OR to_id = ?) AND is_deleted = 0").run(target.id, target.id);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(target.id);
  db.prepare('DELETE FROM checkins WHERE user_id = ?').run(target.id);
  db.prepare('DELETE FROM xp_log WHERE user_id = ?').run(target.id);
  db.prepare('DELETE FROM likes WHERE user_id = ?').run(target.id);
  db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(target.id);
  // Mark user as deleted — content retained 60 days, then system purges
  db.prepare("UPDATE users SET banned = 1, deleted_at = CURRENT_TIMESTAMP, password_hash = ? WHERE id = ?").run(bcrypt.hashSync(Math.random().toString(), 10), target.id);
  res.redirect('/users/' + target.username);
});

module.exports = router;
