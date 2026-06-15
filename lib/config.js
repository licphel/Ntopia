// Centralized configuration — reads from process.env
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

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
  OWNER_PASSWORD: process.env.OWNER_PASSWORD || 'admin123',
  OWNER_EMAIL: process.env.OWNER_EMAIL || '',
};
