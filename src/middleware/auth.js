// Auth middleware — thin Express wrappers around lib/auth.
const auth = require('../lib/auth');

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

function requireAuthAPI(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: '请先登录' });
  next();
}

function requireActive(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = require('../database').getDB().prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.banned || !user.email)
    return res.status(403).render('page/error', { title: '错误', code: 403, message: '账号受限', detail: user?.banned ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作', back: '/' });
  next();
}

function requireRole(level) {
  return (req, res, next) => {
    if (!auth.hasRole(req.session.user, level))
      return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '需要更高权限', back: '/' });
    next();
  };
}

module.exports = { requireAuth, requireAuthAPI, requireActive, requireRole, LEVEL: auth.LEVEL, roleLabel: auth.roleLabel, roleBadge: auth.roleBadge };
