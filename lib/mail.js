const nodemailer = require('nodemailer');
const config = require('./config');

const transporter = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_PORT === 465,
  auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000,
});

// Lazy-loaded DB reference to avoid circular dependency
let _db = null;
function getDB() {
  if (!_db) _db = require('./db').db;
  return _db;
}

const MAX_ATTEMPTS = 5;

function generateCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

function setCode(email, code) {
  const db = getDB();
  // Remove any existing unexpired codes for this email
  db.prepare("DELETE FROM email_codes WHERE email = ?").run(email);
  // Insert new code with 5-minute expiry
  db.prepare("INSERT INTO email_codes (email, code, expires_at) VALUES (?, ?, ?)").run(email, code, require('./time').sqlFromNow('+5 minutes'));
}

function verifyCode(email, code) {
  const db = getDB();
  // Cleanup expired codes for this email
  db.prepare("DELETE FROM email_codes WHERE email = ? AND expires_at < ?").run(email, require('./time').toSQL());

  const row = db.prepare("SELECT * FROM email_codes WHERE email = ? AND expires_at >= ? ORDER BY created_at DESC LIMIT 1").get(email, require('./time').toSQL());
  if (!row) return false;

  // Rate limit: max attempts
  if (row.attempts >= MAX_ATTEMPTS) {
    db.prepare("DELETE FROM email_codes WHERE id = ?").run(row.id);
    return false;
  }

  if (row.code !== code) {
    db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?").run(row.id);
    return false;
  }

  // Success — delete the code
  db.prepare("DELETE FROM email_codes WHERE id = ?").run(row.id);
  return true;
}

// Periodic cleanup of expired codes
setInterval(() => {
  try {
    getDB().prepare("DELETE FROM email_codes WHERE expires_at < ?").run(require('./time').toSQL());
  } catch (_) {}
}, 10 * 60 * 1000).unref();

async function sendCode(email, code) {
  await transporter.sendMail({
    from: config.SMTP_FROM,
    to: email,
    subject: '[Ntopia 官方] 验证通知',
    text: `您的验证码是：${code}，5分钟内有效。请勿告知任何人，以免账号被盗。`,
    html: `<p>验证码：<strong>${code}</strong>，5分钟有效。</p>`,
  });
}

module.exports = { generateCode, setCode, verifyCode, sendCode };
