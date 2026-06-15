const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.qq.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: parseInt(process.env.SMTP_PORT || '465') === 465,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  connectionTimeout: 10000,  // 10s timeout — fail fast instead of hanging
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
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Ntopia 注册验证码',
    text: `您的验证码是：${code}，5分钟内有效。`,
    html: `<p>验证码：<strong>${code}</strong>，5分钟有效。</p>`,
  });
}

module.exports = { generateCode, setCode, verifyCode, sendCode };
