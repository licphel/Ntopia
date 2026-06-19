// Session plugin — Fastify session with file store + user refresh.
const path = require('path');
const config = require('../config');

async function sessionPlugin(fastify, opts) {
  const FileStore = require('session-file-store')(require('express-session'));
  const store = new FileStore({
    path: config.SESSIONS_DIR,
    ttl: config.SESSION_MAX_AGE,
    fileExtension: '.ses',
  });

  // Fastify's @fastify/session wraps express-session
  await fastify.register(require('@fastify/session'), {
    secret: opts.secret,
    store,
    saveUninitialized: false,
    resave: false,
    cookie: {
      maxAge: config.SESSION_MAX_AGE_MS,
      sameSite: 'lax',
      secure: false,
    },
  });

  // Decorate request with user
  fastify.decorateRequest('user', null);

  // Session refresh hook
  fastify.addHook('preHandler', (request, reply, done) => {
    request.user = request.session?.user || null;
    if (!request.user) return done();

    try {
      const now = Date.now();
      const lastRefresh = request.session?._lastRefresh || 0;
      if (now - lastRefresh > 60000 || request.session?._needsRefresh) {
        if (request.session) request.session._needsRefresh = false;
        const auth = require('../lib/auth');
        auth.refreshSession(request.session);
        request.user = request.session?.user || null;
        if (request.session) request.session._lastRefresh = now;
      }

      // XP progress for template
      if (request.user) {
        const xpRepo = require('../repo/xp');
        const cur = xpRepo.xpForLevel(request.user.level || 1);
        const nxt = xpRepo.xpForLevel((request.user.level || 1) + 1);
        request.user.xpBase = cur;
        request.user.xpNextTotal = nxt;
        request.user.xpProgress = nxt > cur ? Math.round((request.user.xp - cur) / (nxt - cur) * 100) : 100;
        request.user.xpNext = nxt - cur;
        const badge = require('../lib/auth').roleBadge(request.user.role || 0);
        request.user.badge = badge.text;
        request.user.badgeLevel = 'LEVEL=' + (request.user.role || 0);
      }
    } catch (_) {}

    done();
  });

  // Template locals — set before view render
  fastify.addHook('preHandler', (request, reply, done) => {
    const auth = require('../lib/auth');
    reply.locals = reply.locals || {};
    reply.locals.user = request.user || null;
    reply.locals.path = request.url;
    reply.locals.siteUrl = config.SITE_URL;
    reply.locals.roleBadge = auth.roleBadge;
    reply.locals.timeTag = require('../util/time').timeTag;
    reply.locals.LEVEL = auth.LEVEL;

    // Unread counts
    if (request.user) {
      try {
        const nService = require('../service/notification');
        const counts = nService.getUnreadCounts(request.user.id);
        reply.locals.unreadNotifs = counts.notifs;
        reply.locals.unreadMessages = counts.messages;
      } catch (_) {
        reply.locals.unreadNotifs = 0;
        reply.locals.unreadMessages = 0;
      }
    } else {
      reply.locals.unreadNotifs = 0;
      reply.locals.unreadMessages = 0;
    }
    done();
  });

  // First visit → redirect to login
  fastify.addHook('preHandler', (request, reply, done) => {
    if (request.url === '/' && !request.user && !(request.headers.cookie || '').includes('visited=1')) {
      reply.header('Set-Cookie', 'visited=1; Max-Age=31536000; Path=/');
      return reply.redirect('/auth/login');
    }
    done();
  });
}

module.exports = sessionPlugin;
