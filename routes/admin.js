const express = require('express');
const { db } = require('../db');
const router = express.Router();

// Permission levels
const L = { BANNED: -1, GUEST: 0, USER: 1, MOD: 16, ADMIN: 32, OWNER: 128 };

function requireLevel(level) {
  return (req, res, next) => {
    if (!req.session.user || (req.session.user.role || 0) < level) {
      return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '需要更高权限', back: '/' });
    }
    next();
  };
}

// Admin dashboard (>=32)
router.get('/', requireLevel(L.ADMIN), (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    posts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'post' AND is_deleted = 0").get().c,
    forumTopics: db.prepare("SELECT COUNT(*) as c FROM posts WHERE type = 'forum' AND is_deleted = 0").get().c,
    comments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
    checkins: db.prepare('SELECT COUNT(*) as c FROM checkins').get().c,
  };
  const categories = db.prepare('SELECT * FROM categories ORDER BY type, sort_order').all();
  const deletedPosts = db.prepare("SELECT * FROM posts WHERE is_deleted = 1 ORDER BY updated_at DESC LIMIT 10").all();
  const users = db.prepare('SELECT * FROM users ORDER BY role DESC, created_at ASC LIMIT 50').all();
  res.render('admin', { title: '管理后台', stats, categories, deletedPosts, users, L });
});

// Add category (>=32)
router.post('/categories', requireLevel(L.ADMIN), (req, res) => {
  const { name, description, type } = req.body;
  const catType = type || 'forum';
  const slug = name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM categories WHERE type = ?').get(catType);
  db.prepare('INSERT INTO categories (name, slug, description, type, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(name, slug, description || '', catType, (maxOrder.m || 0) + 1);
  res.redirect('/admin');
});

// Delete category (>=32)
router.post('/categories/:id/delete', requireLevel(L.ADMIN), (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// Pin topic (>=32)
router.post('/forum/:slug/pin', requireLevel(L.ADMIN), (req, res) => {
  db.prepare('UPDATE posts SET is_pinned = 1 - is_pinned WHERE slug = ?').run(req.params.slug);
  res.redirect('/forum/' + req.params.slug);
});

// Soft-delete post (>16)
router.post('/posts/:slug/delete', requireLevel(L.MOD + 1), (req, res) => {
  db.prepare("UPDATE posts SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(req.params.slug);
  res.redirect('/');
});

// Restore post (>=32)
router.post('/posts/:slug/restore', requireLevel(L.ADMIN), (req, res) => {
  db.prepare("UPDATE posts SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(req.params.slug);
  res.redirect('/admin');
});

// Ban user (must be strictly higher level than target)
router.post('/users/:id/ban', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  if (myRole < L.ADMIN) return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '需要管理员权限', back: '/' });
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin');
  if (target.id === req.session.user.id) return res.status(400).render('error', { title: '错误', code: 400, message: '不能封禁自己', detail: '', back: '/admin' });
  if (myRole <= target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '无法封禁同级或更高级用户', back: '/admin' });
  db.prepare('UPDATE users SET banned = 1, role = -1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// Unban user (>=32)
router.post('/users/:id/unban', requireLevel(L.ADMIN), (req, res) => {
  db.prepare('UPDATE users SET banned = 0, role = 1 WHERE id = ? AND banned = 1').run(req.params.id);
  res.redirect('/admin');
});

// Promote user (must be strictly higher than target AND target's new level must be below my level)
router.post('/users/:id/promote', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.banned) return res.redirect('/admin');
  if (myRole <= target.role + 1) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '只能提升权限低于你的用户', back: '/admin' });
  let newRole = target.role < 1 ? 1 : target.role < L.ADMIN ? L.ADMIN : L.OWNER;
  if (newRole >= myRole) newRole = myRole - 1;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, req.params.id);
  res.redirect('/admin');
});

// Demote user
router.post('/users/:id/demote', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const myRole = req.session.user.role || 0;
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.redirect('/admin');
  if (myRole <= target.role) return res.status(400).render('error', { title: '错误', code: 400, message: '权限不足', detail: '只能降级权限低于你的用户', back: '/admin' });
  let newRole = target.role >= L.OWNER ? L.ADMIN : target.role >= L.ADMIN ? 1 : 0;
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, req.params.id);
  res.redirect('/admin');
});

// Delete any comment (>16)
router.post('/comments/:id/delete-mod', requireLevel(L.MOD + 1), (req, res) => {
  const cmt = db.prepare('SELECT c.*, p.slug, p.type FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?').get(req.params.id);
  if (!cmt) return res.status(404).render('error', { title: '错误', code: 404, message: '评论不存在', detail: '', back: '/' });
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.redirect((cmt.type === 'forum' ? '/forum/' : '/posts/') + cmt.slug);
});

module.exports = router;
