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

// Global rate limit: 100 requests per 15s per IP
app.use(rateLimit({ windowMs: 15000, max: 100, standardHeaders: true, legacyHeaders: false }));

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

// Ensure data directories
for (const d of [config.DATA_DIR, config.UPLOADS_DIR, config.SESSIONS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Session secret persistence
const sessionSecret = (() => {
  if (config.SESSION_SECRET) return config.SESSION_SECRET;
  const secretFile = path.join(config.DATA_DIR, 'session-secret');
  try { return fs.readFileSync(secretFile, 'utf8').trim(); } catch(_) {}
  const s = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, s);
  console.log('[session] Generated persistent session secret');
  return s;
})();

// Multer
const storage = multer.diskStorage({
  destination: config.UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new FileStore({ path: config.SESSIONS_DIR, ttl: 30 * 24 * 3600, retries: 2 }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// CSRF protection
app.use(csrfMiddleware);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res, next) => {
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
app.use((req, res, next) => {
  if (req.session.user) {
    try {
      const u = db.prepare('SELECT id, xp, level, banned, display_name, avatar, role, email FROM users WHERE id = ?').get(req.session.user.id);
      if (u) {
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

        const cur = xpForLevel(u.level);
        const nxt = xpForLevel(u.level + 1);
        req.session.user.xpBase = cur;
        req.session.user.xpNextTotal = nxt;
        req.session.user.xpProgress = nxt > cur ? Math.round((u.xp - cur) / (nxt - cur) * 100) : 100;
        req.session.user.xpNext = nxt - cur;

        const b = roleBadge(u.role || 0);
        req.session.user.badge = b.text;
        req.session.user.badgeLevel = 'LEVEL=' + (u.role || 0);

        const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(u.id);
        const unreadMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_id = ? AND is_read = 0').get(u.id);
        res.locals.unreadNotifs = unread.c;
        res.locals.unreadMessages = unreadMsgs.c;
      }
    } catch(e) {}
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
  res.locals.csrf = generateToken(req.session);
  res.locals.LEVEL = LEVEL;
  res.locals.roleBadge = roleBadge;
  if (!res.locals.unreadNotifs) { res.locals.unreadNotifs = 0; res.locals.unreadMessages = 0; }

  // InfoBar pages
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
  } catch(e) { res.locals.infoPages = []; }

  // Posters
  try {
    const postersDir = path.join(__dirname, '..', 'public', 'posters');
    if (fs.existsSync(postersDir)) {
      res.locals.posters = fs.readdirSync(postersDir).filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f)).map(f => '/posters/' + f);
    }
  } catch(e) {}
  if (!res.locals.posters || !res.locals.posters.length) res.locals.posters = null;

  // Sidebar data
  try {
    res.locals.admin = db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE id = 1').get() || { username: 'admin', display_name: 'Administrator', avatar: '/img/default-avatar.svg', bio: '' };
    res.locals.recentPosts = db.prepare("SELECT id, title, slug, created_at FROM posts WHERE is_deleted = 0 AND is_draft = 0 ORDER BY created_at DESC LIMIT 10").all();
    res.locals.recentComments = db.prepare(`
      SELECT c.id, c.created_at, u.username, u.display_name, c.content_html as cmt_content, p.title as post_title, p.slug as post_slug
      FROM comments c JOIN users u ON c.author_id = u.id JOIN posts p ON c.post_id = p.id
      WHERE p.is_deleted = 0 ORDER BY c.created_at DESC LIMIT 10
    `).all();
    const tags = db.prepare("SELECT DISTINCT tags FROM posts WHERE tags != '' AND is_deleted = 0 AND is_draft = 0").all();
    const seen = new Set(); const tagList = [];
    for (const t of tags) { for (const tag of (t.tags || '').split(',')) { const trimmed = tag.trim(); if (trimmed && !seen.has(trimmed)) { seen.add(trimmed); tagList.push(trimmed); } } }
    res.locals.tagList = tagList.slice(0, 20);

    res.locals.stats = {
      posts: db.prepare("SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 AND is_draft = 0").get().c,
      comments: db.prepare("SELECT COUNT(*) as c FROM comments WHERE is_deleted = 0 OR is_deleted IS NULL").get().c,
      users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    };
  } catch(e) {
    res.locals.recentPosts = []; res.locals.recentComments = []; res.locals.tagList = [];
  }

  next();
});

// Upload endpoint
app.post('/upload', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const inPath = req.file.path;
    const outName = req.file.filename.replace(/\.[^.]+$/, '.webp');
    const outPath = path.join(config.UPLOADS_DIR, outName);
    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.gif') {
      const outName2 = req.file.filename.replace(/\.[^.]+$/, '.gif');
      const outPath2 = path.join(config.UPLOADS_DIR, outName2);
      try { fs.renameSync(inPath, outPath2); } catch(_) { fs.copyFileSync(inPath, outPath2); fs.unlinkSync(inPath); }
      return res.json({ ok: true, url: '/uploads/' + outName2 });
    }
    await sharp(inPath).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).withMetadata({ exif: {} }).toFile(outPath);
    if (inPath !== outPath) fs.unlinkSync(inPath);
    res.json({ ok: true, url: '/uploads/' + outName });
  } catch(e) {
    console.error('Compress error:', e.message);
    res.json({ ok: true, url: '/uploads/' + req.file.filename });
  }
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
app.use('/sitemap.xml', require('../routes/sitemap'));
app.use('/rss.xml', require('../routes/rss'));
app.use('/pages', require('../routes/pages'));
app.use('/settings', require('../routes/settings'));
app.use('/email', require('../routes/email'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: '404 - Page Not Found' });
});

module.exports = app;
