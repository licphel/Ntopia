// Post data access — all post-related queries.
const { getDB } = require('../database');

const SELECT_POST = `
  SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
    COALESCE(cat.name, '') as category_name,
    
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
  FROM posts p
    JOIN users u ON p.author_id = u.id
    LEFT JOIN categories cat ON p.category_id = cat.id
`;

const WHERE_VISIBLE = `(p.is_deleted = 0 OR p.is_deleted IS NULL) AND p.is_draft = 0`;

const postRepo = {
  /** Find a visible post by ID, with author info. */
  findById(id) {
    return getDB().prepare(`
      ${SELECT_POST}
      WHERE p.id = ? AND p.is_draft = 0
    `).get(id);
  },

  /** Find a post by ID (including drafts, for owner). */
  findByIdAny(id) {
    return getDB().prepare(`
      ${SELECT_POST}
      WHERE p.id = ?
    `).get(id);
  },

  /** List posts with filtering, sorting, and pagination. */
  list({ categoryId, subCategory, isFeatured, sort = 'newest', page = 1, limit = 10 }) {
    const offset = (page - 1) * limit;

    let catFilter = '';
    const params = [];
    if (categoryId) {
      catFilter = 'AND p.category_id = ?';
      params.push(categoryId);
    }
    if (subCategory && subCategory !== '-1') {
      catFilter += ' AND p.sub_category = ?';
      params.push(subCategory);
    }
    if (isFeatured) {
      catFilter += ' AND p.is_featured = 1';
    }

    // Count total
    const countSQL = `SELECT COUNT(*) as c FROM posts WHERE ${WHERE_VISIBLE.replace(/p\./g, '')} ${catFilter.replace(/p\./g, '')}`;
    const total = getDB().prepare(countSQL).get(...params);

    // Build list query
    let orderBy;
    const listParams = [...params];

    if (sort === 'replies') {
      orderBy = 'ORDER BY p.is_pinned DESC, comment_count DESC';
    } else if (sort === 'hot') {
      const time = require('../util/time');
      const hotNow = time.toSQL().split(' ')[0];
      orderBy = `ORDER BY p.is_pinned DESC,
        (comment_count * 3.0 + p.view_count * 0.1) / ((julianday(?) - julianday(p.created_at)) * 24.0 + 4.0) DESC`;
      listParams.push(hotNow);
    } else {
      orderBy = 'ORDER BY p.is_pinned DESC, p.created_at DESC';
    }

    const posts = getDB().prepare(`
      ${SELECT_POST}
      WHERE ${WHERE_VISIBLE} ${catFilter}
      ${orderBy}
      LIMIT ? OFFSET ?
    `).all(...listParams, limit, offset);

    return { posts, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** List drafts for a user. */
  listDrafts(userId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const drafts = getDB().prepare(`
      SELECT * FROM posts
      WHERE author_id = ? AND is_draft = 1 AND is_deleted = 0
      ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = getDB().prepare(
      'SELECT COUNT(*) as c FROM posts WHERE author_id = ? AND is_draft = 1 AND is_deleted = 0'
    ).get(userId);
    return { drafts, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** List posts by user ID. */
  listByUser(userId, { page = 1, limit = 10, isOwner = false } = {}) {
    const offset = (page - 1) * limit;
    const deleteFilter = isOwner ? '' : 'AND is_deleted = 0';
    const posts = getDB().prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      WHERE p.author_id = ? ${deleteFilter.replace('is_deleted', 'p.is_deleted')}
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?
    `).all(userId, limit, offset);
    const total = getDB().prepare(
      `SELECT COUNT(*) as c FROM posts WHERE author_id = ? ${deleteFilter}`
    ).get(userId);
    return { posts, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Create a new post. */
  create({ title, contentMd, contentHtml, categoryId, subCategory, authorId, isDraft }) {
    return getDB().prepare(`
      INSERT INTO posts (title, content_md, content_html, category_id, sub_category, author_id, is_draft)
      VALUES (?,?,?,?,?,?,?)
    `).run(title, contentMd, contentHtml, categoryId || null, subCategory || '', authorId, isDraft ? 1 : 0);
  },

  /** Update a post. */
  update(id, { title, contentMd, contentHtml, categoryId, subCategory, isDraft }) {
    getDB().prepare(`
      UPDATE posts SET title=?, content_md=?, content_html=?, category_id=?, sub_category=?, is_draft=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(title, contentMd, contentHtml, categoryId || null, subCategory || '', isDraft ? 1 : 0, id);
  },

  /** Soft-delete a post. */
  softDelete(id) {
    getDB().prepare(`
      UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
  },

  /** Restore a soft-deleted post. */
  restore(id) {
    getDB().prepare(`
      UPDATE posts SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(id);
  },

  /** Hard-delete a post (for retention cleanup). */
  purge(id) {
    getDB().prepare('DELETE FROM comments WHERE post_id = ?').run(id);
    getDB().prepare('DELETE FROM posts WHERE id = ?').run(id);
  },

  /** Toggle pin. */
  togglePin(id, currentPinned) {
    getDB().prepare('UPDATE posts SET is_pinned = ? WHERE id = ?').run(currentPinned ? 0 : 1, id);
  },

  /** Toggle featured (精华). */
  toggleFeatured(id, current) {
    getDB().prepare('UPDATE posts SET is_featured = ? WHERE id = ?').run(current ? 0 : 1, id);
  },

  /** Increment view count. */
  incrementView(id) {
    getDB().prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(id);
  },

  /** Create a revision snapshot. */
  createRevision(postId, { title, contentMd, contentHtml, categoryId, revisedBy }) {
    getDB().prepare(`
      INSERT INTO post_revisions (post_id, title, content_md, content_html, category_id, revised_by)
      VALUES (?,?,?,?,?,?)
    `).run(postId, title, contentMd, contentHtml, categoryId || null, revisedBy);
  },

  /** Trim revisions to keep max 10. */
  trimRevisions(postId, keep = 10) {
    getDB().prepare(`
      DELETE FROM post_revisions WHERE id IN (
        SELECT id FROM post_revisions WHERE post_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?
      )
    `).run(postId, keep);
  },

  /** Get revisions for a post. */
  getRevisions(postId) {
    return getDB().prepare(`
      SELECT r.*, u.username, u.display_name
      FROM post_revisions r JOIN users u ON r.revised_by = u.id
      WHERE r.post_id = ? ORDER BY r.created_at DESC
    `).all(postId);
  },

  /** Get a single revision. */
  getRevision(revId, postId) {
    return getDB().prepare(
      'SELECT * FROM post_revisions WHERE id = ? AND post_id = ?'
    ).get(revId, postId);
  },

  /** Full-text search with pagination. Returns { posts, total }. */
  search(query, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    try {
      const ftsQuery = query.split(/\s+/).map(w => `"${w}"`).join(' ');
      const total = getDB().prepare(`
        SELECT COUNT(*) as c FROM posts_fts f JOIN posts p ON f.rowid = p.id
        WHERE posts_fts MATCH ? AND p.is_deleted = 0
      `).get(ftsQuery);
      const posts = getDB().prepare(`
        SELECT p.*, u.username, u.display_name,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
          rank
        FROM posts_fts f
          JOIN posts p ON f.rowid = p.id
          JOIN users u ON p.author_id = u.id
        WHERE posts_fts MATCH ? AND p.is_deleted = 0
        ORDER BY rank LIMIT ? OFFSET ?
      `).all(ftsQuery, limit, offset);
      return { posts, total: total?.c || 0, page, totalPages: Math.ceil((total?.c || 0) / limit) };
    } catch (_) {
      const like = `%${query}%`;
      const total = getDB().prepare(`
        SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0
          AND (title LIKE ? OR content_md LIKE ?
            OR category_id IN (SELECT id FROM categories WHERE name LIKE ?))
      `).get(like, like, like);
      const posts = getDB().prepare(`
        SELECT p.*, u.username, u.display_name,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts p JOIN users u ON p.author_id = u.id
        WHERE p.is_deleted = 0
          AND (p.title LIKE ? OR p.content_md LIKE ?
            OR p.category_id IN (SELECT id FROM categories WHERE name LIKE ?))
        ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?
      `).all(like, like, like, limit, offset);
      return { posts, total: total?.c || 0, page, totalPages: Math.ceil((total?.c || 0) / limit) };
    }
  },

  /** Get site statistics. */
  stats() {
    return {
      posts: getDB().prepare("SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 AND is_draft = 0").get().c,
      comments: getDB().prepare("SELECT COUNT(*) as c FROM comments WHERE is_deleted = 0 OR is_deleted IS NULL").get().c,
      users: getDB().prepare('SELECT COUNT(*) as c FROM users').get().c,
      views: getDB().prepare('SELECT COUNT(*) as c FROM site_views').get().c,
      todayViews: getDB().prepare("SELECT COUNT(*) as c FROM site_views WHERE date(created_at) = date('now')").get().c,
      likes: getDB().prepare('SELECT COUNT(*) as c FROM likes').get().c,
      bookmarks: getDB().prepare('SELECT COUNT(*) as c FROM bookmarks').get().c,
      checkins: getDB().prepare('SELECT COUNT(*) as c FROM checkins').get().c,
    };
  },

  /** Get post for download (MD export). */
  forDownload(id) {
    return getDB().prepare(`
      SELECT p.title, p.content_md, p.created_at, u.display_name, u.username
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.id = ? AND p.is_deleted = 0 AND p.is_draft = 0
    `).get(id);
  },

  /** Get posts for RSS feed. */
  forRSS(limit = 20) {
    return getDB().prepare(`
      SELECT p.*, u.display_name, u.username
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.is_deleted = 0
      ORDER BY p.created_at DESC LIMIT ?
    `).all(limit);
  },

  /** Get posts for sitemap. */
  forSitemap() {
    return getDB().prepare(`
      SELECT id, updated_at FROM posts WHERE is_deleted = 0 ORDER BY updated_at DESC
    `).all();
  },

  /** Track a page view. */
  trackView(path, ip) {
    getDB().prepare(
      'INSERT INTO site_views (path, ip) VALUES (?, ?)'
    ).run(path.slice(0, 200), ip || '');
  },

  /** Forum sections with post counts, sorted by popularity. */
  forumSections({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const total = getDB().prepare('SELECT COUNT(*) as c FROM categories').get();
    const sections = getDB().prepare(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c LEFT JOIN posts p ON p.category_id = c.id AND p.is_deleted = 0 AND p.is_draft = 0
      GROUP BY c.id ORDER BY post_count DESC, c.sort_order LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { sections, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Search sections by name or description. */
  searchSections(query, limit = 10) {
    const like = `%${query}%`;
    return getDB().prepare(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c LEFT JOIN posts p ON p.category_id = c.id AND p.is_deleted = 0 AND p.is_draft = 0
      WHERE c.name LIKE ? OR c.description LIKE ?
      GROUP BY c.id ORDER BY post_count DESC LIMIT ?
    `).all(like, like, limit);
  },

  /** Get recent posts for sidebar. */
  recentPosts(limit = 10) {
    return getDB().prepare(`
      SELECT id, title, created_at FROM posts
      WHERE is_deleted = 0 AND is_draft = 0
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  },

  /** Get recent comments for sidebar. */
  recentComments(limit = 10) {
    return getDB().prepare(`
      SELECT c.id, c.created_at, u.username, u.display_name,
             c.content_html as cmt_content, p.title as post_title, p.id as post_id
      FROM comments c
        JOIN users u ON c.author_id = u.id
        JOIN posts p ON c.post_id = p.id
      WHERE p.is_deleted = 0
      ORDER BY c.created_at DESC LIMIT ?
    `).all(limit);
  },
};

module.exports = postRepo;
