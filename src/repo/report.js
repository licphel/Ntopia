// Report data access.
const { getDB } = require('../database');

const reportRepo = {
  /** Check for duplicate pending report. */
  findDuplicate(reporterId, type, targetId) {
    return getDB().prepare(`
      SELECT id FROM reports
      WHERE reporter_id = ? AND type = ? AND target_id = ? AND status = 'pending'
    `).get(reporterId, type, targetId);
  },

  /** Submit a report. */
  create(reporterId, type, targetId, reason) {
    getDB().prepare(`
      INSERT INTO reports (reporter_id, type, target_id, reason) VALUES (?, ?, ?, ?)
    `).run(reporterId, type, targetId, reason || '');
  },

  /** List reports (admin), sorted pending-first. */
  list({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const reports = getDB().prepare(`
      SELECT r.*, u1.username as reporter_name, u1.display_name as reporter_display
      FROM reports r JOIN users u1 ON r.reporter_id = u1.id
      ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    const total = getDB().prepare('SELECT COUNT(*) as c FROM reports').get();
    return { reports, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Resolve a report. */
  resolve(id, status, resolverId) {
    getDB().prepare(`
      UPDATE reports SET status = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, resolverId, id);
  },

  /** Get pending count (for admin dashboard). */
  pendingCount() {
    return getDB().prepare("SELECT COUNT(*) as c FROM reports WHERE status = 'pending'").get().c;
  },
};

module.exports = reportRepo;
