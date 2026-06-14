const { marked } = require('marked');
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(md) { return marked.parse(md || ''); }

function slugify(text) {
  return text.toLowerCase().replace(/[^\w一-鿿]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}

function computeDepth(comments) {
  const map = {};
  function getDepth(c) {
    if (map[c.id] !== undefined) return map[c.id];
    if (!c.parent_id) { map[c.id] = 0; return 0; }
    const parent = comments.find(x => x.id === c.parent_id);
    map[c.id] = Math.min(parent ? getDepth(parent) + 1 : 0, 5);
    return map[c.id];
  }
  comments.forEach(c => { c.depth = getDepth(c); });
}

module.exports = { renderMarkdown, slugify, computeDepth };
