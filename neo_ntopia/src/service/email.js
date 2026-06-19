// Email verification service — sends codes, validates them.
const nodemailer = require('nodemailer');
const config = require('../config');
const { emailCodeRepo } = require('../repo');
const time = require('../util/time');

const MAX_ATTEMPTS = 5;

const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
});

const emailService = {
  /** Generate a random 6-digit code. */
  generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  },

  /** Store a code for an email (replaces any existing). */
  setCode(email, code) {
    emailCodeRepo.clearFor(email);
    emailCodeRepo.insert(email, code, time.sqlFromNow('+5 minutes'));
  },

  /** Verify a code. Returns true if valid, false otherwise. */
  verifyCode(email, code) {
    const nowSQL = time.toSQL();

    // Cleanup expired for this email
    try { emailCodeRepo.cleanupExpired(nowSQL); } catch (_) {}

    const row = emailCodeRepo.findValid(email, nowSQL);
    if (!row) return false;

    if (row.attempts >= MAX_ATTEMPTS) {
      emailCodeRepo.delete(row.id);
      return false;
    }

    if (row.code !== code) {
      emailCodeRepo.incrementAttempts(row.id);
      return false;
    }

    emailCodeRepo.delete(row.id);
    return true;
  },

  /** Send a verification email. */
  async sendCode(email, code) {
    await transporter.sendMail({
      from: config.SMTP_FROM,
      to: email,
      subject: '[Ntopia 官方] 验证通知',
      text: `您的验证码是：${code}，5分钟内有效。请勿告知任何人，以免账号被盗。`,
      html: `<p>验证码：<strong>${code}</strong>，5分钟有效。</p>`,
    });
  },

  // Periodic cleanup (called by app startup)
  startCleanup() {
    setInterval(() => {
      try { emailCodeRepo.cleanupExpired(time.toSQL()); } catch (_) {}
    }, 10 * 60 * 1000).unref();
  },
};

module.exports = emailService;
