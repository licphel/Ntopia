// Markdown rendering, sanitization, and content helpers.
const { marked } = require('marked');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

marked.setOptions({ breaks: true, gfm: true });

const purify = createDOMPurify(new JSDOM('').window);

/** Render markdown to safe HTML, preserving $$...$$ math blocks. */
function renderMarkdown(md) {
  if (!md) return '';

  // Protect display math blocks from markdown parsing
  const blocks = [];
  let src = md.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    blocks.push(math.trim());
    return '%%MATHBLOCK' + (blocks.length - 1) + '%%';
  });

  let html = marked.parse(src);

  // Restore math blocks
  html = html.replace(/%%MATHBLOCK(\d+)%%/g, (_, i) => '$$' + blocks[parseInt(i)] + '$$');

  return purify.sanitize(html);
}

/** Extract headings (h2/h3) from rendered HTML for table of contents. */
function extractTOC(html) {
  const headings = [];
  const re = /<h([23])(?:\s[^>]*)?>(.*?)<\/h[23]>/gi;
  let m, idx = 0;
  while ((m = re.exec(html)) !== null) {
    headings.push({
      level: parseInt(m[1]),
      text: m[2].replace(/<[^>]*>/g, '').trim(),
      id: 'toc-' + (idx++),
    });
  }
  return headings;
}

/** Inject anchor IDs into h2/h3 tags for TOC linking. */
function injectHeadingIds(html) {
  let idx = 0;
  return html.replace(
    /(<h([23])(\s[^>]*)?>)(.*?)(<\/h[23]>)/gi,
    (full, open, level, attrs, text, close) =>
      `<h${level}${attrs || ''} id="toc-${idx++}">${text}${close}`
  );
}

/** Compute comment nesting depth (max 5). */
function computeDepth(comments) {
  const map = {};
  const getDepth = (c) => {
    if (map[c.id] !== undefined) return map[c.id];
    if (!c.parent_id) { map[c.id] = 0; return 0; }
    const parent = comments.find(x => x.id === c.parent_id);
    map[c.id] = Math.min(parent ? getDepth(parent) + 1 : 0, 5);
    return map[c.id];
  };
  comments.forEach(c => { c.depth = getDepth(c); });
}

/** Extract @username mentions from markdown text. */
function extractMentions(md) {
  const seen = new Set();
  const re = /(?:^|\s)@([a-zA-Z0-9_一-鿿]+)/g;
  let m;
  while ((m = re.exec(md)) !== null) seen.add(m[1].toLowerCase());
  return [...seen];
}

/** Replace @username with markdown profile links for known users. */
function linkMentions(md, validUsernames) {
  if (!validUsernames || !validUsernames.length) return md;
  const set = new Set(validUsernames.map(u => u.toLowerCase()));
  return md.replace(/(^|\s)@([a-zA-Z0-9_一-鿿]+)/g, (full, space, name) => {
    if (set.has(name.toLowerCase())) return `${space}[@${name}](/users/${name})`;
    return full;
  });
}

/** Extract first N visual lines from rendered HTML for previews. */
function firstNLines(html, n) {
  if (!html) return '';
  const blocks = html.split(/(<\/p>|<\/h[1-6]>|<\/li>|<\/pre>|<\/blockquote>|<\/table>)/i);
  let count = 0, result = '';
  for (let i = 0; i < blocks.length && count < n; i++) {
    result += blocks[i];
    if (/<\/(p|h[1-6]|li|pre|blockquote|table)>/i.test(blocks[i])) count++;
  }
  if (count >= n && !result.endsWith('...')) result += '...';
  return result;
}

module.exports = { renderMarkdown, extractTOC, injectHeadingIds, computeDepth, extractMentions, linkMentions, firstNLines };
