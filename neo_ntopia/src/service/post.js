// Post service — business logic for creating, editing, listing, and deleting posts.
const config = require('../config');
const auth = require('../lib/auth');
const { postRepo, xpRepo, likeRepo, bookmarkRepo, commentRepo } = require('../repo');
const { renderMarkdown, firstNLines, extractTOC, injectHeadingIds } = require('../util/markdown');
const { postSlug } = require('../util/slug');
const { validateTitle, validateContent } = require('../util/validator');
const moderationService = require('./moderation');
const time = require('../util/time');

const postService = {
  /** Get landing page stats. */
  homeStats() {
    return postRepo.stats();
  },

  /** List posts for blog or forum listing. */
  listPosts(category, sort, page, opts = {}) {
    const result = postRepo.list({
      category,
      sort,
      page: Math.max(1, page || 1),
      limit: opts.limit || config.PAGE_SIZE,
      categoryType: opts.categoryType || 'blog',
    });
    result.posts.forEach(p => { p.preview_html = firstNLines(p.content_html, 5); });
    return result;
  },

  /** List posts by tag. */
  listByTag(tag, page) {
    const result = postRepo.listByTag(tag, {
      page: Math.max(1, page || 1),
      limit: config.PAGE_SIZE,
    });
    result.posts.forEach(p => { p.preview_html = firstNLines(p.content_html, 5); });
    return result;
  },

  /** List user's drafts. */
  listDrafts(userId, page) {
    return postRepo.listDrafts(userId, {
      page: Math.max(1, page || 1),
      limit: config.PAGE_SIZE,
    });
  },

  /** Get a single post for display, with all context. */
  getPost(slug, viewer, { cookieHeader = '' } = {}) {
    const post = postRepo.findBySlug(slug);
    if (!post) return { notFound: true };

    if (post.is_deleted && !auth.canViewDeleted(viewer) && !auth.isOwner(viewer, post)) {
      return { notFound: true };
    }

    const viewedCookie = cookieHeader.match(/(?:^|;\s*)ntopia_views=([^;]*)/);
    const viewed = viewedCookie ? viewedCookie[1].split(',') : [];
    if (!viewed.includes(String(post.id))) {
      postRepo.incrementView(post.id);
      post.view_count++;
      viewed.push(String(post.id));
      if (viewed.length > 20) viewed.shift();
      post._trackView = true;
    }

    // Like/bookmark status
    let userLiked = false, userBookmarked = false;
    const likeCount = likeRepo.countForPost(post.id);
    const bookmarkCount = bookmarkRepo.countForPost(post.id);
    if (viewer) {
      userLiked = likeRepo.userLikedPost(viewer.id, post.id);
      userBookmarked = bookmarkRepo.userBookmarked(viewer.id, post.id);
    }

    // Comments
    const viewerRole = viewer ? (viewer.role || 0) : 0;
    const comments = commentRepo.forPost(post.id, viewerRole);
    const { computeDepth } = require('../util/markdown');
    computeDepth(comments);

    // TOC
    const toc = extractTOC(post.content_html);
    if (toc.length) post.content_html = injectHeadingIds(post.content_html);

    // Meta description
    const metaDesc = post.content_md
      .replace(/[#*`>\[\]()!~|\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);

    // BibTeX
    const bibtex = this._bibtex(post, slug);

    return {
      notFound: false,
      post, comments,
      toc: toc.length > 1 ? toc : null,
      metaDesc, bibtex,
      userLiked, userBookmarked,
      likeCount, bookmarkCount,
    };
  },

  /** Create a new post. */
  async createPost({ title, content, category, tags, license, isDraft }, author) {
    const titleErr = validateTitle(title);
    if (titleErr) return { ok: false, error: titleErr };
    const contentErr = validateContent(content);
    if (contentErr) return { ok: false, error: contentErr };

    const html = renderMarkdown(content);
    const slug = postSlug(title);

    // Moderation for non-drafts by non-moderators
    if (!isDraft && !auth.canModerate(author)) {
      const result = await moderationService.review(title, content, category || '');
      if (!result.pass) {
        return { ok: false, error: `内容审核未通过：${result.reason}`, banned: true, banDuration: '+1 hour' };
      }
    }

    postRepo.create({
      title, slug, contentMd: content, contentHtml: html,
      category, tags, authorId: author.id, isDraft, license,
    });

    if (!isDraft) {
      const created = postRepo.findBySlug(slug);
      xpRepo.award(author.id, config.XP_POST, '发布文章', created ? created.id : null);
    }

    return { ok: true, slug, isDraft };
  },

  /** Edit an existing post. */
  editPost(slug, { title, content, category, tags, license, isDraft }, editor) {
    const post = postRepo.findBySlugAny(slug);
    if (!auth.canEditPost(editor, post)) return { ok: false, error: '权限不足' };

    const html = renderMarkdown(content);

    // Save revision
    postRepo.createRevision(post.id, {
      title: post.title, contentMd: post.content_md,
      contentHtml: post.content_html, category: post.category || '',
      tags: post.tags || '', revisedBy: editor.id,
    });
    postRepo.trimRevisions(post.id, 10);

    postRepo.update(post.id, {
      title, contentMd: content, contentHtml: html,
      category, tags, isDraft, license,
    });

    return { ok: true, slug: post.slug, isDraft };
  },

  /** Soft-delete a post (author or mod). */
  deletePost(slug, user) {
    const post = postRepo.findBySlugAny(slug);
    if (!post) return { ok: false, error: '内容不存在' };
    if (!auth.canDeletePost(user, post)) return { ok: false, error: '权限不足' };
    postRepo.softDelete(post.id);
    return { ok: true };
  },

  /** Get revisions for a post. */
  getRevisions(slug, user) {
    const post = postRepo.findBySlugAny(slug);
    if (!auth.canEditPost(user, post)) return null;
    return {
      post,
      revisions: postRepo.getRevisions(post.id),
    };
  },

  /** Restore a revision. */
  restoreRevision(slug, revId, user) {
    const post = postRepo.findBySlugAny(slug);
    if (!auth.canEditPost(user, post)) return { ok: false, error: '权限不足' };

    const rev = postRepo.getRevision(revId, post.id);
    if (!rev) return { ok: false, error: '版本不存在' };

    // Save current as revision first
    postRepo.createRevision(post.id, {
      title: post.title, contentMd: post.content_md,
      contentHtml: post.content_html, category: post.category || '',
      tags: post.tags || '', revisedBy: user.id,
    });

    postRepo.update(post.id, {
      title: rev.title, contentMd: rev.content_md,
      contentHtml: rev.content_html, category: rev.category || '',
      tags: rev.tags || '', isDraft: false, license: post.license,
    });

    return { ok: true };
  },

  /** Get MD download data for a post. */
  getDownloadData(slug) {
    return postRepo.forDownload(slug);
  },

  /** Generate RSS XML. */
  generateRSS() {
    const posts = postRepo.forRSS(20);
    const siteUrl = config.SITE_URL;
    const escapeXml = (s) => (s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    let items = '';
    posts.forEach(p => {
      const desc = escapeXml(
        (p.content_md || '').replace(/[#*`>\[\]()!~|\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
      );
      items += `<item>
      <title>${escapeXml(p.title)}</title>
      <link>${siteUrl}/posts/${p.slug}</link>
      <description>${desc}</description>
      <author>${escapeXml(p.display_name || p.username)}</author>
      <pubDate>${new Date(p.created_at).toUTCString()}</pubDate>
      <guid>${siteUrl}/posts/${escapeXml(p.slug)}</guid>
    </item>\n`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Ntopia</title>
  <link>${siteUrl}</link>
  <description>记录思考，分享技术，探索世界</description>
  <language>zh-CN</language>
  <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
${items}</channel>
</rss>`;
  },

  /** Generate sitemap XML. */
  generateSitemap() {
    const posts = postRepo.forSitemap();
    const siteUrl = config.SITE_URL;
    let urls = `<url><loc>${siteUrl}</loc></url>\n`;
    posts.forEach(p => {
      urls += `<url><loc>${siteUrl}/posts/${p.slug}</loc><lastmod>${p.updated_at.slice(0, 10)}</lastmod></url>\n`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}</urlset>`;
  },

  /** List forum sections with pagination. */
  listForumSections(page) {
    return postRepo.forumSections({ page: Math.max(1, page || 1), limit: config.PAGE_SIZE });
  },

  /** Search posts, users, and boards. */
  search(query, type, page = 1) {
    const results = { postResults: [], userResults: [], boardResults: [], postPage: 1, postTotalPages: 0, postTotal: 0 };
    if (!query) return results;

    if (type === 'all' || type === 'posts') {
      const r = postRepo.search(query, { page, limit: config.PAGE_SIZE });
      results.postResults = r.posts;
      results.postPage = r.page;
      results.postTotalPages = r.totalPages;
      results.postTotal = r.total;
    }
    if (type === 'all' || type === 'users') {
      const { userRepo } = require('../repo');
      results.userResults = userRepo.search(query, 10);
    }
    if (type === 'all' || type === 'boards') {
      results.boardResults = postRepo.searchSections(query, 20);
    }
    return results;
  },

  /** Generate BibTeX citation. */
  _bibtex(post, slug) {
    const siteUrl = config.SITE_URL;
    const author = post.display_name || post.username;
    const year = new Date(post.created_at).getFullYear();
    const key = 'ntopia-' + (post.username || 'anon') + '-' + slug.slice(-8);
    return `@misc{${key},\n  author = {${author}},\n  title = {${post.title}},\n  year = {${year}},\n  howpublished = {\\url{${siteUrl}/posts/${slug}}},\n  note = {Accessed: ${time.now().toISOString().slice(0, 10)}}\n}`;
  },
};

module.exports = postService;
