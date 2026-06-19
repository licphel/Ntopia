// User routes.
const path = require('path');
const express = require('express');
const userService = require('../service/user');
const fileService = require('../service/file');
const { userRepo } = require('../repo');
const auth = require('../lib/auth');
const config = require('../config');
const router = express.Router();

router.get('/:username', (req, res) => {
  const r = userService.getProfile(req.params.username, req.session.user, { postPage: parseInt(req.query.pp) || 1, cmtPage: parseInt(req.query.cp) || 1 });
  if (r.notFound) return res.status(404).render('page/404', { title: '404' });
  res.render('page/user', { title: r.profile.display_name || r.profile.username, ...r });
});

router.get('/:username/edit', auth.requireAuth, (req, res) => {
  const p = userRepo.findByUsername(req.params.username);
  if (!p || p.id !== req.session.user.id) return res.status(403).render('page/error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  res.render('page/edit-profile', { title: '编辑资料', profile: p, error: null });
});

router.post('/:username/edit', auth.requireAuth, (req, res) => {
  const r = userService.updateProfile(req.params.username, {
    displayName: req.body.display_name, bio: req.body.bio, desc: req.body.desc,
    newUsername: req.body.new_username, newPassword: req.body.new_password, newPassword2: req.body.new_password2,
  }, req.session.user);
  if (!r.ok) {
    const p = userRepo.findByUsername(req.params.username);
    return res.render('page/edit-profile', { title: '编辑资料', profile: p, error: r.error, formData: r.formData });
  }
  req.session.user.display_name = r.displayName; req.session.user.username = r.username; req.session.save();
  res.redirect('/users/' + r.username);
});

router.post('/:username/avatar', auth.requireAuthAPI, async (req, res) => {
  const multer = require('multer');
  const upload = multer({
    storage: multer.diskStorage({ destination: config.UPLOADS_DIR, filename: (r, f, cb) => cb(null, 'avatar-' + req.session.user.id + '-' + Date.now() + path.extname(f.originalname)) }),
    limits: { fileSize: config.MAX_IMAGE_SIZE },
    fileFilter: (r, f, cb) => { const ext = path.extname(f.originalname).toLowerCase(); cb(null, config.ALLOWED_IMAGE_MIME.includes(f.mimetype) && config.ALLOWED_IMAGE_EXT.includes(ext)); },
  }).single('avatar');
  const file = await new Promise((res, rej) => upload(req, res, (e) => e ? rej(e) : res(req.file)));
  if (!file) return res.json({ ok: false, error: '请选择文件' });
  const p = userRepo.findByUsername(req.params.username);
  if (!p || p.id !== req.session.user.id) return res.json({ ok: false, error: '权限不足' });
  const r = await fileService.processAvatar(file.path, req.session.user.id);
  if (!r.ok) return res.json(r);
  userRepo.updateAvatar(p.id, r.url);
  req.session.user.avatar = r.url; req.session.save();
  res.json({ ok: true, url: r.url });
});

module.exports = router;
