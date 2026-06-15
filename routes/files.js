const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db } = require('../lib/db');
const r2 = require('../lib/r2');
const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', 'data', 'attachments');
if (!r2.enabled() && !fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 });

// Safe extensions whitelist — no executables
const SAFE_EXT = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml', 'toml',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'py', 'js', 'ts', 'html', 'css', 'c', 'cpp', 'h', 'rs', 'go', 'java', 'rb',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp3', 'mp4', 'wav', 'ogg', 'webm',
]);

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/auth/login');
  next();
}

// Fix double-encoded filenames from browser multipart uploads.
// Browsers encode non-ASCII filenames as UTF-8 in the Content-Disposition header,
// but some multipart parsers (busboy/multer) treat the bytes as latin1 → double encoding.
function fixFilename(name) {
  if (!/[^\x00-\x7F]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (/[一-鿿぀-ゟ゠-ヿ]/.test(decoded)) return decoded;
  } catch (_) {}
  return name;
}

function cdFilename(fn) {
  const latin1 = Buffer.from(fn, 'utf8').toString('latin1');
  const encoded = encodeURIComponent(fn);
  return `attachment; filename="${latin1}"; filename*=UTF-8''${encoded}`;
}

// Random stored name to prevent clashes and guessing
function storedName(ext) { return crypto.randomBytes(12).toString('hex') + ext; }

const upload = multer({
  storage: r2.enabled() ? multer.memoryStorage() : multer.diskStorage({
    destination: STORAGE_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, storedName(ext));
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (!SAFE_EXT.has(ext)) {
      return cb(new Error('不支持的文件类型: .' + ext), false);
    }
    cb(null, true);
  }
});

// List all attachments (paginated, searchable)
router.get('/', requireLogin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const q = (req.query.q || '').trim();
  const limit = 20;
  const offset = (page - 1) * limit;

  let files, total;
  if (q) {
    files = db.prepare(`
      SELECT a.*, u.username, u.display_name FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.filename LIKE ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all('%' + q + '%', limit, offset);
    total = db.prepare('SELECT COUNT(*) as c FROM attachments WHERE filename LIKE ?').get('%' + q + '%');
  } else {
    files = db.prepare(`
      SELECT a.*, u.username, u.display_name FROM attachments a JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    total = db.prepare('SELECT COUNT(*) as c FROM attachments').get();
  }

  const paths = db.prepare("SELECT DISTINCT virtual_path FROM attachments WHERE virtual_path != '/' ORDER BY virtual_path").all();

  res.render('files', {
    title: '网盘',
    files, page, query: q, paths,
    totalPages: Math.ceil(total.c / limit),
  });
});

// Upload
router.post('/upload', requireLogin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择文件' });

  const vpath = (req.body.path || '/').replace(/\.\./g, '').replace(/\/+/g, '/');
  let storedNameVal, fileSize;

  if (r2.enabled()) {
    // Upload to R2
    const key = r2.r2Key('files', req.file.originalname);
    try {
      await r2.upload(key, req.file.buffer, req.file.mimetype);
    } catch (e) {
      console.error('[files] R2 upload error:', e.message);
      return res.status(500).json({ error: '上传失败，请重试' });
    }
    storedNameVal = key;
    fileSize = req.file.buffer.length;
  } else {
    // Local storage
    storedNameVal = req.file.filename;
    fileSize = req.file.size;
  }

  const filename = fixFilename(req.file.originalname);

  db.prepare(`INSERT INTO attachments (user_id, filename, stored_name, virtual_path, file_size, mime_type)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.session.user.id, filename, storedNameVal,
         vpath || '/', fileSize, req.file.mimetype || '');

  res.json({ ok: true, filename: filename, id: db.prepare('SELECT last_insert_rowid() as id').get().id });
});

// Download
router.get('/download/:id', async (req, res) => {
  const file = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).send('Not found');

  db.prepare('UPDATE attachments SET download_count = download_count + 1 WHERE id = ?').run(file.id);

  if (r2.enabled()) {
    // Redirect to R2 presigned URL
    const url = await r2.downloadUrl(file.stored_name, file.filename);
    if (url) return res.redirect(url);
    return res.status(404).send('File unavailable');
  }

  // Local fallback
  const filePath = path.join(STORAGE_DIR, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).send('File missing');
  res.set('Content-Type', file.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', cdFilename(file.filename));
  res.set('Content-Length', file.file_size);
  res.set('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

// Delete (owner or admin)
router.post('/delete/:id', requireLogin, async (req, res) => {
  const file = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!file) return res.redirect('/files');
  if (file.user_id !== req.session.user.id && (req.session.user.role || 0) < 32) {
    return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '', back: '/files' });
  }

  if (r2.enabled()) {
    await r2.del(file.stored_name);
  } else {
    try { fs.unlinkSync(path.join(STORAGE_DIR, file.stored_name)); } catch (_) {}
  }
  db.prepare('DELETE FROM attachments WHERE id = ?').run(file.id);
  res.redirect('/files');
});

module.exports = router;
