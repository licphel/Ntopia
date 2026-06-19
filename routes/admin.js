const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { requireRole, LEVEL } = require('../lib/middleware');
const config = require('../lib/config');
const router = express.Router();

const needAdmin = requireRole(LEVEL.ADMIN);
const needMod   = requireRole(LEVEL.MOD);

// Dashboard
router.get('/', needAdmin, (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    posts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 OR is_deleted IS NULL').get().c,
    comments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
    reports: db.prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").get().c,
  };
  const loginLogs = db.prepare(`SELECT l.*, u.username FROM login_logs l JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 20`).all();
  res.render('admin', { title: '管理后台', stats, loginLogs, LEVEL });
});

// Categories
router.post('/categories', needAdmin, (req, res) => {
  const { name, description } = req.body;
  const slug = name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + require('../lib/time').now().getTime();
  const max = db.prepare('SELECT MAX(sort_order) as m FROM categories').get();
  db.prepare('INSERT INTO categories (name, slug, description, sort_order) VALUES (?,?,?,?)').run(name, slug, description || '', (max.m || 0) + 1);
  res.redirect('/admin');
});

router.post('/categories/:id/delete', needAdmin, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// Soft-delete post
router.post('/posts/:slug/delete', needMod, (req, res) => {
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(req.params.slug);
  res.redirect('/');
});

// Purge post
router.post('/posts/:slug/purge', needAdmin, (req, res) => {
  const post = db.prepare("SELECT id FROM posts WHERE slug = ? AND is_deleted = 1 AND deleted_at < ?").get(req.params.slug, require('../lib/time').sqlFromNow('-' + config.RETENTION));
  if (post) { db.prepare('DELETE FROM comments WHERE post_id = ?').run(post.id); db.prepare('DELETE FROM posts WHERE id = ?').run(post.id); }
  res.redirect('/admin');
});

// Restore post
router.post('/posts/:slug/restore', needAdmin, (req, res) => {
  db.prepare("UPDATE posts SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(req.params.slug);
  res.redirect('/admin');
});

// Pin/unpin post
router.post('/posts/:slug/pin', needMod, (req, res) => {
  const post = db.prepare('SELECT id, is_pinned FROM posts WHERE slug = ?').get(req.params.slug);
  if (post) db.prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').run(post.is_pinned ? 0 : 1, post.id);
  res.redirect((req.get('Referer') || '').startsWith('/') ? req.get('Referer') : '/');
});

// Ban user
router.post('/users/:id/ban', needAdmin, (req, res) => {
  const target = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin');
  if (target.id === req.session.user.id) return _err(res, '不能封禁自己', '/admin');
  if ((req.session.user.role || 0) <= target.role) return _err(res, '无法封禁同级或更高级用户', '/admin');
  db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/users/' + target.username);
});

// Unban user
router.post('/users/:id/unban', needAdmin, (req, res) => {
  db.prepare('UPDATE users SET banned = 0 WHERE id = ? AND banned = 1').run(req.params.id);
  const u = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  res.redirect('/users/' + (u ? u.username : ''));
});

// Promote
router.post('/users/:id/promote', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const t = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(req.params.id);
  if (!t || t.banned) return res.redirect('/users/' + (t ? t.username : ''));
  const steps = [LEVEL.USER, LEVEL.MOD, LEVEL.ADMIN, LEVEL.SUPER, LEVEL.OWNER];
  let nr = t.role;
  for (const s of steps) { if (s > t.role && s < myRole) { nr = s; break; } }
  if (nr === t.role) return _err(res, '已达到你权限下最高等级', '/users/' + t.username);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nr, req.params.id);
  res.redirect('/users/' + t.username);
});

// Demote
router.post('/users/:id/demote', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const t = db.prepare('SELECT id, role, username FROM users WHERE id = ?').get(req.params.id);
  if (!t) return res.redirect('/');
  if (myRole <= t.role) return _err(res, '只能降级权限低于你的用户', '/users/' + t.username);
  const steps = [LEVEL.OWNER, LEVEL.SUPER, LEVEL.ADMIN, LEVEL.MOD, LEVEL.USER];
  let nr = t.role;
  for (const s of steps) { if (s < t.role) { nr = s; break; } }
  if (nr === t.role) return _err(res, '该用户已是最低权限', '/users/' + t.username);
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nr, req.params.id);
  res.redirect('/users/' + t.username);
});

// Delete comment (mod)
router.post('/comments/:id/delete-mod', needMod, (req, res) => {
  const cmt = db.prepare('SELECT c.*, p.slug FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(req.params.id);
  if (!cmt) return res.status(404).render('error', { title: '错误', code: 404, message: '评论不存在', detail: '', back: '/' });
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.redirect('/posts/' + cmt.slug);
});

// Delete user
router.post('/users/:id/delete', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const t = db.prepare('SELECT id, role, username, deleted_at FROM users WHERE id = ?').get(req.params.id);
  if (!t) return res.redirect('/');
  if (t.deleted_at) return _err(res, '用户已被删除', '/users/' + t.username);
  if (myRole <= t.role) return _err(res, '只能删除权限低于你的用户', '/users/' + t.username);
  db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(t.id);
  db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(t.id);
  db.prepare("UPDATE messages SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE (from_id = ? OR to_id = ?) AND is_deleted = 0").run(t.id, t.id);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(t.id);
  db.prepare('DELETE FROM checkins WHERE user_id = ?').run(t.id);
  db.prepare('DELETE FROM xp_log WHERE user_id = ?').run(t.id);
  db.prepare('DELETE FROM likes WHERE user_id = ?').run(t.id);
  db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(t.id);
  db.prepare("UPDATE users SET banned = 1, deleted_at = CURRENT_TIMESTAMP, password_hash = ? WHERE id = ?").run(bcrypt.hashSync(Math.random().toString(), 10), t.id);
  res.redirect('/users/' + t.username);
});

function _err(res, msg, back) {
  return res.status(400).render('error', { title: '错误', code: 400, message: msg, detail: '', back });
}

module.exports = router;
