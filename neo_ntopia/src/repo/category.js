// Category data access.
const { getDB } = require('../database');

const categoryRepo = {
  /** List all categories ordered by sort_order. */
  all(type) {
    if (type) return getDB().prepare('SELECT * FROM categories WHERE type = ? ORDER BY sort_order').all(type);
    return getDB().prepare('SELECT * FROM categories ORDER BY sort_order').all();
  },

  findBySlug(slug) {
    return getDB().prepare('SELECT * FROM categories WHERE slug = ?').get(slug);
  },

  /** Create a category. */
  create(name, slug, description, type = 'blog') {
    const max = getDB().prepare('SELECT MAX(sort_order) as m FROM categories WHERE type = ?').get(type);
    getDB().prepare(
      'INSERT INTO categories (name, slug, description, type, sort_order) VALUES (?,?,?,?,?)'
    ).run(name, slug, description || '', type, (max.m || 0) + 1);
  },

  /** Delete a category. */
  delete(id) {
    getDB().prepare('DELETE FROM categories WHERE id = ?').run(id);
  },
};

const emailCodeRepo = {
  /** Remove existing codes for an email. */
  clearFor(email) {
    getDB().prepare('DELETE FROM email_codes WHERE email = ?').run(email);
  },

  /** Insert a new verification code. */
  insert(email, code, expiresAt) {
    getDB().prepare(
      'INSERT INTO email_codes (email, code, expires_at) VALUES (?, ?, ?)'
    ).run(email, code, expiresAt);
  },

  /** Find the latest valid code for an email. */
  findValid(email, nowSQL) {
    return getDB().prepare(`
      SELECT * FROM email_codes
      WHERE email = ? AND expires_at >= ?
      ORDER BY created_at DESC LIMIT 1
    `).get(email, nowSQL);
  },

  /** Increment attempts. */
  incrementAttempts(id) {
    getDB().prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(id);
  },

  /** Delete a code. */
  delete(id) {
    getDB().prepare('DELETE FROM email_codes WHERE id = ?').run(id);
  },

  /** Cleanup expired codes. */
  cleanupExpired(nowSQL) {
    getDB().prepare('DELETE FROM email_codes WHERE expires_at < ?').run(nowSQL);
  },
};

module.exports = { categoryRepo, emailCodeRepo };
