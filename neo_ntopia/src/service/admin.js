// Admin service — moderation actions, user management, reports.
// All permission checks delegated to lib/auth.
const bcrypt = require('bcryptjs');
const config = require('../config');
const auth = require('../lib/auth');
const { userRepo, postRepo, commentRepo, reportRepo, notificationRepo, messageRepo } = require('../repo');
const time = require('../util/time');

const adminService = {
  /** Get admin dashboard data. */
  dashboard() {
    const { getDB } = require('../database');
    const db = getDB();
    return {
      stats: {
        users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
        posts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE is_deleted = 0 OR is_deleted IS NULL').get().c,
        comments: db.prepare('SELECT COUNT(*) as c FROM comments').get().c,
        reports: reportRepo.pendingCount(),
      },
      loginLogs: db.prepare(`
        SELECT l.*, u.username FROM login_logs l
        JOIN users u ON l.user_id = u.id
        ORDER BY l.created_at DESC LIMIT 20
      `).all(),
    };
  },

  /** Create a category. */
  createCategory(name, description) {
    const slug = name.toLowerCase().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
    const { categoryRepo } = require('../repo/category');
    categoryRepo.create(name, slug, description);
  },

  /** Delete a category. */
  deleteCategory(id) {
    const { categoryRepo } = require('../repo/category');
    categoryRepo.delete(id);
  },

  /** Soft-delete a post (moderator). */
  deletePost(slug) {
    postRepo.softDelete(slug);
  },

  /** Hard-delete a post (admin, after retention period). */
  purgePost(slug) {
    const post = postRepo.findBySlugAny(slug);
    if (post && post.is_deleted) {
      postRepo.purge(post.id);
    }
  },

  /** Restore a soft-deleted post. */
  restorePost(slug) {
    const db = require('../database').getDB();
    db.prepare("UPDATE posts SET is_deleted = 0, updated_at = CURRENT_TIMESTAMP WHERE slug = ?").run(slug);
  },

  /** Toggle pin on a post. */
  togglePin(slug) {
    const post = postRepo.findBySlugAny(slug);
    if (post) postRepo.togglePin(post.id, post.is_pinned);
  },

  /** Soft-delete a comment (moderator). */
  deleteComment(commentId) {
    const cmt = commentRepo.findByIdWithPost(commentId);
    if (!cmt) return null;
    commentRepo.softDelete(commentId);
    return cmt.slug;
  },

  /** Ban a user. */
  banUser(targetId, adminUser) {
    const target = userRepo.findById(targetId);
    if (!target) return { ok: false, error: '用户不存在' };
    if (!auth.canBanUser(adminUser, target)) {
      return { ok: false, error: '无法封禁该用户' };
    }
    userRepo.ban(targetId);
    return { ok: true, username: target.username };
  },

  /** Unban a user. */
  unbanUser(targetId) {
    userRepo.unban(targetId);
    const u = userRepo.findById(targetId);
    return u ? u.username : '';
  },

  /** Promote a user to next role step. */
  promoteUser(targetId, adminUser) {
    const t = userRepo.findById(targetId);
    if (!t || t.banned) return { ok: false, error: '用户不存在或已封禁' };

    const nr = auth.nextPromotion(adminUser, t);
    if (nr === null) return { ok: false, error: '已达到你权限下最高等级' };

    userRepo.updateRole(targetId, nr);
    return { ok: true, username: t.username };
  },

  /** Demote a user to previous role step. */
  demoteUser(targetId, adminUser) {
    const t = userRepo.findById(targetId);
    if (!t) return { ok: false, error: '用户不存在' };

    const nr = auth.nextDemotion(adminUser, t);
    if (nr === null) return { ok: false, error: '该用户已是最低权限' };

    userRepo.updateRole(targetId, nr);
    return { ok: true, username: t.username };
  },

  /** Delete a user (admin). */
  deleteUser(targetId, adminUser) {
    const t = userRepo.findById(targetId);
    if (!t) return { ok: false, error: '用户不存在' };
    if (!auth.canDeleteUser(adminUser, t)) return { ok: false, error: '无法删除该用户' };

    const db = require('../database').getDB();
    db.prepare("UPDATE comments SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(t.id);
    db.prepare("UPDATE posts SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE author_id = ?").run(t.id);
    messageRepo.softDeleteUserMessages(t.id);
    notificationRepo.deleteAll(t.id);
    db.prepare('DELETE FROM checkins WHERE user_id = ?').run(t.id);
    db.prepare('DELETE FROM xp_log WHERE user_id = ?').run(t.id);
    db.prepare('DELETE FROM likes WHERE user_id = ?').run(t.id);
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(t.id);

    userRepo.softDelete(t.id, bcrypt.hashSync(Math.random().toString(), 10));
    return { ok: true, username: t.username };
  },

  /** Get reports list. */
  getReports(page) {
    const result = reportRepo.list({
      page: Math.max(1, page || 1),
      limit: config.REPORT_PAGE_SIZE,
    });

    // Enrich with target details
    const enriched = result.reports.map(r => {
      if (r.type === 'post') {
        const post = postRepo.findById(r.target_id);
        return Object.assign(r, {
          title: post ? post.title : '(已删除)',
          link: post ? '/posts/' + post.slug : '#',
        });
      } else {
        const cmt = commentRepo.findById(r.target_id);
        let preview = '(已删除)', link = '#';
        if (cmt) {
          const p = postRepo.findById(cmt.post_id);
          preview = (cmt.content_md || '').slice(0, 80);
          link = p ? '/posts/' + p.slug + '/comment/' + r.target_id : '#';
        }
        return Object.assign(r, { title: preview, link });
      }
    });

    return { ...result, reports: enriched };
  },

  /** Resolve a report. */
  resolveReport(id, action, resolverId) {
    reportRepo.resolve(id, action || 'resolved', resolverId);
  },
};

module.exports = adminService;
