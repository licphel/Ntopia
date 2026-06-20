// Category data access.
const { getDB } = require('../database');

const categoryRepo = {
  /** List all categories ordered by sort_order. */
  all(type) {
    if (type) return getDB().prepare('SELECT * FROM categories WHERE type = ? ORDER BY sort_order').all(type);
    return getDB().prepare('SELECT * FROM categories ORDER BY sort_order').all();
  },

  findById(id) {
    return getDB().prepare('SELECT * FROM categories WHERE id = ?').get(id);
  },

  /** Create a category. Returns the new category's id. */
  create(name, description) {
    const max = getDB().prepare('SELECT MAX(sort_order) as m FROM categories').get();
    const info = getDB().prepare(
      'INSERT INTO categories (name, description, sort_order) VALUES (?,?,?)'
    ).run(name, description || '', (max.m || 0) + 1);
    return info.lastInsertRowid;
  },

  /** Set moderator for a category. */
  setModerator(id, userId) {
    getDB().prepare('UPDATE categories SET moderator_id = ? WHERE id = ?').run(userId, id);
  },

  /** Update name and description. */
  update(id, name, description) {
    getDB().prepare('UPDATE categories SET name = ?, description = ? WHERE id = ?').run(name.trim(), (description || '').trim(), id);
  },

  /** Set section image URL. */
  setImage(id, url) {
    getDB().prepare('UPDATE categories SET image = ? WHERE id = ?').run(url, id);
  },

  /** Count non-deleted, non-draft posts in a section. */
  countPosts(id) {
    return getDB().prepare(
      'SELECT COUNT(*) as c FROM posts WHERE category_id = ? AND is_deleted = 0 AND is_draft = 0'
    ).get(id)?.c || 0;
  },

  /** Delete a category and its related data (sub-cats, sub-mods, follows). */
  deleteCascade(id) {
    getDB().prepare('DELETE FROM sub_categories WHERE section_id = ?').run(id);
    getDB().prepare('DELETE FROM section_sub_mods WHERE section_id = ?').run(id);
    getDB().prepare('DELETE FROM section_follows WHERE section_id = ?').run(id);
    this.delete(id);
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
