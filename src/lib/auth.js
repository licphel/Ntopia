// Centralized authorization library — every permission check in the codebase
// MUST go through this module. No inline role/int comparisons anywhere else.
//
// Usage:
//   const auth = require('../lib/auth');
//
//   // Pure function checks (services, repositories):
//   if (!auth.canEditPost(viewer, post)) return { ok: false, error: '权限不足' };
//   if (auth.canViewDeleted(viewer)) { /* show deleted content */ }
//
//   // Middleware (routes):
//   router.post('/admin', auth.requireRole(auth.LEVEL.ADMIN), handler);
//   router.post('/new-post', auth.requireActive, handler);

const { getDB } = require('../database');

// ═══════════════════════════════════════════════════════════════
// Role hierarchy — powers of 2, so bitmask checks also work
// ═══════════════════════════════════════════════════════════════
const LEVEL = {
  GUEST: 0,
  USER: 1,
  MOD: 16,
  ADMIN: 32,
  SUPER: 64,
  OWNER: 128,
};

// Ordered list for promote/demote stepping
const ROLE_STEPS = [LEVEL.USER, LEVEL.MOD, LEVEL.ADMIN, LEVEL.SUPER, LEVEL.OWNER];

// ═══════════════════════════════════════════════════════════════
// Pure predicate functions — stateless, work on plain objects
// ═══════════════════════════════════════════════════════════════

/** User has a valid session. */
function isAuthenticated(user) {
  return !!(user && user.id);
}

/** User's role meets or exceeds the given level. */
function hasRole(user, level) {
  return (user && (user.role || 0) >= level);
}

/** User A outranks user B (strictly higher role). */
function outranks(a, b) {
  return hasRole(a, (b && b.role || 0) + 1);
}

/** User is not banned and has an email (can post/comment). */
function isActive(user) {
  if (!isAuthenticated(user)) return false;
  return !user.banned && !!user.email;
}

/** Check active status against DB (for middleware — session may be stale). */
function checkActive(user) {
  if (!isAuthenticated(user)) return { ok: false, reason: 'not_logged_in' };
  const dbUser = getDB().prepare('SELECT banned, email FROM users WHERE id = ?').get(user.id);
  if (!dbUser) return { ok: false, reason: 'not_found' };
  if (dbUser.banned) return { ok: false, reason: 'banned' };
  if (!dbUser.email) return { ok: false, reason: 'no_email' };
  return { ok: true };
}

// ── Content permissions ────────────────────────────────────────

/** User owns the content object (matches author_id). */
function isOwner(user, content) {
  if (!isAuthenticated(user) || !content) return false;
  return user.id === content.author_id;
}

/** User can edit a post (owner, or mod+). */
function canEditPost(user, post) {
  if (!isAuthenticated(user) || !post) return false;
  if (isOwner(user, post)) return true;
  return hasRole(user, LEVEL.MOD);
}

/** User can delete a post (owner, or mod+). */
function canDeletePost(user, post) {
  return canEditPost(user, post);
}

/** User can edit/delete a comment (owner, or mod+). */
function canDeleteComment(user, comment) {
  if (!isAuthenticated(user) || !comment) return false;
  if (isOwner(user, comment)) return true;
  return hasRole(user, LEVEL.MOD);
}

// ── Admin permissions ──────────────────────────────────────────

/** User can access the admin dashboard. */
function canAccessAdmin(user) {
  return hasRole(user, LEVEL.ADMIN);
}

/** User can permanently purge soft-deleted content. */
function canPurge(user) {
  return hasRole(user, LEVEL.ADMIN);
}

/** User can see soft-deleted content. */
function canViewDeleted(user) {
  return hasRole(user, LEVEL.OWNER);
}

/** User can moderate content (approve/reject via AI, etc.). */
function canModerate(user) {
  return hasRole(user, LEVEL.MOD);
}

/** User can create a forum section (level >= 5, or MOD+). */
function canCreateSection(user) {
  if (!isAuthenticated(user)) return false;
  return (user.level || 1) >= 5 || hasRole(user, LEVEL.MOD);
}

