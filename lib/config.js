// Centralized configuration — reads from process.env
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');

// If OWNER_PASSWORD is not set via env, generate a random one and warn loudly
let ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerPassword) {
  ownerPassword = crypto.randomBytes(16).toString('hex');
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ⚠  OWNER_PASSWORD not set — generated random password:     ║');
  console.log(`║  ${ownerPassword.padEnd(56)}║`);
  console.log('║  Please set OWNER_PASSWORD in .env and restart.             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

module.exports = {
  PORT: process.env.PORT || 3000,
  SITE_URL: process.env.SITE_URL || 'https://ntopia.top',
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATA_DIR,
  UPLOADS_DIR: path.join(__dirname, '..', 'public', 'uploads'),
  SESSIONS_DIR: path.join(DATA_DIR, 'sessions'),

  // SMTP
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.qq.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '465'),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || '',

  // Owner
  OWNER_NAME: process.env.OWNER_NAME || 'admin',
  OWNER_PASSWORD: ownerPassword,
  OWNER_EMAIL: process.env.OWNER_EMAIL || '',

  // AI moderation
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  ENABLE_MODERATION: process.env.ENABLE_MODERATION === 'true',
};
