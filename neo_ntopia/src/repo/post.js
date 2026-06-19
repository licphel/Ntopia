// Post data access — all post-related queries.
const { getDB } = require('../database');

const SELECT_POST = `
  SELECT p.*, u.username, u.display_name, u.avatar, u.level, u.role,
    COALESCE(cat.name, p.category) as category_name,
    cat.type as category_type,
    (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
  FROM posts p
    JOIN users u ON p.author_id = u.id
    LEFT JOIN categories cat ON p.category = cat.slug
`;

const WHERE_VISIBLE = `(p.is_deleted = 0 OR p.is_deleted IS NULL) AND p.is_draft = 0`;

const postRepo = {
  /** Find a visible post by slug, with author info. */
  findBySlug(slug) {
    return getDB().prepare(`
      ${SELECT_POST}
      WHERE p.slug = ? AND p.is_draft = 0
    `).get(slug);
  },

  /** Find a post by slug (including drafts, for owner). */
  findBySlugAny(slug) {
    return getDB().prepare(`
      ${SELECT_POST}
      WHERE p.slug = ?
    `).get(slug);
  },

  /** Find a post by ID. */
  findById(id) {
    return getDB().prepare('SELECT * FROM posts WHERE id = ?').get(id);
  },

  /** List posts with filtering, sorting, and pagination. */
  list({ category, sort = 'newest', page = 1, limit = 10, categoryType = 'blog' }) {
    const offset = (page - 1) * limit;

    let catFilter = '';
    const params = [];
    if (category) {
      catFilter = 'AND p.category = ?';
      params.push(category);
    } else {
      // Filter by category type: only show posts whose category matches the given type
      catFilter = `AND p.category IN (SELECT slug FROM categories WHERE type = ?)`;
      params.push(categoryType);
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

  /** List posts by tag. */
  listByTag(tag, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const tagLike = '%,' + tag + ',%';
    const posts = getDB().prepare(`
      ${SELECT_POST}
      WHERE ${WHERE_VISIBLE} AND (',' || p.tags || ',') LIKE ?
      ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?
    `).all(tagLike, limit, offset);
    const total = getDB().prepare(`
      SELECT COUNT(*) as c FROM posts
      WHERE ${WHERE_VISIBLE.replace(/p\./g, '')} AND (',' || tags || ',') LIKE ?
    `).get(tagLike);
    return { posts, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
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
  create({ title, slug, contentMd, contentHtml, category, tags, authorId, isDraft, license }) {
    return getDB().prepare(`
      INSERT INTO posts (title, slug, content_md, content_html, category, tags, author_id, is_draft, license)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(title, slug, contentMd, contentHtml, category || '', tags || '', authorId, isDraft ? 1 : 0, license || '');
  },

  /** Update a post. */
  update(id, { title, contentMd, contentHtml, category, tags, isDraft, license }) {
    getDB().prepare(`
      UPDATE posts SET title=?, content_md=?, content_html=?, category=?, tags=?, is_draft=?, license=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(title, contentMd, contentHtml, category || '', tags || '', isDraft ? 1 : 0, license || '', id);
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

  /** Increment view count. */
  incrementView(id) {
    getDB().prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').run(id);
  },

  /** Create a revision snapshot. */
  createRevision(postId, { title, contentMd, contentHtml, category, tags, revisedBy }) {
    getDB().prepare(`
      INSERT INTO post_revisions (post_id, title, content_md, content_html, category, tags, revised_by)
      VALUES (?,?,?,?,?,?,?)
    `).run(postId, title, contentMd, contentHtml, category || '', tags || '', revisedBy);
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
          AND (title LIKE ? OR content_md LIKE ? OR tags LIKE ?
            OR category LIKE ? OR category IN (SELECT slug FROM categories WHERE name LIKE ?))
      `).get(like, like, like, like, like);
      const posts = getDB().prepare(`
        SELECT p.*, u.username, u.display_name,
          (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
        FROM posts p JOIN users u ON p.author_id = u.id
        WHERE p.is_deleted = 0
          AND (p.title LIKE ? OR p.content_md LIKE ? OR p.tags LIKE ?
            OR p.category LIKE ? OR p.category IN (SELECT slug FROM categories WHERE name LIKE ?))
        ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?
      `).all(like, like, like, like, like, limit, offset);
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
  forDownload(slug) {
    return getDB().prepare(`
      SELECT p.title, p.content_md, p.license, p.created_at, u.display_name, u.username
      FROM posts p JOIN users u ON p.author_id = u.id
      WHERE p.slug = ? AND p.is_deleted = 0 AND p.is_draft = 0
    `).get(slug);
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
      SELECT slug, updated_at FROM posts WHERE is_deleted = 0 ORDER BY updated_at DESC
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
    const total = getDB().prepare(`
      SELECT COUNT(*) as c FROM categories WHERE type = 'forum'
    `).get();
    const sections = getDB().prepare(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c LEFT JOIN posts p ON p.category = c.slug AND p.is_deleted = 0 AND p.is_draft = 0
      WHERE c.type = 'forum'
      GROUP BY c.id ORDER BY post_count DESC, c.sort_order LIMIT ? OFFSET ?
    `).all(limit, offset);
    return { sections, total: total.c, page, totalPages: Math.ceil(total.c / limit) };
  },

  /** Search forum sections by name or slug. */
  searchSections(query, limit = 10) {
    const like = `%${query}%`;
    return getDB().prepare(`
      SELECT c.*, COUNT(p.id) as post_count
      FROM categories c LEFT JOIN posts p ON p.category = c.slug AND p.is_deleted = 0 AND p.is_draft = 0
      WHERE c.type = 'forum' AND (c.name LIKE ? OR c.slug LIKE ? OR c.description LIKE ?)
      GROUP BY c.id ORDER BY post_count DESC LIMIT ?
    `).all(like, like, like, limit);
  },

  /** Get all distinct tags. */
  allTags(limit = 20) {
    const rows = getDB().prepare(`
      SELECT DISTINCT tags FROM posts
      WHERE tags != '' AND is_deleted = 0 AND is_draft = 0
    `).all();
    const seen = new Set();
    const tags = [];
    for (const r of rows) {
      for (const tag of (r.tags || '').split(',')) {
        const t = tag.trim();
        if (t && !seen.has(t)) { seen.add(t); tags.push(t); }
      }
    }
    return tags.slice(0, limit);
  },

  /** Get recent posts for sidebar. */
  recentPosts(limit = 10) {
    return getDB().prepare(`
      SELECT id, title, slug, created_at FROM posts
      WHERE is_deleted = 0 AND is_draft = 0
        AND (category IN (SELECT slug FROM categories WHERE type = 'blog') OR category = '' OR category IS NULL)
      ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  },

  /** Get recent comments for sidebar. */
  recentComments(limit = 10) {
    return getDB().prepare(`
      SELECT c.id, c.created_at, u.username, u.display_name,
             c.content_html as cmt_content, p.title as post_title, p.slug as post_slug
      FROM comments c
        JOIN users u ON c.author_id = u.id
        JOIN posts p ON c.post_id = p.id
      WHERE p.is_deleted = 0
      ORDER BY c.created_at DESC LIMIT ?
    `).all(limit);
  },
};

module.exports = postRepo;
