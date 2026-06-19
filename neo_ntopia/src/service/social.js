// Social service — likes, bookmarks, follows, messages.
const config = require('../config');
const { likeRepo, bookmarkRepo, followRepo, messageRepo, notificationRepo, xpRepo } = require('../repo');
const { renderMarkdown } = require('../util/markdown');

const socialService = {
  // ── Likes ────────────────────────────────────────────────────

  /** Toggle like on a post or comment. */
  toggleLike(userId, { postId, commentId }) {
    const result = likeRepo.toggle(userId, { postId, commentId });

    // Award XP to post author when liked
    if (result.liked && postId) {
      const post = likeRepo.postAuthor(postId);
      if (post && post.author_id !== userId) {
        if (xpRepo.checkDailyLimit(post.author_id, '被点赞', config.XP_LIKE_DAILY_CAP)) {
          xpRepo.award(post.author_id, config.XP_LIKE_RECEIVED, '被点赞', postId);
        }
      }
    }

    return result;
  },

  // ── Bookmarks ────────────────────────────────────────────────

  /** Toggle bookmark on a post. */
  toggleBookmark(userId, postId) {
    const result = bookmarkRepo.toggle(userId, postId);

    // Award XP to post author when bookmarked
    if (result.bookmarked) {
      const post = likeRepo.postAuthor(postId);
      if (post && post.author_id !== userId) {
        if (xpRepo.checkDailyLimit(post.author_id, '被收藏', config.XP_BOOKMARK_DAILY_CAP)) {
          xpRepo.award(post.author_id, config.XP_BOOKMARK_RECEIVED, '被收藏', postId);
        }
      }
    }

    return result;
  },

  /** Get user's bookmarks. */
  getBookmarks(userId, page) {
    return bookmarkRepo.listByUser(userId, {
      page: Math.max(1, page || 1),
      limit: config.PAGE_SIZE,
    });
  },

  // ── Follows ──────────────────────────────────────────────────

  /** Toggle follow. */
  toggleFollow(followerId, targetUsername) {
    const userRepo = require('../repo/user');
    const target = userRepo.findByUsername(targetUsername);
    if (!target || target.id === followerId) return { ok: false, error: '无法操作' };

    const result = followRepo.toggle(followerId, target.id);

    // Notify on new follow
    if (result.following) {
      // Follower's display name
      const follower = userRepo.findById(followerId);
      const myName = (follower.display_name || follower.username);
      notificationRepo.create(
        target.id, 'follow',
        `${myName} 关注了你`,
        '/users/' + follower.username
      );
    }

    return { ok: true, following: result.following };
  },

  /** Get followers list. */
  getFollowers(username, viewerId, page) {
    const result = followRepo.followers(username, {
      page: Math.max(1, page || 1),
      limit: config.FOLLOW_PAGE_SIZE,
    });

    // Mark which users viewer follows
    if (viewerId && result.users.length) {
      const followedSet = followRepo.followedSet(
        viewerId, result.users.map(u => u.id)
      );
      result.users.forEach(u => { u.isFollowed = followedSet.has(u.id); });
    }

    return result;
  },

  /** Get following list. */
  getFollowing(username, viewerId, page) {
    const result = followRepo.following(username, {
      page: Math.max(1, page || 1),
      limit: config.FOLLOW_PAGE_SIZE,
    });

    if (viewerId && result.users.length) {
      const followedSet = followRepo.followedSet(
        viewerId, result.users.map(u => u.id)
      );
      result.users.forEach(u => { u.isFollowed = followedSet.has(u.id); });
    }

    return result;
  },

  // ── Messages ─────────────────────────────────────────────────

  /** Get inbox (received + sent). */
  getInbox(userId, { msgPage = 1, sentPage = 1 } = {}) {
    const inbox = messageRepo.inbox(userId, {
      page: Math.max(1, msgPage),
      limit: config.PAGE_SIZE,
    });
    const sent = messageRepo.sent(userId, {
      page: Math.max(1, sentPage),
      limit: config.PAGE_SIZE,
    });

    // Mark all as read
    messageRepo.markAllRead(userId);

    return {
      msgs: inbox.msgs,
      sent: sent.sent,
      msgPage: inbox.page, msgTotalPages: inbox.totalPages,
      sentPage: sent.page, sentTotalPages: sent.totalPages,
    };
  },

  /** Send a private message. */
  sendMessage(fromUser, toUsername, content) {
    const userRepo = require('../repo/user');
    const toUser = userRepo.findByUsername(toUsername);
    if (!toUser) return { ok: false, error: '用户不存在' };

    const html = renderMarkdown(content || '');
    messageRepo.send(fromUser.id, toUser.id, content, html);

    // Notify recipient
    const myName = fromUser.display_name || fromUser.username;
    notificationRepo.create(
      toUser.id, 'message',
      `${myName} 给你发了一条私信`,
      '/messages'
    );

    return { ok: true };
  },
};

module.exports = socialService;
