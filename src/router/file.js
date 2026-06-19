// File routes.
const express = require('express');
const path = require('path');
const config = require('../config');
const fileService = require('../service/file');
const r2 = require('../service/r2');
const auth = require('../lib/auth');
const router = express.Router();

router.get('/', auth.requireAuth, (req, res) => {
  const vpath = (req.query.path || '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  const q = (req.query.q || '').trim();
  const page = parseInt(req.query.page) || 1;
  const data = fileService.listAttachments(vpath, q, page);
  const crumbs = [{ name: '根目录', path: '/' }];
  if (vpath !== '/') { const parts = vpath.slice(1).split('/'); let acc = ''; for (const p of parts) { acc += '/' + p; crumbs.push({ name: p, path: acc }); } }
  res.render('page/files', {
    title: q ? '搜索: ' + q : '网盘' + (vpath !== '/' ? ': ' + vpath : ''),
    files: data.files, page, query: q, vpath, folders: data.folders, crumbs, baseQuery: q ? '?q=' + encodeURIComponent(q) : '?path=' + encodeURIComponent(vpath),
    totalPages: Math.ceil(data.total / config.ATTACHMENT_PAGE_SIZE),
  });
});

router.get('/folders', auth.requireAuth, (req, res) => res.json({ folders: fileService.allFolders() }));
router.post('/mkdir', auth.requireAuth, (req, res) => res.json(fileService.createFolder(req.session.user.id, req.body.parent, req.body.name)));

router.post('/upload', auth.requireAuth, async (req, res) => {
  const multer = require('multer');
  const upload = multer({
    storage: r2.isEnabled() ? multer.memoryStorage() : multer.diskStorage({ destination: config.ATTACHMENTS_DIR, filename: (r, f, cb) => { cb(null, fileService.storedName(path.extname(f.originalname))); } }),
    limits: { fileSize: config.MAX_ATTACHMENT_SIZE },
    fileFilter: (r, f, cb) => cb(null, fileService.validateAttachment(path.extname(f.originalname))),
  }).single('file');
  const file = await new Promise((res, rej) => upload(req, res, (e) => e ? rej(e) : res(req.file)));
  if (!file) return res.status(400).json({ error: '请选择文件' });
  const r = await fileService.storeAttachment(file, req.body.path, req.session.user.id);
  if (!r.ok) return res.status(500).json({ error: r.error });
  res.json({ ok: true, filename: r.filename });
});

router.get('/download/:id', async (req, res) => {
  const data = fileService.getDownload(req.params.id);
  if (!data) return res.status(404).send('Not found');
  if (data.redirect) { const url = await fileService.getR2DownloadUrl(data.file); if (url) return res.redirect(url); return res.status(404).send('File unavailable'); }
  res.set('Content-Type', data.file.mime_type || 'application/octet-stream');
  res.set('Content-Disposition', fileService.contentDisposition(data.file.filename));
  res.set('Content-Length', data.file.file_size);
  require('fs').createReadStream(data.localPath).pipe(res);
});

router.post('/delete/:id', auth.requireAuth, async (req, res) => {
  const r = await fileService.deleteAttachment(req.params.id, req.session.user);
  if (!r.ok) return res.status(403).render('page/error', { title: '错误', code: 403, message: r.error, detail: '', back: '/files' });
  res.redirect('/files');
});

module.exports = router;
