// Comment routes.
const express = require('express');
const commentService = require('../service/comment');
const xpRepo = require('../repo/xp');
const time = require('../util/time');
const auth = require('../lib/auth');
const router = express.Router();

router.post('/:slug/comment', auth.requireActive, async (req, res) => {
  const r = await commentService.addComment(req.params.slug, { content: req.body.content, parentId: req.body.parent_id }, req.session.user);
  if (!r.ok) {
    if (r.banned) {
      require('../database').getDB().prepare("UPDATE users SET banned=1,banned_until=? WHERE id=?")
        .run(time.sqlFromNow(r.banDuration), req.session.user.id);
      return res.status(403).render('page/error', { title: '错误', code: 403, message: '评论审核未通过', detail: r.error, back: '/' });
    }
    return res.status(400).render('page/error', { title: '错误', code: 400, message: r.error, detail: '', back: '/' });
  }
  const u = xpRepo.getRefreshed(req.session.user.id);
  req.session.user.xp = u.xp; req.session.user.level = u.level; req.session.save();
  const base = '/posts/';
  res.redirect(r.threadId ? base + r.slug + '/comment/' + r.threadId : base + r.slug);
});

router.get('/:slug/comment/:id', (req, res) => {
  const r = commentService.getThread(req.params.slug, req.params.id, req.session.user);
  if (r.notFound) return res.status(404).render('page/404', { title: '404' });
  res.render('page/thread', { title: '帖子: ' + r.post.title, post: r.post, root: r.root, replies: r.replies, replyCount: r.replyCount });
});

router.post('/comments/:id/delete', auth.requireAuth, (req, res) => {
  const r = commentService.deleteComment(req.params.id, req.session.user);
  if (!r.ok) return res.status(403).render('page/error', { title: '错误', code: 403, message: r.error, detail: '', back: '/' });
  res.redirect('/posts/' + r.slug);
});

module.exports = router;
