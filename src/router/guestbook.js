// Guestbook routes — anonymous message board.
const express = require('express');
const guestbookService = require('../service/guestbook');
const auth = require('../lib/auth');
const api = require('../lib/res');
const config = require('../config');

const router = express.Router();

// Redirect bare /guestbook to default board
router.get('/guestbook', (req, res) => res.redirect('/guestbook/' + config.GUESTBOOK_BOARDS[0]));

// List messages for a board
router.get('/guestbook/:board', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const board = req.params.board;
  // Redirect to default if board doesn't exist in config
  if (!config.GUESTBOOK_BOARDS.includes(board))
    return res.redirect('/guestbook/' + config.GUESTBOOK_BOARDS[0]);
  const r = guestbookService.list(board, page);
  if (req.xhr || req.get('Accept')?.includes('json')) {
    return res.json({ ok: true, ...r });
  }
  res.render('page/guestbook', {
    title: '留言 — ' + board, board, boards: config.GUESTBOOK_BOARDS, ...r,
  });
});

// Post a new message
router.post('/guestbook/:board', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || '';
  const r = guestbookService.post({
    board: req.params.board,
    content: req.body.content,
    parentId: req.body.parent_id ? parseInt(req.body.parent_id) : null,
    ip,
  });
  if (!r.ok) return res.status(400).json(api.err(r.error, 400));
  res.json(api.ok({ id: r.id }));
});

// Get replies for a message
router.get('/guestbook/:board/replies/:id', (req, res) => {
  const replies = guestbookService.replies(parseInt(req.params.id));
  res.json({ ok: true, replies });
});

// Delete a message (MOD+)
router.post('/guestbook/:board/delete/:id', auth.requireAuthAPI, (req, res) => {
  if (!auth.hasRole(req.session.user, auth.LEVEL.MOD))
    return res.status(403).json(api.err('权限不足', 403));
  guestbookService.deleteMsg(parseInt(req.params.id));
  res.json(api.ok({}));
});

module.exports = router;
