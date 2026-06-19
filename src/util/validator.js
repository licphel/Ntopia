// Input validation helpers — centralized validation rules.
const config = require('../config');

const USERNAME_RE = /^[a-z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUsername(username) {
  if (!username || username.length < 2) return '用户名至少2个字符';
  if (username.length > config.MAX_USERNAME_LENGTH) return '用户名过长';
  if (!USERNAME_RE.test(username)) return '用户名只能包含小写字母、数字和下划线';
  return null;
}

function validatePassword(password) {
  if (!password || password.length < 4) return '密码至少4个字符';
  if (password.length > config.MAX_PASSWORD_LENGTH) return '密码过长';
  return null;
}

function validateEmail(email) {
  if (!email) return '请输入邮箱';
  if (!EMAIL_RE.test(email)) return '邮箱格式错误';
  return null;
}

function validateTitle(title) {
  if (!title || !title.trim()) return '标题不能为空';
  if (title.length > config.MAX_TITLE_LENGTH) return '标题过长';
  return null;
}

function validateContent(content) {
  if (!content || !content.trim()) return '内容不能为空';
  return null;
}

function validateDisplayName(name) {
  if (name && name.length > 64) return '显示名称过长';
  return null;
}

function validateBio(bio) {
  if (bio && bio.length > config.MAX_BIO_LENGTH) return '简介过长';
  return null;
}

module.exports = {
  validateUsername,
  validatePassword,
  validateEmail,
  validateTitle,
  validateContent,
  validateDisplayName,
  validateBio,
};
