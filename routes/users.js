const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const { marked } = require('marked');
const { db, xpForLevel } = require('../db');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, 'avatar-' + req.session.user.id + '-' + Date.now() + path.extname(file.originalname))
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// User profile page with pagination
router.get('/:username', (req, res) => {
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.status(404).render('404', { title: '404' });
  // Render bio markdown
  profile.bio_html = marked.parse(profile.bio || '');

  const postPage = parseInt(req.query.pp) || 1;
  const cmtPage = parseInt(req.query.cp) || 1;
  const limit = 10;

  const posts = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM comments WHERE post_id = p.id AND p.is_deleted = 0) as comment_count
    FROM posts p WHERE p.author_id = ? AND p.is_deleted = 0
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(profile.id, limit, (postPage - 1) * limit);
  const postTotal = db.prepare('SELECT COUNT(*) as c FROM posts WHERE author_id = ? AND is_deleted = 0').get(profile.id);
  const postPages = Math.ceil(postTotal.c / limit);

  const comments = db.prepare(`
    SELECT c.*, p.title as post_title, p.slug as post_slug, p.type as post_type
    FROM comments c JOIN posts p ON c.post_id = p.id
    WHERE c.author_id = ? AND p.is_deleted = 0
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(profile.id, limit, (cmtPage - 1) * limit);
  const cmtTotal = db.prepare('SELECT COUNT(*) as c FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.author_id = ? AND p.is_deleted = 0').get(profile.id);
  const cmtPages = Math.ceil(cmtTotal.c / limit);

  const checkinCount = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(profile.id);
  const todayCheckin = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?')
    .get(profile.id, new Date().toISOString().slice(0, 10));

  // XP progress
  const curXP = xpForLevel(profile.level);
  const nxtXP = xpForLevel(profile.level + 1);
  const xpBase = curXP;
  const xpProgress = nxtXP > curXP ? Math.round((profile.xp - curXP) / (nxtXP - curXP) * 100) : 100;
  const xpNext = nxtXP - curXP;
  const xpNextTotal = nxtXP;

  res.render('user', {
    title: profile.display_name || profile.username,
    profile, posts, comments,
    postPage, postPages, cmtPage, cmtPages,
    checkinCount: checkinCount.c,
    todayCheckedIn: !!todayCheckin,
    xpProgress, xpNext, xpBase, xpNextTotal
  });
});

// Edit profile page
router.get('/:username/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!profile || profile.id !== req.session.user.id) return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  res.render('edit-profile', { title: '编辑资料', profile, error: null });
});

// Edit profile POST
router.post('/:username/edit', (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!profile || profile.id !== req.session.user.id) return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });

  const { display_name, bio, new_username, new_password, new_password2 } = req.body;
  const bcrypt = require('bcryptjs');

  // Build form data for re-rendering on error
  const formData = { display_name, bio, new_username, new_password: '', new_password2: '' };

  // Change username
  if (new_username && new_username !== profile.username) {
    if (new_username.length < 2) {
      return res.render('edit-profile', { title: '编辑资料', profile, error: '用户名至少2个字符', formData });
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(new_username, profile.id);
    if (exists) {
      return res.render('edit-profile', { title: '编辑资料', profile, error: '用户名已被占用', formData });
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(new_username, profile.id);
    req.session.user.username = new_username;
  }

  // Change password
  if (new_password) {
    if (new_password.length < 4) {
      return res.render('edit-profile', { title: '编辑资料', profile, error: '密码至少4个字符', formData });
    }
    if (new_password !== new_password2) {
      return res.render('edit-profile', { title: '编辑资料', profile, error: '两次密码不一致', formData });
    }
    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, profile.id);
  }

  db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(display_name, bio, profile.id);
  req.session.user.display_name = display_name;
  res.redirect('/users/' + (new_username || profile.username));
});

// Avatar upload with compression
router.post('/:username/avatar', avatarUpload.single('avatar'), async (req, res) => {
  if (!req.session.user) return res.redirect('/auth/login');
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!profile || profile.id !== req.session.user.id) return res.status(403).render('error', { title: '错误', code: 403, message: '权限不足', detail: '你无权执行此操作', back: '/' });
  if (req.file) {
    try {
      const inPath = req.file.path;
      const outName = 'avatar-' + req.session.user.id + '.webp';
      const outPath = path.join(UPLOADS_DIR, outName);

      await sharp(inPath)
        .resize(256, 256, { fit: 'cover' })
        .webp({ quality: 85 })
        .toFile(outPath);

      fs.unlinkSync(inPath);
      const url = '/uploads/' + outName + '?v=' + Date.now();
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, profile.id);
      req.session.user.avatar = url;
    } catch(e) {
      console.error('Avatar compress error:', e.message);
      const url = '/uploads/' + req.file.filename;
      db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, profile.id);
      req.session.user.avatar = url;
    }
  }
  res.redirect('/users/' + profile.username + '/edit');
});

module.exports = router;
