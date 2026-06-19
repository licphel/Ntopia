// Centralized configuration — single source of truth for all settings.
// All values read from environment variables with sensible defaults.
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');

// Generate a random owner password if none set (dev safety)
let ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerPassword) {
  ownerPassword = crypto.randomBytes(16).toString('hex');
  console.log('');
  console.log('⚠ OWNER_PASSWORD not set. generated random password:');
  console.log(ownerPassword);
  console.log('');
}

const config = {
  // ── Server ────────────────────────────────────────────────────
  PORT: parseInt(process.env.PORT, 10) || 3000,
  SITE_URL: process.env.SITE_URL || 'https://ntopia.top',
  NODE_ENV: process.env.NODE_ENV || 'development',

  // ── Database ──────────────────────────────────────────────────
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'ntopia.db'),
  RETENTION: process.env.RETENTION || '60 days',

  // ── Session ───────────────────────────────────────────────────
  SESSION_SECRET: process.env.SESSION_SECRET || '',
  SESSIONS_DIR: path.join(DATA_DIR, 'sessions'),
  SESSION_MAX_AGE: 30 * 24 * 3600,       // 30 days in seconds
  SESSION_MAX_AGE_MS: 30 * 24 * 3600 * 1000,

  // ── Uploads ───────────────────────────────────────────────────
  UPLOADS_DIR: path.join(ROOT, 'public', 'uploads'),
  ATTACHMENTS_DIR: path.join(DATA_DIR, 'attachments'),
  MAX_IMAGE_SIZE: 5 * 1024 * 1024,        // 5 MB
  MAX_ATTACHMENT_SIZE: 50 * 1024 * 1024,  // 50 MB
  ALLOWED_IMAGE_MIME: ['image/jpeg', 'image/png', 'image/webp'],
  ALLOWED_IMAGE_EXT: ['.jpg', '.jpeg', '.png', '.webp'],

  // ── SMTP ──────────────────────────────────────────────────────
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.qq.com',
  SMTP_PORT: parseInt(process.env.SMTP_PORT, 10) || 465,
  SMTP_SECURE: (parseInt(process.env.SMTP_PORT, 10) || 465) === 465,
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || process.env.SMTP_USER || '',

  // ── Owner ─────────────────────────────────────────────────────
  OWNER_NAME: process.env.OWNER_NAME || 'admin',
  OWNER_PASSWORD: ownerPassword,
  OWNER_EMAIL: process.env.OWNER_EMAIL || '',

  // ── AI Moderation ─────────────────────────────────────────────
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  ENABLE_MODERATION: process.env.ENABLE_MODERATION === 'true',
  MODERATION_TIMEOUT: 15000,
  COMMENT_MODERATION_TIMEOUT: 10000,

  // ── Cloudflare R2 ─────────────────────────────────────────────
  R2_ENDPOINT: process.env.R2_ENDPOINT || '',
  R2_ACCESS_KEY: process.env.R2_ACCESS_KEY || '',
  R2_SECRET_KEY: process.env.R2_SECRET_KEY || '',
  R2_BUCKET: process.env.R2_BUCKET || 'ntopia',
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || '',

  // ── Rate Limiting ─────────────────────────────────────────────
  RATE_WINDOW_MS: 15 * 1000,
  RATE_MAX_REQUESTS: 100,
  EMAIL_RATE_WINDOW_MS: 60 * 1000,
  EMAIL_RATE_MAX: 1,

  // ── XP System ─────────────────────────────────────────────────
  XP_POST: 3,
  XP_COMMENT: 1,
  XP_LIKE_RECEIVED: 1,
  XP_BOOKMARK_RECEIVED: 2,
  XP_COMMENT_DAILY_CAP: 10,
  XP_LIKE_DAILY_CAP: 5,
  XP_BOOKMARK_DAILY_CAP: 3,

  // ── Pagination ────────────────────────────────────────────────
  PAGE_SIZE: 10,
  NOTIF_PAGE_SIZE: 50,
  ATTACHMENT_PAGE_SIZE: 20,
  FOLLOW_PAGE_SIZE: 20,
  REPORT_PAGE_SIZE: 20,

  // ── Content ───────────────────────────────────────────────────
  MAX_TITLE_LENGTH: 200,
  MAX_BIO_LENGTH: 64,
  MAX_USERNAME_LENGTH: 64,
  MAX_PASSWORD_LENGTH: 64,
};

module.exports = config;
