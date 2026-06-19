// Like/bookmark data access — toggle patterns for social actions.
const { getDB } = require('../database');

const likeRepo = {
  /** Check if a user liked a post or comment. */
  findOne(userId, { postId, commentId }) {
    return getDB().prepare(
      'SELECT id FROM likes WHERE user_id = ? AND post_id IS ? AND comment_id IS ?'
    ).get(userId, postId || null, commentId || null);
  },

  /** Toggle like: returns { liked, count }. */
  toggle(userId, { postId, commentId }) {
    const db = getDB();
    const existing = this.findOne(userId, { postId, commentId });

    if (existing) {
      db.prepare('DELETE FROM likes WHERE id = ?').run(existing.id);
    } else {
      db.prepare(
        'INSERT INTO likes (user_id, post_id, comment_id) VALUES (?, ?, ?)'
      ).run(userId, postId || null, commentId || null);
    }

    const count = db.prepare(
      'SELECT COUNT(*) as c FROM likes WHERE post_id IS ? AND comment_id IS ?'
    ).get(postId || null, commentId || null);

    return { liked: !existing, count: count.c };
  },

  /** Get like count for a post. */
  countForPost(postId) {
    const row = getDB().prepare('SELECT COUNT(*) as c FROM likes WHERE post_id = ?').get(postId);
    return (row || {}).c || 0;
  },

  /** Check if a user liked a post. */
  userLikedPost(userId, postId) {
    return !!getDB().prepare(
      'SELECT 1 FROM likes WHERE user_id = ? AND post_id = ?'
    ).get(userId, postId);
  },

  /** Get author ID of a post. */
  postAuthor(postId) {
    return getDB().prepare('SELECT author_id FROM posts WHERE id = ?').get(postId);
  },
};

const bookmarkRepo = {
  /** Check if a user bookmarked a post. */
  findOne(userId, postId) {
    return getDB().prepare(
      'SELECT id FROM bookmarks WHERE user_id = ? AND post_id = ?'
    ).get(userId, postId);
  },

  /** Toggle bookmark: returns { bookmarked, count }. */
  toggle(userId, postId) {
    const db = getDB();
    const existing = this.findOne(userId, postId);

    if (existing) {
      db.prepare('DELETE FROM bookmarks WHERE id = ?').run(existing.id);
    } else {
      db.prepare(
        'INSERT INTO bookmarks (user_id, post_id) VALUES (?, ?)'
      ).run(userId, postId);
    }

    const count = db.prepare(
      'SELECT COUNT(*) as c FROM bookmarks WHERE post_id = ?'
    ).get(postId);

    return { bookmarked: !existing, count: count.c };
  },

  /** Get bookmark count for a post. */
  countForPost(postId) {
    const row = getDB().prepare('SELECT COUNT(*) as c FROM bookmarks WHERE post_id = ?').get(postId);
    return (row || {}).c || 0;
  },

  /** Check if user bookmarked a post. */
  userBookmarked(userId, postId) {
    return !!getDB().prepare(
      'SELECT 1 FROM bookmarks WHERE user_id = ? AND post_id = ?'
    ).get(userId, postId);
  },

  /** List bookmarks for a user. */
  listByUser(userId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const posts = getDB().prepare(`
      SELECT p.*, u.username, u.display_name, b.created_at as bookmarked_at
      FROM bookmarks b
        JOIN posts p ON b.post_id = p.id
        JOIN users u ON p.author_id = u.id
      WHERE b.user_id = ? AND p.is_deleted = 0
      ORDER BY b.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = getDB().prepare(
      'SELECT COUNT(*) as c FROM bookmarks WHERE user_id = ?'
    ).get(userId);
    return { posts, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },
};

module.exports = { likeRepo, bookmarkRepo };
