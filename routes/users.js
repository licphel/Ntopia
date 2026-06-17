const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const { renderMarkdown } = require('../lib/helpers');
const { LEVEL } = require('../lib/perm');
const { db, xpForLevel } = require('../lib/db');
const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, 'avatar-' + req.session.user.id + '-' + require('../lib/time').now().getTime() + path.extname(file.originalname))
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) || !allowed.includes(ext)) {
      return cb(new Error('仅允许 JPG/PNG/WebP'), false);
    }
    cb(null, true);
  }
});

// User profile page with pagination
router.get('/:username', (req, res) => {
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!profile) return res.status(404).render('404', { title: '404' });
  // Render desc as markdown; bio is plain-text tagline
  profile.desc_html = renderMarkdown(profile.desc || '');

  const postPage = parseInt(req.query.pp) || 1;
  const cmtPage = parseInt(req.query.cp) || 1;
  const limit = 10;

  const isOwner = req.session.user && (req.session.user.role || 0) >= LEVEL.OWNER;
  const canManage = req.session.user && (req.session.user.role || 0) > (profile.role || 0) && (req.session.user.role || 0) >= LEVEL.ADMIN;
  // Last login IP (owner only)
  let lastLogin = null;
  if (isOwner) {
    lastLogin = db.prepare('SELECT ip, created_at FROM login_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(profile.id);
  }
  const postFilter = isOwner ? '' : 'AND is_deleted = 0';
  const posts = db.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
    FROM posts p WHERE p.author_id = ? ${postFilter.replace('is_deleted', 'p.is_deleted')}
    ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(profile.id, limit, (postPage - 1) * limit);
  const postTotal = db.prepare(`SELECT COUNT(*) as c FROM posts WHERE author_id = ? ${postFilter}`).get(profile.id);
  const postPages = Math.ceil(postTotal.c / limit);

  const cmtFilter = isOwner ? '' : 'AND (c.is_deleted = 0 OR c.is_deleted IS NULL)';
  const comments = db.prepare(`
    SELECT c.*, p.title as post_title, p.slug as post_slug
    FROM comments c JOIN posts p ON c.post_id = p.id
    WHERE c.author_id = ? AND ((p.is_deleted = 0 OR p.is_deleted IS NULL) OR ?) ${cmtFilter}
    ORDER BY c.created_at DESC LIMIT ? OFFSET ?
  `).all(profile.id, isOwner ? 1 : 0, limit, (cmtPage - 1) * limit);
  const cmtTotal = db.prepare(`SELECT COUNT(*) as c FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.author_id = ? AND ((p.is_deleted = 0 OR p.is_deleted IS NULL) OR ?) ${cmtFilter}`).get(profile.id, isOwner ? 1 : 0);
  const cmtPages = Math.ceil(cmtTotal.c / limit);

  const checkinCount = db.prepare('SELECT COUNT(*) as c FROM checkins WHERE user_id = ?').get(profile.id);
  const followerCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE follow_id = ?').get(profile.id);
  const followingCount = db.prepare('SELECT COUNT(*) as c FROM follows WHERE user_id = ?').get(profile.id);
  const isFollowing = req.session.user ? !!db.prepare('SELECT 1 FROM follows WHERE user_id = ? AND follow_id = ?').get(req.session.user.id, profile.id) : false;
  const { today } = require('../lib/time');
  const todayCheckin = db.prepare('SELECT id FROM checkins WHERE user_id = ? AND checkin_date = ?')
    .get(profile.id, today());

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
    followerCount: followerCount.c, followingCount: followingCount.c, isFollowing, canManage,
    todayCheckedIn: !!todayCheckin,
    xpProgress, xpNext, xpBase, xpNextTotal, lastLogin
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

  const { display_name, bio, desc, new_username, new_password, new_password2 } = req.body;
  const bcrypt = require('bcryptjs');

  // Build form data for re-rendering on error
  const formData = { display_name, bio, desc, new_username, new_password: '', new_password2: '' };

  // Change username
  let uname = profile.username;
  if (new_username && new_username !== profile.username) {
    uname = new_username.toLowerCase();
    if (uname.length < 2 || !/^[a-zA-Z0-9_一-鿿]+$/.test(uname)) {
      return res.render('edit-profile', { title: '编辑资料', profile, error: '用户名只能包含字母、数字、下划线和中文，至少2个字符', formData });
    }
    const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(uname, profile.id);
    if (exists) {
      return res.render('edit-profile', { title: '编辑资料', profile, error: '用户名已被占用', formData });
    }
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(uname, profile.id);
    req.session.user.username = uname;
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

  db.prepare('UPDATE users SET display_name = ?, bio = ?, desc = ? WHERE id = ?').run(display_name, (bio || '').slice(0, 64), desc || '', profile.id);
  req.session.user.display_name = display_name;
  req.session.user.bio = (bio || '').slice(0, 64);
  req.session.user.desc = desc || '';
  res.redirect('/users/' + uname);
});

// Avatar upload with center-crop to square
router.post('/:username/avatar', avatarUpload.single('avatar'), async (req, res) => {
  if (!req.session.user) return res.status(401).json({ ok: false, error: '请先登录' });
  const profile = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username);
  if (!profile || profile.id !== req.session.user.id) return res.status(403).json({ ok: false, error: '权限不足' });
  if (!req.file) return res.status(400).json({ ok: false, error: '请选择文件' });

  const inPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  // GIF cannot be cropped to square — reject
  if (ext === '.gif') {
    try { fs.unlinkSync(inPath); } catch(_) {}
    return res.json({ ok: false, error: '头像不支持 GIF，请上传 JPG/PNG/WebP' });
  }

  try {
    // Center-crop to square, then resize to 256x256
    const meta = await sharp(inPath).metadata();
    const side = Math.min(meta.width, meta.height);
    const left = Math.floor((meta.width - side) / 2);
    const top = Math.floor((meta.height - side) / 2);

    const r2 = require('../lib/r2');
    const outBuf = await sharp(inPath)
      .extract({ left, top, width: side, height: side })
      .resize(256, 256)
      .webp({ quality: 85 })
      .toBuffer();
    fs.unlinkSync(inPath);

    let url;
    if (r2.enabled()) {
      const key = r2.r2Key('avatar', 'avatar-' + req.session.user.id + '.webp');
      url = await r2.upload(key, outBuf, 'image/webp');
    } else {
      const outName = 'avatar-' + req.session.user.id + '.webp';
      const outPath = path.join(UPLOADS_DIR, outName);
      fs.writeFileSync(outPath, outBuf);
      url = '/uploads/' + outName + '?v=' + require('../lib/time').now().getTime();
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(url, profile.id);
    req.session.user.avatar = url;
    res.json({ ok: true, url });
  } catch(e) {
    console.error('Avatar compress error:', e.message);
    try { if (fs.existsSync(inPath)) fs.unlinkSync(inPath); } catch(_) {}
    res.json({ ok: false, error: '图片处理失败，请尝试其他图片' });
  }
});

module.exports = router;
