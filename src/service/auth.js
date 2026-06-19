// Authentication service — login, register, check-in, captcha.
const bcrypt = require('bcryptjs');
const svgCaptcha = require('svg-captcha');
const config = require('../config');
const { userRepo, xpRepo } = require('../repo');
const { validateUsername, validatePassword, validateEmail } = require('../util/validator');
const emailService = require('./email');
const time = require('../util/time');

const authService = {
  /** Generate a CAPTCHA SVG and store the answer in session. */
  generateCaptcha(session) {
    const captcha = svgCaptcha.create({
      size: 4, noise: 2, ignoreChars: '0o1il',
      color: true, background: '#fafaf5',
    });
    session._captcha = captcha.text.toLowerCase();
    return captcha.data;
  },

  /** Save captcha to session (returns a promise for session.save). */
  saveCaptchaSession(session) {
    return new Promise((resolve) => session.save(() => resolve()));
  },

  /** Verify CAPTCHA input. */
  verifyCaptcha(session, input) {
    if (!input || input.toLowerCase() !== session._captcha) return false;
    session._captcha = null;
    return true;
  },

  /** Attempt login. Returns { ok, user, error }. */
  login(username, password, captcha, session, { ip, userAgent }) {
    if (username.length > 64 || password.length > 64) {
      return { ok: false, error: '用户名或密码过长' };
    }
    if (!this.verifyCaptcha(session, captcha)) {
      return { ok: false, error: '验证码错误' };
    }

    const user = userRepo.findByUsername(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return { ok: false, error: '用户名或密码错误' };
    }

    const sessionUser = {
      id: user.id, username: user.username,
      display_name: user.display_name, role: user.role,
      avatar: user.avatar, xp: user.xp, level: user.level,
      email: user.email, needsEmail: !user.email,
    };

    userRepo.logLogin(user.id, ip || '', userAgent || '');
    return { ok: true, user: sessionUser };
  },

  /** Register a new user. Returns { ok, error, user }. */
  register({ username, password, password2, displayName, email, emailCode, captcha, agree }, session) {
    if (!agree) return { ok: false, error: '请先阅读并同意用户协定、隐私协议' };
    if (!this.verifyCaptcha(session, captcha)) return { ok: false, error: '验证码错误' };
    if (password !== password2) return { ok: false, error: '两次密码不一致' };

    const nameErr = validateUsername(username);
    if (nameErr) return { ok: false, error: nameErr };
    const passErr = validatePassword(password);
    if (passErr) return { ok: false, error: passErr };
    const emailErr = validateEmail(email);
    if (emailErr) return { ok: false, error: emailErr };
    if (!emailCode) return { ok: false, error: '请先验证邮箱' };

    if (!emailService.verifyCode(email, emailCode)) {
      return { ok: false, error: '验证码错误或已过期' };
    }

    if (userRepo.usernameExists(username)) {
      return { ok: false, error: '用户名已被占用' };
    }

    const hash = bcrypt.hashSync(password, 10);
    const userId = userRepo.create({
      username, passwordHash: hash,
      displayName: displayName || username, email,
    });

    const user = userRepo.findById(userId);
    return {
      ok: true,
      user: {
        id: user.id, username: user.username,
        display_name: user.display_name, role: user.role,
        avatar: user.avatar, xp: user.xp, level: user.level,
        email: user.email, needsEmail: !user.email,
      },
    };
  },

  /** Reset password via email code. Returns { ok, error }. */
  resetPassword(email, code, newPassword, newPassword2) {
    if (!email || !code) return { ok: false, error: '请填写邮箱和验证码' };
    const passErr = validatePassword(newPassword);
    if (passErr) return { ok: false, error: passErr };
    if (newPassword !== newPassword2) return { ok: false, error: '两次密码不一致' };

    const user = userRepo.findByEmail(email);
    if (!user) return { ok: false, error: '该邮箱未注册' };
    if (!emailService.verifyCode(email, code)) {
      return { ok: false, error: '验证码错误或已过期' };
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    userRepo.updatePassword(user.id, hash);
    return { ok: true };
  },

  /** Perform daily check-in. Returns result object. */
  checkin(userId) {
    const todayStr = time.today();
    const yesterdayStr = time.yesterday();
    const existing = userRepo.checkedInToday(userId, todayStr);

    if (existing) {
      const count = userRepo.checkinCount(userId);
      return { ok: false, already: true, total: count.c };
    }

    const streak = userRepo.checkinStreak(userId, yesterdayStr);
    const newStreak = streak.yesterday ? (streak.stats.consecutive_days || 0) + 1 : 1;
    const xpEarned = 1 + Math.floor(newStreak / 5);

    userRepo.doCheckin(userId, todayStr, xpEarned, newStreak);
    xpRepo.award(userId, xpEarned, '签到', null);

    const refreshed = xpRepo.getRefreshed(userId);
    const count = userRepo.checkinCount(userId);
    return {
      ok: true, total: count.c, xpEarned, streak: newStreak,
      xp: refreshed.xp, level: refreshed.level,
    };
  },

  /** Get check-in status for display. */
  checkinStatus(userId) {
    const todayStr = time.today();
    const checkedIn = userRepo.checkedInToday(userId, todayStr);
    const count = userRepo.checkinCount(userId);
    return { checkedIn, total: count.c };
  },
};

module.exports = authService;
