// Guestbook service — anonymous message board.
const guestbookRepo = require('../repo/guestbook');
const { renderMarkdown } = require('../util/markdown');

const guestbookService = {
  /** List messages for a board. */
  list(board, page = 1) {
    const r = guestbookRepo.list(board, { page: Math.max(1, page), limit: 15 });
    r.msgs.forEach(m => {
      m.content_html = renderMarkdown(m.content || '');
    });
    return r;
  },

  /** Get replies for a parent message. */
  replies(parentId) {
    const reps = guestbookRepo.replies(parentId);
    reps.forEach(r => { r.content_html = renderMarkdown(r.content || ''); });
    return reps;
  },

  /** Post a new message or reply. */
  post({ board, content, parentId, ip }) {
    if (!content || !content.trim()) return { ok: false, error: '内容不能为空' };
    if (content.length > 2000) return { ok: false, error: '内容过长（最多2000字）' };
    const id = guestbookRepo.create({ board: board || 'general', content: content.trim(), parentId: parentId || null, ip });
    return { ok: true, id };
  },

  /** Delete a message (MOD+ only, checked at route level). */
  deleteMsg(id) {
    guestbookRepo.delete(id);
    return { ok: true };
  },

  /** List boards. */
  boards() {
    return guestbookRepo.boards();
  },
};

module.exports = guestbookService;
