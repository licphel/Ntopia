const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { initDB, db } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Init database
initDB();

// Ensure data directories
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
for (const d of [DATA_DIR, UPLOADS_DIR, SESSIONS_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Multer config
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
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
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 30 * 24 * 3600, // 30 days
    retries: 2
  }),
  secret: process.env.SESSION_SECRET || 'ntopia-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// EJS + Layout
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);

// Global template variables + session refresh
app.use((req, res, next) => {
  // Refresh session user data (XP, level, banned status)
  if (req.session.user) {
    try {
      const u = db.prepare('SELECT id, xp, level, banned, display_name, avatar, role FROM users WHERE id = ?').get(req.session.user.id);
      if (u) {
        // Auto-correct level if XP exceeds threshold
        const { xpForLevel } = require('./db');
        let correctLevel = u.level;
        while (u.xp >= xpForLevel(correctLevel + 1)) correctLevel++;
        if (correctLevel !== u.level) {
          db.prepare('UPDATE users SET level = ? WHERE id = ?').run(correctLevel, u.id);
          u.level = correctLevel;
        }
        req.session.user.xp = u.xp;
        req.session.user.level = u.level;
        req.session.user.display_name = u.display_name;
        req.session.user.avatar = u.avatar;
        req.session.user.role = u.role;
        // Compute XP progress
        const cur = xpForLevel(u.level);
        const nxt = xpForLevel(u.level + 1);
        req.session.user.xpBase = cur;
        req.session.user.xpNextTotal = nxt;
        req.session.user.xpProgress = nxt > cur ? Math.round((u.xp - cur) / (nxt - cur) * 100) : 100;
        req.session.user.xpNext = nxt - cur;
        req.session._touch = Date.now();
        // Unread counts
        const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0').get(u.id);
        const unreadMsgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_id = ? AND is_read = 0').get(u.id);
        res.locals.unreadNotifs = unread.c;
        res.locals.unreadMessages = unreadMsgs.c;
        if (u.banned) {
          req.session.destroy();
          return res.redirect('/auth/login?banned=1');
        }
      }
      // If user not found, keep session — could be transient DB issue
    } catch(e) {
      // DB error — keep session alive, don't punish user
    }
  }
  res.locals.user = req.session.user || null;
  if (res.locals.user) {
    const { xpForLevel } = require('./db');
    const cur = xpForLevel(res.locals.user.level || 1);
    const nxt = xpForLevel((res.locals.user.level || 1) + 1);
    res.locals.user.xpBase = cur;
    res.locals.user.xpNextTotal = nxt;
    res.locals.user.xpNext = nxt - cur;
    res.locals.user.xpProgress = res.locals.user.xpNext > 0 ? Math.round(((res.locals.user.xp || 0) - cur) / res.locals.user.xpNext * 100) : 100;
  }
  res.locals.path = req.path;
  if (!res.locals.unreadNotifs) { res.locals.unreadNotifs = 0; res.locals.unreadMessages = 0; }

  // Sidebar data (light queries, cached in DB)
  try {
    // Admin info for sidebar
    res.locals.admin = db.prepare('SELECT id, username, display_name, avatar, bio FROM users WHERE id = 1').get() || { username: 'admin', display_name: 'Administrator', avatar: '/img/default-avatar.svg', bio: '' };

    res.locals.recentPosts = db.prepare(
      "SELECT id, title, slug, created_at FROM posts WHERE type = 'post' AND is_deleted = 0 ORDER BY created_at DESC LIMIT 10"
    ).all();
    res.locals.recentComments = db.prepare(`
      SELECT c.id, c.created_at, u.username, u.display_name, c.content_html as cmt_content, p.title as post_title, p.slug as post_slug, p.type as post_type
      FROM comments c JOIN users u ON c.author_id = u.id JOIN posts p ON c.post_id = p.id
      WHERE p.is_deleted = 0
      ORDER BY c.created_at DESC LIMIT 10
    `).all();
    const tags = db.prepare("SELECT DISTINCT tags FROM posts WHERE type = 'post' AND tags != ''").all();
    const seen = new Set();
    const tagList = [];
    for (const t of tags) {
      for (const tag of (t.tags || '').split(',')) {
        const trimmed = tag.trim();
        if (trimmed && !seen.has(trimmed)) { seen.add(trimmed); tagList.push(trimmed); }
      }
    }
    res.locals.tagList = tagList.slice(0, 20);
  } catch(e) {
    res.locals.recentPosts = [];
    res.locals.recentComments = [];
    res.locals.tagList = [];
  }

  next();
});

// Set EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Image upload with compression
app.post('/upload', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  next();
}, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const inPath = req.file.path;
    const outName = req.file.filename.replace(/\.[^.]+$/, '.webp');
    const outPath = path.join(UPLOADS_DIR, outName);

    await sharp(inPath)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .withMetadata({ exif: {} }) // strip EXIF for privacy
      .toFile(outPath);

    // Remove original if different format
    if (inPath !== outPath) fs.unlinkSync(inPath);

    res.json({ ok: true, url: '/uploads/' + outName });
  } catch(e) {
    console.error('Compress error:', e.message);
    // Fallback: return original
    res.json({ ok: true, url: '/uploads/' + req.file.filename });
  }
});

// Routes
app.use('/', require('./routes/posts'));
app.use('/forum', require('./routes/forum'));
app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/search', require('./routes/search'));
app.use('/admin', require('./routes/admin'));
app.use('/messages', require('./routes/messages'));
app.use('/notifications', require('./routes/notifications'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: '404 - Page Not Found' });
});

app.listen(PORT, () => {
  console.log(`Ntopia running at http://localhost:${PORT}`);
});
