// User service — profile management, avatar, account operations.
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const auth = require('../lib/auth');
const { userRepo, postRepo, commentRepo, xpRepo, followRepo, messageRepo, notificationRepo } = require('../repo');
const { validateUsername, validatePassword, validateEmail, validateDisplayName, validateBio } = require('../util/validator');
const { renderMarkdown } = require('../util/markdown');
const emailService = require('./email');
const time = require('../util/time');

const userService = {
  /** Get user profile with all related data. */
  getProfile(username, viewer, { postPage = 1, cmtPage = 1 } = {}) {
    const profile = userRepo.findByUsername(username);
    if (!profile) return { notFound: true };

    // Render bio description as markdown
    profile.desc_html = renderMarkdown(profile.desc || '');

    const isOwnerView = auth.canViewDeleted(viewer);
    const canManage = auth.canManageUser(viewer, profile);

    // Posts
    const postResult = postRepo.listByUser(profile.id, {
      page: Math.max(1, postPage),
      limit: config.PAGE_SIZE,
      isOwner: isOwnerView,
    });

    // Comments
    const cmtResult = commentRepo.listByUser(profile.id, {
      page: Math.max(1, cmtPage),
      limit: config.PAGE_SIZE,
      isOwner: isOwnerView,
    });

    // Stats
    const checkinCount = userRepo.checkinCount(profile.id);
    const followCounts = userRepo.followCounts(profile.id);
    const isFollowing = viewer ? followRepo.isFollowing(viewer.id, profile.id) : false;
    const todayCheckedIn = viewer ? userRepo.checkedInToday(profile.id, time.today()) : false;

    // Last login IP (owner only)
    let lastLogin = null;
    if (isOwnerView) lastLogin = userRepo.lastLogin(profile.id);

    // XP progress
    const curXP = xpRepo.xpForLevel(profile.level);
    const nxtXP = xpRepo.xpForLevel(profile.level + 1);

    return {
      notFound: false,
      profile, posts: postResult.posts, comments: cmtResult.comments,
      postPage, postPages: postResult.totalPages,
      cmtPage, cmtPages: cmtResult.totalPages,
      checkinCount: checkinCount.c,
      followerCount: followCounts.followers,
      followingCount: followCounts.following,
      isFollowing, canManage, todayCheckedIn,
      xpProgress: nxtXP > curXP ? Math.round((profile.xp - curXP) / (nxtXP - curXP) * 100) : 100,
      xpNext: nxtXP - curXP, xpBase: curXP, xpNextTotal: nxtXP,
      lastLogin,
    };
  },

  /** Update user profile. */
  updateProfile(username, { displayName, bio, desc, newUsername, newPassword, newPassword2 }, user) {
    const profile = userRepo.findByUsername(username);
    if (!profile || profile.id !== user.id) return { ok: false, error: '权限不足' };

    // Validate
    const dnErr = validateDisplayName(displayName);
    if (dnErr) return { ok: false, error: dnErr };
    const bioErr = validateBio(bio);
    if (bioErr) return { ok: false, error: bioErr };

    // Change username
    let uname = profile.username;
    if (newUsername && newUsername !== profile.username) {
      const nameErr = validateUsername(newUsername);
      if (nameErr) return { ok: false, error: nameErr, formData: { displayName, bio, desc, newUsername, newPassword: '', newPassword2: '' } };
      if (userRepo.usernameExists(newUsername, profile.id)) {
        return { ok: false, error: '用户名已被占用' };
      }
      userRepo.updateUsername(profile.id, newUsername);
      uname = newUsername.toLowerCase();
    }

    // Change password
    if (newPassword) {
      const passErr = validatePassword(newPassword);
      if (passErr) return { ok: false, error: passErr };
      if (newPassword !== newPassword2) return { ok: false, error: '两次密码不一致' };
      userRepo.updatePassword(profile.id, bcrypt.hashSync(newPassword, 10));
    }

    userRepo.updateProfile(profile.id, { displayName, bio, desc });
    return { ok: true, username: uname, displayName };
  },

  /** Change account password via email verification. */
  changePassword(user, newPassword, newPassword2, emailCode) {
    if (!user.email) return { ok: false, error: '请先绑定邮箱' };
    if (!emailCode) return { ok: false, error: '请输入邮箱验证码' };
    if (!emailService.verifyCode(user.email, emailCode)) {
      return { ok: false, error: '验证码错误或已过期' };
    }
    const passErr = validatePassword(newPassword);
    if (passErr) return { ok: false, error: passErr };
    if (newPassword !== newPassword2) return { ok: false, error: '两次密码不一致' };

    userRepo.updatePassword(user.id, bcrypt.hashSync(newPassword, 10));
    return { ok: true };
  },

  /** Bind/change email. */
  changeEmail(user, newEmail, emailCode) {
    if (!newEmail || !emailCode) return { ok: false, error: '请填写邮箱和验证码' };
    if (!emailService.verifyCode(newEmail, emailCode)) {
      return { ok: false, error: '验证码错误或已过期' };
    }
    const existing = userRepo.findByEmail(newEmail);
    if (existing && existing.id !== user.id) {
      return { ok: false, error: '该邮箱已被其他账号绑定' };
    }
    userRepo.updateEmail(user.id, newEmail);
    return { ok: true, email: newEmail };
  },

  /** Self account deletion. */
  deleteAccount(user, emailCode) {
    const email = user.email;
    if (!email) return { ok: false, error: '请先绑定邮箱' };
    if (!emailCode) return { ok: false, error: '请输入邮箱验证码以确认删除' };
    if (!emailService.verifyCode(email, emailCode)) {
      return { ok: false, error: '验证码错误或已过期' };
    }

    const scrambledHash = bcrypt.hashSync(Math.random().toString(), 10);

    // Soft-delete all user content
    const db = require('../database').getDB();
    db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(user.id);
    db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(user.id);
    messageRepo.softDeleteUserMessages(user.id);
    notificationRepo.deleteAll(user.id);

    // Delete social data
    db.prepare('DELETE FROM likes WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(user.id);

    userRepo.softDelete(user.id, scrambledHash);
    return { ok: true };
  },
};

module.exports = userService;
