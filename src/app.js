// Express server — EJS SSR with modular architecture.
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const expressLayouts = require('express-ejs-layouts');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('./config');

const app = express();
app.set('trust proxy', 1);

// ── Security ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"], scriptSrcAttr: ["'unsafe-inline'"] } },
  crossOriginEmbedderPolicy: false,
}));

// ── Data dirs ────────────────────────────────────────────────
for (const d of [config.DATA_DIR, config.UPLOADS_DIR, config.SESSIONS_DIR, config.ATTACHMENTS_DIR]) {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
}
try { for (const f of fs.readdirSync(config.SESSIONS_DIR)) { if (f.endsWith('.lock')) fs.unlinkSync(path.join(config.SESSIONS_DIR, f)); } } catch (_) {}

// ── Session ──────────────────────────────────────────────────
const sessionSecret = config.SESSION_SECRET || (() => {
  const f = path.join(config.DATA_DIR, 'session-secret');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) {}
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
})();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new FileStore({ path: config.SESSIONS_DIR, ttl: config.SESSION_MAX_AGE, fileExtension: '.ses' }),
  secret: sessionSecret, resave: false, saveUninitialized: false,
  cookie: { maxAge: config.SESSION_MAX_AGE_MS, sameSite: 'lax' },
}));

// ── CSRF + Rate limit + Static ───────────────────────────────
app.use(require('./middleware/csrf'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(rateLimit({ windowMs: config.RATE_WINDOW_MS, max: config.RATE_MAX_REQUESTS, standardHeaders: true, legacyHeaders: false }));

// ── View engine — use parent project's views for identical styling ──
app.set('view engine', 'ejs');
app.set('layout', 'layout');
app.use(expressLayouts);
app.set('views', [
  path.join(__dirname, '..', 'view'),
  path.join(__dirname, '..', '..', 'views'),
]);

// ── Page view tracking ───────────────────────────────────────
const postRepo = require('./repo/post');
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/upload') && !req.path.startsWith('/auth/captcha')
      && !req.path.startsWith('/likes/') && !req.path.startsWith('/bookmarks/') && !req.path.startsWith('/follow/')
      && !req.path.startsWith('/report/') && !req.path.startsWith('/rss.xml') && !req.path.startsWith('/sitemap.xml')
      && req.path.indexOf('.') === -1) {
    postRepo.trackView(req.path, req.ip || '');
  }
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  next();
});

// ── First visit → login ──────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/' && !req.session.user && !(req.headers.cookie || '').includes('visited=1')) {
    res.cookie('visited', '1', { maxAge: 365 * 24 * 3600 * 1000, httpOnly: false });
    return res.redirect('/forum');
  }
  next();
});

// ── Session refresh + locals ─────────────────────────────────
const [sessionRefresh, locals] = require('./middleware/session');
app.use(sessionRefresh);
app.use(locals);

// ── Auth middleware (not app.use — exported as named functions for routes) ──

// ── Upload ───────────────────────────────────────────────────
const multer = require('multer');
const sharp = require('sharp');
app.post('/upload', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  next();
}, multer({
  storage: multer.diskStorage({ destination: config.UPLOADS_DIR, filename: (r, f, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(f.originalname)) }),
  limits: { fileSize: config.MAX_IMAGE_SIZE },
  fileFilter: (r, f, cb) => { const ext = path.extname(f.originalname).toLowerCase(); cb(null, config.ALLOWED_IMAGE_MIME.includes(f.mimetype) && config.ALLOWED_IMAGE_EXT.includes(ext)); },
}).single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  try {
    const fileService = require('./service/file');
    const result = await fileService.processImage(req.file.path, req.file.originalname);
    res.json(result);
  } catch (e) { try { fs.unlinkSync(req.file.path); } catch (_) {} res.status(400).json({ error: '图片处理失败' }); }
});

// Email send (no auth needed — for registration/password reset)
const emailLimiter = rateLimit({ windowMs: 60000, max: 1, message: { ok: false, error: '60秒内只能发送一次' } });
app.post('/email/send', emailLimiter, async (req, res) => {
  const { email } = req.body;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.json({ ok: false, error: '邮箱格式错误' });
  const emailService = require('./service/email');
  const code = emailService.generateCode(); emailService.setCode(email, code);
  try { await emailService.sendCode(email, code); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: '邮件发送失败，请稍后重试' }); }
});

app.post('/preview', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  res.json({ html: require('./util/markdown').renderMarkdown(req.body.content || '') });
});

app.use((err, req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '文件超过大小限制（最大 5MB）' });
  if (err.status === 400 && err.message) return res.status(400).json({ error: err.message });
  _next(err);
});

// ── Routes ───────────────────────────────────────────────────
const { mountAll } = require('./router');
mountAll(app);

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => { res.status(404).render('page/404', { title: '404' }); });

module.exports = app;
