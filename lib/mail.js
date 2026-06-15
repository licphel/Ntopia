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

const codes = new Map();

function generateCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function setCode(email, code) { codes.set(email, { code, expires: Date.now() + 5*60*1000 }); }
function verifyCode(email, code) {
  const e = codes.get(email);
  if (!e || e.expires < Date.now()) return false;
  if (e.code !== code) return false;
  codes.delete(email);
  return true;
}
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
