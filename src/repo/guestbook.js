// Guestbook data access — anonymous messages with IP logging.
const { getDB } = require('../database');

const guestbookRepo = {
  /** List messages for a board, with reply count. */
  list(board, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const msgs = getDB().prepare(`
      SELECT g.*,
        (SELECT COUNT(*) FROM guestbook WHERE parent_id = g.id) as reply_count
      FROM guestbook g
      WHERE g.board = ? AND g.parent_id IS NULL
      ORDER BY g.created_at DESC LIMIT ? OFFSET ?
    `).all(board, limit, offset);
    const total = getDB().prepare(
      'SELECT COUNT(*) as c FROM guestbook WHERE board = ? AND parent_id IS NULL'
    ).get(board);
    return { msgs, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Get replies for a parent message. */
  replies(parentId) {
    return getDB().prepare(`
      SELECT * FROM guestbook WHERE parent_id = ? ORDER BY created_at ASC
    `).all(parentId);
  },

  /** Create a new message or reply. Returns lastInsertRowid. */
  create({ board, content, parentId, ip }) {
    const info = getDB().prepare(`
      INSERT INTO guestbook (board, content, parent_id, ip) VALUES (?, ?, ?, ?)
    `).run(board, content || '', parentId || null, ip || '');
    return info.lastInsertRowid;
  },

  /** Delete a message and its replies. */
  delete(id) {
    getDB().prepare('DELETE FROM guestbook WHERE parent_id = ?').run(id);
    getDB().prepare('DELETE FROM guestbook WHERE id = ?').run(id);
  },

  /** List all boards with message counts. */
  boards() {
    return getDB().prepare(`
      SELECT board, COUNT(*) as c FROM guestbook GROUP BY board ORDER BY board
    `).all();
  },
};

module.exports = guestbookRepo;
