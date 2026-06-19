// Comment data access — all comment-related queries.
const { getDB } = require('../database');

const SELECT_COMMENT = `
  SELECT c.*, u.username, u.display_name, u.avatar, u.level, u.role,
    p2.username as parent_username, p2.display_name as parent_display
  FROM comments c
    JOIN users u ON c.author_id = u.id
    JOIN posts p ON c.post_id = p.id
    LEFT JOIN comments pc ON c.parent_id = pc.id
    LEFT JOIN users p2 ON pc.author_id = p2.id
`;

const commentRepo = {
  /** Get all comments for a post, respecting visibility by viewer role. */
  forPost(postId, viewerRole = 0) {
    const deletedClause = viewerRole >= 128 ? '' : 'AND (c.is_deleted = 0 OR c.is_deleted IS NULL)';
    return getDB().prepare(`
      ${SELECT_COMMENT}
      WHERE c.post_id = ? ${deletedClause}
      ORDER BY c.created_at ASC
    `).all(postId);
  },

  /** Get a single comment by ID. */
  findById(id) {
    return getDB().prepare('SELECT * FROM comments WHERE id = ?').get(id);
  },

  /** Get a comment with post slug (for redirects after delete). */
  findByIdWithPost(id) {
    return getDB().prepare(`
      SELECT c.*, p.slug FROM comments c JOIN posts p ON c.post_id = p.id WHERE c.id = ?
    `).get(id);
  },

  /** Get a comment for thread view. */
  findByIdForThread(id, postId, viewerRole = 0) {
    const deletedClause = viewerRole >= 128 ? '' : 'AND (c.is_deleted = 0 OR c.is_deleted IS NULL)';
    return getDB().prepare(`
      ${SELECT_COMMENT}
      WHERE c.id = ? AND c.post_id = ? ${deletedClause}
    `).get(id, postId);
  },

  /** Create a comment. Returns lastInsertRowid. */
  create({ postId, authorId, contentMd, contentHtml, parentId }) {
    const info = getDB().prepare(`
      INSERT INTO comments (post_id, author_id, content_md, content_html, parent_id)
      VALUES (?,?,?,?,?)
    `).run(postId, authorId, contentMd, contentHtml, parentId || null);
    return info.lastInsertRowid;
  },

  /** Soft-delete a comment. */
  softDelete(id) {
    getDB().prepare(`
      UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
  },

  /** List comments by user (for profile). */
  listByUser(userId, { page = 1, limit = 10, isOwner = false } = {}) {
    const offset = (page - 1) * limit;
    const visibility = isOwner
      ? ''
      : 'AND ((p.is_deleted = 0 OR p.is_deleted IS NULL) OR 0) AND (c.is_deleted = 0 OR c.is_deleted IS NULL)';
    const comments = getDB().prepare(`
      SELECT c.*, p.title as post_title, p.slug as post_slug
      FROM comments c JOIN posts p ON c.post_id = p.id
      WHERE c.author_id = ? ${visibility}
      ORDER BY c.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = getDB().prepare(`
      SELECT COUNT(*) as c FROM comments c
      JOIN posts p ON c.post_id = p.id
      WHERE c.author_id = ? ${visibility}
    `).get(userId);
    return { comments, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },
};

module.exports = commentRepo;
