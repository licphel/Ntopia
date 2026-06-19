// Comment service — creating, listing, and managing comments.
const config = require('../config');
const auth = require('../lib/auth');
const { commentRepo, postRepo, notificationRepo, xpRepo } = require('../repo');
const { renderMarkdown, extractMentions, linkMentions } = require('../util/markdown');
const { validateContent } = require('../util/validator');
const moderationService = require('./moderation');
const time = require('../util/time');
const userRepo = require('../repo/user');

const commentService = {
  async addComment(postId, { content, parentId }, author) {
    const contentErr = validateContent(content);
    if (contentErr) return { ok: false, error: contentErr };

    const post = postRepo.findById(postId);
    if (!post) return { ok: false, error: '内容不存在' };

    if (parentId) {
      const parent = commentRepo.findById(parentId);
      if (!parent) return { ok: false, error: '评论不存在' };
      if (parent.is_deleted) return { ok: false, error: '该评论已被删除，无法回复' };
    }

    if (!auth.canModerate(author)) {
      const result = await moderationService.reviewComment(content);
      if (!result.pass) {
        return { ok: false, error: `评论审核未通过：${result.reason}`, banned: true, banDuration: '+1 hour' };
      }
    }

    const mentions = extractMentions(content);
    let mentionUsers = [];
    if (mentions.length) {
      mentionUsers = mentions.map(u => userRepo.findByUsername(u)).filter(Boolean);
    }
    const linkedContent = linkMentions(content, mentionUsers.map(u => u.username));
    const html = renderMarkdown(linkedContent);

    const commentId = commentRepo.create({
      postId: post.id, authorId: author.id,
      contentMd: content, contentHtml: html, parentId,
    });

    if (xpRepo.checkDailyLimit(author.id, '评论', config.XP_COMMENT_DAILY_CAP)) {
      xpRepo.award(author.id, config.XP_COMMENT, '评论', commentId);
    }

    const myName = author.display_name || author.username;
    const postUrl = '/posts/' + post.id;

    if (post.author_id !== author.id) {
      notificationRepo.create(post.author_id, 'reply', `${myName} 评论了你的帖子`, postUrl);
    }

    mentionUsers.forEach(u => {
      if (u.id !== author.id && u.id !== post.author_id) {
        notificationRepo.create(u.id, 'mention', `${myName} 在评论中提到了你`, postUrl);
      }
    });

    if (parentId) {
      const p = commentRepo.findById(parentId);
      if (p && p.author_id !== author.id) {
        notificationRepo.create(p.author_id, 'reply', `${myName} 回复了你的评论`, postUrl);
      }
    }

    let threadId = parentId;
    if (parentId) {
      const p = commentRepo.findById(parentId);
      if (p && p.parent_id) threadId = p.parent_id;
    }

    return { ok: true, postId: post.id, threadId };
  },

  getThread(postId, commentId, viewer) {
    const post = postRepo.findById(postId);
    if (!post) return { notFound: true };
    if (post.is_draft && !auth.isOwner(viewer, post)) return { notFound: true };

    const viewerRole = viewer ? (viewer.role || 0) : 0;
    const root = commentRepo.findByIdForThread(commentId, post.id, viewerRole);
    if (!root) return { notFound: true };

    const allComments = commentRepo.forPost(post.id, viewerRole);

    const getDescendants = (pid, arr = []) => {
      for (const c of allComments) {
        if (c.parent_id === pid) { arr.push(c); getDescendants(c.id, arr); }
      }
      return arr;
    };
    const countDescendants = (pid) => {
      let n = 0;
      for (const c of allComments) if (c.parent_id === pid) n += 1 + countDescendants(c.id);
      return n;
    };

    return {
      notFound: false,
      post, root,
      replies: getDescendants(root.id),
      replyCount: countDescendants(root.id),
    };
  },

  deleteComment(commentId, user) {
    const cmt = commentRepo.findByIdWithPost(commentId);
    if (!cmt) return { ok: false, error: '评论不存在' };
    if (!auth.canDeleteComment(user, cmt)) return { ok: false, error: '权限不足' };
    commentRepo.softDelete(commentId);
    return { ok: true, postId: cmt.post_id };
  },
};

module.exports = commentService;
