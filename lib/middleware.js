// Unified auth & validation middleware — single source of truth
const { db } = require('./db');
const { LEVEL } = require('./perm');

// Redirect to login if no session
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// JSON version for API routes
function requireLoginAPI(req, res, next) {
  if (!req.session.user) return res.status(401).json({ ok: false, error: '请先登录' });
  next();
}

// Block if user is banned or has no email (for posting/commenting)
function requireActive(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  const user = db.prepare('SELECT banned, email FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.banned || !user.email) {
    return res.status(403).render('error', {
      title: '错误', code: 403, message: '账号受限',
      detail: (user && user.banned) ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作',
      back: '/'
    });
  }
  next();
}

// Require minimum role level
function requireRole(level) {
  return (req, res, next) => {
    if (!req.session.user || (req.session.user.role || 0) < level) {
      return res.status(403).render('error', {
        title: '错误', code: 403, message: '权限不足',
        detail: '需要更高权限', back: '/'
      });
    }
    next();
  };
}

module.exports = { requireLogin, requireLoginAPI, requireActive, requireRole, LEVEL };
