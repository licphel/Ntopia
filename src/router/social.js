// Social routes — likes, bookmarks, follows, messages, notifications.
const express = require('express');
const socialService = require('../service/social');
const notificationService = require('../service/notification');
const { userRepo } = require('../repo');
const auth = require('../lib/auth');
const router = express.Router();

// Likes (AJAX)
router.post('/likes/toggle', auth.requireAuthAPI, (req, res) => {
  const r = socialService.toggleLike(req.session.user.id, { postId: req.body.post_id, commentId: req.body.comment_id });
  res.json({ ok: true, liked: r.liked, count: r.count });
});

// Bookmarks (AJAX toggle, page render for listing)
router.post('/bookmarks/toggle', auth.requireAuthAPI, (req, res) => {
  const r = socialService.toggleBookmark(req.session.user.id, req.body.post_id);
  res.json({ ok: true, bookmarked: r.bookmarked, count: r.count });
});
router.get('/bookmarks', auth.requireAuth, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const r = socialService.getBookmarks(req.session.user.id, page);
  res.render('page/bookmarks', { title: '收藏', posts: r.posts, bmPage: r.page, bmTotalPages: r.totalPages });
});

// Follows (AJAX)
router.post('/follow/:id(\\d+)', auth.requireAuthAPI, (req, res) => {
  res.json(socialService.toggleFollow(req.session.user.id, req.params.id));
});
router.get('/follow/:id(\\d+)/followers', (req, res) => {
  const p = userRepo.findById(parseInt(req.params.id));
  if (!p) return res.status(404).render('page/404', { title: '404' });
  const page = parseInt(req.query.page) || 1;
  const r = socialService.getFollowers(req.params.id, req.session.user ? req.session.user.id : null, page);
  res.render('page/follow-list', { title: p.display_name + ' 的粉丝', profile: p, users: r.users, page: r.page, totalPages: r.totalPages, listType: 'followers' });
});
router.get('/follow/:id(\\d+)/following', (req, res) => {
  const p = userRepo.findById(parseInt(req.params.id));
  if (!p) return res.status(404).render('page/404', { title: '404' });
  const page = parseInt(req.query.page) || 1;
  const r = socialService.getFollowing(req.params.id, req.session.user ? req.session.user.id : null, page);
  res.render('page/follow-list', { title: p.display_name + ' 的关注', profile: p, users: r.users, page: r.page, totalPages: r.totalPages, listType: 'following' });
});

// Messages
router.get('/messages', auth.requireAuth, (req, res) => {
  const r = socialService.getInbox(req.session.user.id, { msgPage: parseInt(req.query.page) || 1, sentPage: parseInt(req.query.sp) || 1 });
  res.render('page/messages', { title: '私信', msgs: r.msgs, sent: r.sent, msgPage: r.msgPage, msgTotalPages: r.msgTotalPages, sentPage: r.sentPage, sentTotalPages: r.sentTotalPages });
});
router.get('/messages/send/:id(\\d+)?', auth.requireAuth, (req, res) => {
  const toUser = req.params.id ? userRepo.findById(parseInt(req.params.id)) : null;
  res.render('page/send-message', { title: '发送私信', toUser, error: null });
});
router.post('/messages/send', auth.requireAuth, (req, res) => {
  const r = socialService.sendMessage(req.session.user, req.body.to_username, req.body.content);
  if (!r.ok) {
    const toUser = req.body.to_username ? userRepo.findById(parseInt(req.body.to_username)) : null;
    return res.render('page/send-message', { title: '发送私信', toUser, error: r.error });
  }
  res.redirect('/messages');
});

// Notifications
router.get('/notifications', auth.requireAuth, (req, res) => {
  const notifs = notificationService.getAndMarkRead(req.session.user.id);
  res.render('page/notifications', { title: '消息通知', notifs });
});

module.exports = router;