/** User is the section owner (moderator_id). */
function isSectionOwner(user, section) {
  if (!isAuthenticated(user)) return false;
  return section && (user.id === section.moderator_id || hasRole(user, LEVEL.SUPER));
}

/** User is any section moderator (owner or sub-mod). */
function isSectionModerator(user, section, isSubMod) {
  if (!isAuthenticated(user)) return false;
  return isSectionOwner(user, section) || !!isSubMod;
}

/** User can moderate a forum section (is section mod, sub-mod, or MOD+). */
function canModerateSection(user, section, isSubMod) {
  if (!isAuthenticated(user)) return false;
  if (hasRole(user, LEVEL.MOD)) return true;
  return isSectionModerator(user, section, isSubMod);
}

// ── User management permissions ────────────────────────────────

/** Admin can manage target user (must outrank, and be admin+). */
function canManageUser(admin, target) {
  if (!isAuthenticated(admin) || !target) return false;
  if (!hasRole(admin, LEVEL.ADMIN)) return false;
  return outranks(admin, target);
}

/** Admin can ban target user. */
function canBanUser(admin, target) {
  return canManageUser(admin, target) && admin.id !== target.id;
}

/** Admin can delete target user. */
function canDeleteUser(admin, target) {
  return canManageUser(admin, target) && !target.deleted_at;
}

/** Calculate the next promotion step for a target (returns new role or null). */
function nextPromotion(admin, target) {
  if (!canManageUser(admin, target)) return null;
  for (const step of ROLE_STEPS) {
    if (step > (target.role || 0) && step < (admin.role || 0)) return step;
  }
  return null;
}

