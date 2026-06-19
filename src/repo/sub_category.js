// Sub-category data access — per-section secondary categories.
const { getDB } = require('../database');

const subCategoryRepo = {
  listBySection(sectionId) {
    return getDB().prepare(
      'SELECT * FROM sub_categories WHERE section_id = ? ORDER BY sort_order, id'
    ).all(sectionId);
  },

  findById(id) {
    return getDB().prepare('SELECT * FROM sub_categories WHERE id = ?').get(id);
  },

  findByName(sectionId, name) {
    return getDB().prepare(
      'SELECT * FROM sub_categories WHERE section_id = ? AND name = ?'
    ).get(sectionId, name);
  },

  create(sectionId, name) {
    const max = getDB().prepare(
      'SELECT MAX(sort_order) as m FROM sub_categories WHERE section_id = ?'
    ).get(sectionId);
    return getDB().prepare(
      'INSERT INTO sub_categories (section_id, name, sort_order) VALUES (?,?,?)'
    ).run(sectionId, name, (max.m || 0) + 1);
  },

  update(id, name) {
    getDB().prepare('UPDATE sub_categories SET name = ? WHERE id = ?').run(name, id);
  },

  countPosts(sectionId, name) {
    return getDB().prepare(
      'SELECT COUNT(*) as c FROM posts WHERE category_id = ? AND sub_category = ? AND is_deleted = 0'
    ).get(sectionId, name)?.c || 0;
  },

  delete(id) {
    getDB().prepare('DELETE FROM sub_categories WHERE id = ?').run(id);
  },

  listWithCounts(sectionId) {
    return getDB().prepare(`
      SELECT sc.*, COUNT(p.id) as post_count
      FROM sub_categories sc
      LEFT JOIN posts p ON p.sub_category = sc.name AND p.category_id = ? AND p.is_deleted = 0 AND p.is_draft = 0
      WHERE sc.section_id = ?
      GROUP BY sc.id ORDER BY sc.sort_order, sc.id
    `).all(sectionId, sectionId);
  }
};

module.exports = subCategoryRepo;
