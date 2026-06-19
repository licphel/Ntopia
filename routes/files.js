const express = require('express');
const multer = require('multer');
const { requireLogin } = require('../lib/middleware');
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

// List attachments with folder view
router.get('/', requireLogin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const q = (req.query.q || '').trim();
  const vpath = (req.query.path || '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  const limit = 20;
  const offset = (page - 1) * limit;

  let files, total, folders = [];
  const vpathEscaped = vpath === '/' ? '/' : vpath;

  if (q) {
    // Global search
    files = db.prepare(`
      SELECT a.*, u.username, u.display_name FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.filename LIKE ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all('%' + q + '%', limit, offset);
    total = db.prepare('SELECT COUNT(*) as c FROM attachments WHERE filename LIKE ?').get('%' + q + '%');
  } else {
    // Folders: .folder markers + intermediate paths from deeper files
    const prefix = vpath === '/' ? '/' : vpath + '/';
    const prefixLen = prefix.length;
    const seen = new Set();
    folders = [];

    // 1. Explicit .folder markers under current path
    const markers = db.prepare("SELECT DISTINCT virtual_path FROM attachments WHERE virtual_path LIKE ? AND filename = '.folder'").all(prefix + '%');
    for (const m of markers) {
      const name = m.virtual_path.slice(prefixLen);
      const slash = name.indexOf('/');
      const dir = slash >= 0 ? name.slice(0, slash) : name;
      if (dir && !seen.has(dir)) { seen.add(dir); folders.push({ name: dir }); }
    }

    // 2. Intermediate folders from deeper real files (e.g. /docs/manual/a.pdf → folder /docs)
    const deepPaths = db.prepare("SELECT DISTINCT virtual_path FROM attachments WHERE virtual_path LIKE ? AND filename != '.folder'").all(prefix + '%');
    for (const p of deepPaths) {
      const sub = p.virtual_path.slice(prefixLen);
      const slash = sub.indexOf('/');
      if (slash >= 0) {
        const dir = sub.slice(0, slash);
        if (dir && !seen.has(dir)) { seen.add(dir); folders.push({ name: dir }); }
      }
    }

    // Files in current path
    files = db.prepare(`
      SELECT a.*, u.username, u.display_name FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.virtual_path = ? AND a.filename != '.folder' ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(vpathEscaped, limit, offset);
    total = db.prepare("SELECT COUNT(*) as c FROM attachments WHERE virtual_path = ? AND filename != '.folder'").get(vpathEscaped);
  }

  // Breadcrumb
  const crumbs = [{ name: '根目录', path: '/' }];
  if (vpath !== '/') {
    const parts = vpath.slice(1).split('/');
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      crumbs.push({ name: part, path: acc });
    }
  }

  const baseQuery = q ? '?q=' + encodeURIComponent(q) : '?path=' + encodeURIComponent(vpath);

  res.render('files', {
    title: q ? '搜索: ' + q : '网盘' + (vpath !== '/' ? ': ' + vpath : ''),
    files, page, query: q, vpath, folders, crumbs, baseQuery,
    totalPages: Math.ceil(total.c / limit),
  });

// List all folder paths (for toolbar picker)
router.get('/folders', requireLogin, (req, res) => {
  const paths = db.prepare("SELECT DISTINCT virtual_path FROM attachments WHERE virtual_path != '/' ORDER BY virtual_path").all();
  res.json({ folders: ['/', ...paths.map(p => p.virtual_path)] });
});

// Create folder (sentinel record so folder appears in listings)
router.post('/mkdir', requireLogin, (req, res) => {
  const parent = (req.body.parent || '/').replace(/\/+/g, '/');
  const name = (req.body.name || '').replace(/[/\\]/g, '').trim();
  if (!name) return res.json({ ok: false, error: '请输入文件夹名' });
  const fullPath = (parent === '/' ? '/' + name : parent + '/' + name);
  const exists = db.prepare('SELECT 1 FROM attachments WHERE virtual_path = ? AND filename = ?').get(fullPath, '.folder');
  if (exists) return res.json({ ok: false, error: '文件夹已存在' });
  db.prepare("INSERT INTO attachments (user_id, filename, stored_name, virtual_path, file_size, mime_type) VALUES (?, '.folder', '', ?, 0, 'inode/directory')")
    .run(req.session.user.id, fullPath);
  res.json({ ok: true, path: fullPath });
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
  const upPath = vpath || '/';

  db.prepare(`INSERT INTO attachments (user_id, filename, stored_name, virtual_path, file_size, mime_type)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.session.user.id, filename, storedNameVal,
         upPath, fileSize, req.file.mimetype || '');

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
