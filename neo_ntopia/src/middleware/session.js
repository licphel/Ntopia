// Session refresh + template locals middleware.
const auth = require('../lib/auth');
const { xpRepo } = require('../repo');
const config = require('../config');
const time = require('../util/time');

function sessionRefresh(req, res, next) {
  if (!req.session.user) return next();
  try {
    const now = Date.now();
    if (now - (req.session._lastRefresh || 0) > 60000 || req.session._needsRefresh) {
      req.session._needsRefresh = false;
      req.session._lastRefresh = now;
      const user = auth.refreshSession(req.session);
      if (!user) return next();
    }
    Object.assign(req.session.user, auth.xpProgress(req.session.user));
    const badge = auth.roleBadge(req.session.user.role || 0);
    req.session.user.badge = badge.text;
    req.session.user.badgeLevel = 'LEVEL=' + (req.session.user.role || 0);
  } catch (_) {}
  next();
}

function locals(req, res, next) {
  res.locals.user = req.session.user || null;
  if (res.locals.user) {
    Object.assign(res.locals.user, auth.xpProgress(res.locals.user));
    Object.assign(res.locals.user, auth.roleBadge(res.locals.user.role || 0));
    res.locals.user.badgeLevel = 'LEVEL=' + (res.locals.user.role || 0);
  }
  res.locals.path = req.path;
  res.locals.siteUrl = config.SITE_URL;
  res.locals.roleBadge = auth.roleBadge;
  res.locals.timeTag = time.timeTag;
  res.locals.LEVEL = auth.LEVEL;

  // Sidebar data from view helper
  const { sidebarData } = require('../lib/view-data');
  Object.assign(res.locals, sidebarData());

  // Unread counts
  if (req.session.user) {
    try {
      const ns = require('../service/notification');
      const c = ns.getUnreadCounts(req.session.user.id);
      res.locals.unreadNotifs = c.notifs;
      res.locals.unreadMessages = c.messages;
    } catch (_) { res.locals.unreadNotifs = 0; res.locals.unreadMessages = 0; }
  } else {
    res.locals.unreadNotifs = 0;
    res.locals.unreadMessages = 0;
  }

  next();
}

module.exports = [sessionRefresh, locals];