/** Calculate the next demotion step for a target (returns new role or null). */
function nextDemotion(admin, target) {
  if (!canManageUser(admin, target)) return null;
  for (let i = ROLE_STEPS.length - 1; i >= 0; i--) {
    if (ROLE_STEPS[i] < (target.role || 0)) return ROLE_STEPS[i];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Middleware factories — return Express middleware
// ═══════════════════════════════════════════════════════════════

function _render403(res, detail) {
  return res.status(403).render('page/error', {
    title: '错误', code: 403, message: '权限不足', detail, back: '/',
  });
}

/** Redirect to login if no session (HTML routes). */
function requireAuth(req, res, next) {
  if (!isAuthenticated(req.session.user)) return res.redirect('/auth/login');
  next();
}

/** JSON 401 if no session (API routes). */
function requireAuthAPI(req, res, next) {
  if (!isAuthenticated(req.session.user)) {
    return res.status(401).json({ ok: false, error: '请先登录' });
  }
  next();
}

/** Block if banned or missing email. */
function requireActive(req, res, next) {
  if (!isAuthenticated(req.session.user)) return res.redirect('/auth/login');
  const result = checkActive(req.session.user);
  if (!result.ok) {
    const detail = result.reason === 'banned'
      ? '你的账号已被管理员封禁'
      : '请前往设置页面绑定邮箱后再操作';
    return _render403(res, detail);
  }
  next();
}

/** Require minimum role level. */
function requireRole(minLevel) {
  return (req, res, next) => {
    if (!hasRole(req.session.user, minLevel)) {
      return _render403(res, '需要更高权限');
    }
    next();
  };
}

// ═══════════════════════════════════════════════════════════════
// Session helpers
// ═══════════════════════════════════════════════════════════════

/** Build a session-safe user object from a DB row. */
function sessionUserFromDB(dbUser) {
  if (!dbUser) return null;
  return {
    id: dbUser.id,
    username: dbUser.username,
    display_name: dbUser.display_name,
    role: dbUser.role,
    avatar: dbUser.avatar,
    xp: dbUser.xp,
    level: dbUser.level,
    email: dbUser.email,
    needsEmail: !dbUser.email,
  };
}

/** Refresh session user from DB (returns updated session user or null if deleted). */
function refreshSession(session) {
  if (!session.user) return null;
  const u = getDB().prepare(`
    SELECT id, username, xp, level, banned, banned_until, deleted_at, display_name, avatar, role, email
    FROM users WHERE id = ?
  `).get(session.user.id);

  if (!u || u.deleted_at) {
    session.user = null;
    return null;
  }

  // Auto-unban if expired
  if (u.banned && u.banned_until) {
    const until = new Date(u.banned_until + 'Z').getTime();
    if (Date.now() > until) {
      getDB().prepare('UPDATE users SET banned = 0, banned_until = NULL WHERE id = ?').run(u.id);
      u.banned = 0;
    }
  }

  // Recalculate level from XP
  const xpRepo = require('../repo/xp');
  let correctLevel = u.level;
  while (u.xp >= xpRepo.xpForLevel(correctLevel + 1)) correctLevel++;
  if (correctLevel !== u.level) {
    getDB().prepare('UPDATE users SET level = ? WHERE id = ?').run(correctLevel, u.id);
    u.level = correctLevel;
  }

  session.user = { ...session.user, ...sessionUserFromDB(u) };
  session._lastRefresh = Date.now();
  return session.user;
}

// ═══════════════════════════════════════════════════════════════
// Display helpers
// ═══════════════════════════════════════════════════════════════

function roleLabel(role) {
  if (role >= LEVEL.OWNER) return '站长';
  if (role >= LEVEL.SUPER) return '超级管理员';
  if (role >= LEVEL.ADMIN) return '管理员';
  if (role >= LEVEL.MOD) return '操作员';
  return '用户';
}

function roleBadge(role) {
  if (role >= LEVEL.OWNER) return { text: roleLabel(LEVEL.OWNER), bg: '#f3e5f5', color: '#8e44ad' };
  if (role >= LEVEL.SUPER) return { text: roleLabel(LEVEL.SUPER), bg: '#fce4e4', color: '#c0392b' };
  if (role >= LEVEL.ADMIN) return { text: roleLabel(LEVEL.ADMIN), bg: '#fef5e7', color: '#e67e22' };
  if (role >= LEVEL.MOD) return { text: roleLabel(LEVEL.MOD), bg: '#eaf0f8', color: '#2b7cbe' };
  return { text: roleLabel(LEVEL.USER), bg: '#ecf0f1', color: '#7f8c8d' };
}

/** Compute XP progress for a user (for display). */
function xpProgress(user) {
  const xpRepo = require('../repo/xp');
  const cur = xpRepo.xpForLevel(user.level || 1);
  const nxt = xpRepo.xpForLevel((user.level || 1) + 1);
  return {
    xpBase: cur,
    xpNextTotal: nxt,
    xpNext: nxt - cur,
    xpProgress: nxt > cur ? Math.round(((user.xp || 0) - cur) / (nxt - cur) * 100) : 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// Re-export middleware names for compatibility
// ═══════════════════════════════════════════════════════════════
const requireLogin = requireAuth;
const requireLoginAPI = requireAuthAPI;

module.exports = {
  // Constants
  LEVEL,
  ROLE_STEPS,

  // Predicates
  isAuthenticated,
  hasRole,
  outranks,
  isActive,
  checkActive,
  isOwner,
  canEditPost,
  canDeletePost,
  canDeleteComment,
  canAccessAdmin,
  canPurge,
  canViewDeleted,
  canModerate,
  canCreateSection,
  isSectionOwner,
  isSectionModerator,
  canModerateSection,
  canManageUser,
  canBanUser,
  canDeleteUser,
  nextPromotion,
  nextDemotion,

  // Middleware
  requireAuth,
  requireAuthAPI,
  requireActive,
  requireRole,
  requireLogin,      // alias for requireAuth
  requireLoginAPI,   // alias for requireAuthAPI

  // Session
  sessionUserFromDB,
  refreshSession,

  // Display
  roleLabel,
  roleBadge,
  xpProgress,
};
