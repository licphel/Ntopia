const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const { db, LEVEL, roleBadge, xpForLevel } = require('./db');
const { generateToken, csrfMiddleware } = require('./csrf');

const app = express();

// Trust proxy for correct client IP behind Nginx
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
    }
  },
  crossOriginEmbedderPolicy: false
}));

// Ensure data directories with restrictive permissions
for (const d of [config.DATA_DIR, config.UPLOADS_DIR, config.SESSIONS_DIR, config.DATA_DIR + '/attachments']) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}
// Enforce restrictive permissions on existing session dir
try { fs.chmodSync(config.SESSIONS_DIR, 0o700); } catch (_) {}

// Session secret persistence
const sessionSecret = (() => {
  if (config.SESSION_SECRET) return config.SESSION_SECRET;
  const secretFile = path.join(config.DATA_DIR, 'session-secret');
  try { return fs.readFileSync(secretFile, 'utf8').trim(); } catch (_) { }
  const s = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, s, { mode: 0o600 });
  console.log('[session] Generated persistent session secret');
  return s;
})();

// Multer
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const storage = multer.diskStorage({
  destination: config.UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, require('./time').now().getTime() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME.includes(file.mimetype) || !ALLOWED_EXT.includes(ext)) {
      const err = new Error('仅允许上传图片文件 (JPEG/PNG/WebP)');
      err.status = 400;
      return cb(err, false);
    }
    cb(null, true);
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new FileStore({ path: config.SESSIONS_DIR, ttl: 30 * 24 * 3600, retries: 2, fileExtension: '.ses' }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' }
}));

// CSRF protection
app.use(csrfMiddleware);

app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limit: 100 requests per 15s per IP (after static files so assets don't count)
app.use(rateLimit({ windowMs: 15000, max: 100, standardHeaders: true, legacyHeaders: false }));

app.use((req, res, next) => {
  // Track page view (HTML pages only, not API/static)
  if (req.method === 'GET' && !req.path.startsWith('/upload') && !req.path.startsWith('/preview')
      && !req.path.startsWith('/auth/captcha') && !req.path.startsWith('/email/')
      && !req.path.startsWith('/likes/') && !req.path.startsWith('/bookmarks/')
      && !req.path.startsWith('/follow/') && !req.path.startsWith('/report/')
      && !req.path.startsWith('/tools/rb/') && !req.path.startsWith('/rss.xml')
      && !req.path.startsWith('/sitemap.xml') && req.path.indexOf('.') === -1) {
    db.prepare('INSERT INTO site_views (path, ip) VALUES (?, ?)').run(req.path.slice(0, 200), req.ip || '');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

// EJS + Layout
app.set('view engine', 'ejs');
app.set('layout', 'layout');
app.use(expressLayouts);

// First visit redirect
app.use((req, res, next) => {
  if (req.path === '/' && !req.session.user && !(req.headers.cookie || '').includes('visited=1')) {
    res.cookie('visited', '1', { maxAge: 365 * 24 * 3600 * 1000, httpOnly: false });
    return res.redirect('/auth/login');
  }
  next();
});

// Global template variables + session refresh
// Cache sidebar data (TTL 15s) to reduce per-request DB queries
let sidebarCache = null;
let sidebarCacheTime = 0;
const SIDEBAR_CACHE_TTL = 15 * 1000; // 15 seconds — short enough for fresh content

app.use((req, res, next) => {
  const now = require('./time').now().getTime();

  if (req.session.user) {
    try {
      // Only refresh session from DB every 60s unless XP was just updated
      const lastRefresh = req.session._lastRefresh || 0;
      if (now - lastRefresh > 60000 || req.session._needsRefresh) {
        req.session._needsRefresh = false;
        const u = db.prepare('SELECT id, xp, level, banned, banned_until, deleted_at, display_name, avatar, role, email FROM users WHERE id = ?').get(req.session.user.id);
        if (u) {
          // Deleted user — force logout
          if (u.deleted_at) { req.session.user = null; return next(); }
          // Auto-unban if ban has expired (skip for deleted users)
          if (u.banned && u.banned_until) {
            const until = new Date(u.banned_until + 'Z').getTime();
            if (require('./time').now().getTime() > until) {
              db.prepare('UPDATE users SET banned = 0, banned_until = NULL WHERE id = ?').run(u.id);
              u.banned = 0;
            }
          }
          let correctLevel = u.level;
          while (u.xp >= xpForLevel(correctLevel + 1)) correctLevel++;
          if (correctLevel !== u.level) {
            db.prepare('UPDATE users SET level = ? WHERE id = ?').run(correctLevel, u.id);
            u.level = correctLevel;
          }
          req.session.user.xp = u.xp;
          req.session.user.email = u.email || '';
          req.session.user.needsEmail = !u.email;
          req.session.user.level = u.level;
          req.session.user.display_name = u.display_name;
          req.session.user.avatar = u.avatar;
          req.session.user.role = u.role;
        }
        req.session._lastRefresh = now;
      }

      const cur = xpForLevel(req.session.user.level || 1);
      const nxt = xpForLevel((req.session.user.level || 1) + 1);
      req.session.user.xpBase = cur;
      req.session.user.xpNextTotal = nxt;
      req.session.user.xpProgress = nxt > cur ? Math.round((req.session.user.xp - cur) / (nxt - cur) * 100) : 100;
      req.session.user.xpNext = nxt - cur;

      const b = roleBadge(req.session.user.role || 0);
      req.session.user.badge = b.text;
      req.session.user.badgeLevel = 'LEVEL=' + (req.session.user.role || 0);

      // Unread counts — always fetch (lightweight single-row queries)
      const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(req.session.user.id);
      const unreadMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_id = ? AND is_read = 0').get(req.session.user.id);
      res.locals.unreadNotifs = unread.c;
      res.locals.unreadMessages = unreadMsgs.c;
    } catch (e) { }
  }
  res.locals.user = req.session.user || null;
  if (res.locals.user) {
    const cur = xpForLevel(res.locals.user.level || 1);
    const nxt = xpForLevel((res.locals.user.level || 1) + 1);
    res.locals.user.xpBase = cur;
    res.locals.user.xpNextTotal = nxt;
    res.locals.user.xpNext = nxt - cur;
    res.locals.user.xpProgress = res.locals.user.xpNext > 0 ? Math.round(((res.locals.user.xp || 0) - cur) / res.locals.user.xpNext * 100) : 100;
    Object.assign(res.locals.user, roleBadge(res.locals.user.role || 0));
    res.locals.user.badgeLevel = 'LEVEL=' + (res.locals.user.role || 0);
  }
  res.locals.path = req.path;
  res.locals.siteUrl = process.env.SITE_URL || 'https://ntopia.top';
  res.locals.csrf = generateToken(req.session);
  res.locals.LEVEL = LEVEL;
  res.locals.roleBadge = roleBadge;
  res.locals.timeTag = require('./time').timeTag;
  if (!res.locals.unreadNotifs) { res.locals.unreadNotifs = 0; res.locals.unreadMessages = 0; }

  // InfoBar pages (rarely change)
  try {
    const pagesDir = path.join(__dirname, '..', 'pages');
    const pageFiles = fs.readdirSync(pagesDir).filter(f => f.endsWith('.md'));
    res.locals.infoPages = pageFiles.map(f => {
      const raw = fs.readFileSync(path.join(pagesDir, f), 'utf8');
      const slug = f.replace('.md', '');
      let title = slug;
      if (raw.startsWith('---')) { const end = raw.indexOf('---', 3); if (end > 0) { const m = raw.slice(3, end).match(/title:\s*(.+)/); if (m) title = m[1].trim(); } }
      return { title, slug, url: '/pages/' + slug };
    });
  } catch (e) { res.locals.infoPages = []; }

  // Posters (rarely change)
  try {
    const postersDir = path.join(__dirname, '..', 'public', 'posters');
    if (fs.existsSync(postersDir)) {
      res.locals.posters = fs.readdirSync(postersDir).filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).map(f => '/posters/' + f);
    }
  } catch (e) { }
  if (!res.locals.posters || !res.locals.posters.length) res.locals.posters = null;

  // Sidebar data — cached for 60s
  if (!sidebarCache || now - sidebarCacheTime > SIDEBAR_CACHE_TTL) {
    try {
      sidebarCache = {
        admin: db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE id = 1').get() || { username: 'admin', display_name: 'Administrator', avatar: '/img/default-avatar.png', bio: '' },
        recentPosts: db.prepare("SELECT id, title, slug, created_at FROM posts WHERE is_deleted = 0 AND is_draft = 0 ORDER BY created_at DESC LIMIT 10").all(),
        recentComments: db.prepare(`
          SELECT c.id, c.created_at, u.username, u.display_name, c.content_html as cmt_content, p.title as post_title, p.slug as post_slug
          FROM comments c JOIN users u ON c.author_id = u.id JOIN posts p ON c.post_id = p.id
          WHERE p.is_deleted = 0 ORDER BY c.created_at DESC LIMIT 10
        `).all(),
        tagList: (() => {
          const tags = db.prepare("SELECT DISTINCT tags FROM posts WHERE tags != '' AND is_deleted = 0 AND is_draft = 0").all();
          const seen = new Set(); const tagList = [];
          for (const t of tags) { for (const tag of (t.tags || '').split(',')) { const trimmed = tag.trim(); if (trimmed && !seen.has(trimmed)) { seen.add(trimmed); tagList.push(trimmed); } } }
          return tagList.slice(0, 20);
        })(),
        stats: {
          posts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 AND is_draft = 0").get().c,
          comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE is_deleted = 0 OR is_deleted IS NULL").get().c,
          users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
          views: db.prepare('SELECT COUNT(*) as c FROM site_views').get().c,
          likes: db.prepare('SELECT COUNT(*) as c FROM likes').get().c,
          bookmarks: db.prepare('SELECT COUNT(*) as c FROM bookmarks').get().c,
          checkins: db.prepare('SELECT COUNT(*) as c FROM checkins').get().c,
        },
      };
      sidebarCacheTime = now;
    } catch (e) {
      sidebarCache = { recentPosts: [], recentComments: [], tagList: [] };
    }
  }
  Object.assign(res.locals, sidebarCache);

  next();
});

// Upload endpoint
app.post('/upload', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const inPath = req.file.path;
  const r2 = require('./r2');
  try {
    const outName = req.file.filename.replace(/\.[^.]+$/, '.webp');
    const outPath = path.join(config.UPLOADS_DIR, outName);

    await sharp(inPath).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).withMetadata({ exif: {} }).toFile(outPath);
    if (inPath !== outPath) fs.unlinkSync(inPath);

    // Upload to R2 if configured
    if (r2.enabled()) {
      const buf = fs.readFileSync(outPath);
      const key = r2.r2Key('img', outName);
      const url = await r2.upload(key, buf, 'image/webp');
      fs.unlinkSync(outPath);
      res.json({ ok: true, url });
    } else {
      res.json({ ok: true, url: '/uploads/' + outName });
    }
  } catch (e) {
    console.error('Compress error:', e.message);
    try { fs.unlinkSync(inPath); } catch (_) {}
    res.status(400).json({ error: '图片处理失败，请尝试其他格式' });
  }
});

// Markdown preview endpoint (for editor live preview)
const { renderMarkdown } = require('./helpers');
app.post('/preview', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  const html = renderMarkdown(req.body.content || '');
  res.json({ html });
});

// Multer error handler (fileFilter rejection, size limit, etc.)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: '文件超过大小限制（最大 5MB）' });
  }
  if (err.status === 400 && err.message) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// Routes
const comments = require('../routes/comments');
app.use('/posts', comments);

app.use('/', require('../routes/posts'));
app.use('/auth', require('../routes/auth'));
app.use('/users', require('../routes/users'));
app.use('/search', require('../routes/search'));
app.use('/admin', require('../routes/admin'));
app.use('/messages', require('../routes/messages'));
app.use('/notifications', require('../routes/notifications'));
app.use('/likes', require('../routes/likes'));
app.use('/bookmarks', require('../routes/bookmarks'));
app.use('/tags', require('../routes/tags'));
app.use('/sitemap.xml', require('../routes/sitemap'));
app.use('/rss.xml', require('../routes/rss'));
app.use('/pages', require('../routes/pages'));
app.use('/settings', require('../routes/settings'));
app.use('/files', require('../routes/files'));
app.use('/follow', require('../routes/follow'));
app.use('/report', require('../routes/report'));
app.use('/email', require('../routes/email'));
app.use('/tools', require('../routes/tools'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: '404 - Page Not Found' });
});

module.exports = app;
