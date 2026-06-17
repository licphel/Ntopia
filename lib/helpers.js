const { marked } = require('marked');
marked.setOptions({ breaks: true, gfm: true });

const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const purify = createDOMPurify(new JSDOM('').window);

function renderMarkdown(md) { return purify.sanitize(marked.parse(md || '')); }

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

function extractTOC(html) {
  const headings = [];
  const re = /<h([23])(?:\s[^>]*)?>(.*?)<\/h[23]>/gi;
  let m, idx = 0;
  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1]);
    const text = m[2].replace(/<[^>]*>/g, '').trim();
    const id = 'toc-' + (idx++);
    headings.push({ level, text, id });
  }
  return headings;
}

// Inject anchor IDs into HTML headings for TOC linking
function injectHeadingIds(html) {
  let idx = 0;
  return html.replace(/(<h([23])(\s[^>]*)?>)(.*?)(<\/h[23]>)/gi, (full, open, level, attrs, text, close) => {
    const id = 'toc-' + (idx++);
    return `<h${level}${attrs || ''} id="${id}">${text}${close}`;
  });
}

// Extract @username mentions from markdown text
function extractMentions(md) {
  const seen = new Set();
  const re = /(?:^|\s)@([a-zA-Z0-9_一-鿿]+)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    seen.add(m[1].toLowerCase());
  }
  return [...seen];
}

// Replace @username with markdown links for known users
function linkMentions(md, validUsernames) {
  if (!validUsernames || !validUsernames.length) return md;
  const set = new Set(validUsernames.map(u => u.toLowerCase()));
  return md.replace(/(^|\s)@([a-zA-Z0-9_一-鿿]+)/g, (full, space, name) => {
    if (set.has(name.toLowerCase())) {
      return `${space}[@${name}](/users/${name})`;
    }
    return full;
  });
}

// Extract first N visual lines from rendered HTML (block-level splits)
function firstNLines(html, n) {
  if (!html) return '';
  const blocks = html.split(/(<\/p>|<\/h[1-6]>|<\/li>|<\/pre>|<\/blockquote>|<\/table>)/i);
  let count = 0, result = '';
  for (let i = 0; i < blocks.length && count < n; i++) {
    result += blocks[i];
    if (/<\/(p|h[1-6]|li|pre|blockquote|table)>/i.test(blocks[i])) count++;
  }
  // Close any unclosed tags
  if (count >= n && !result.endsWith('...')) result += '...';
  return result;
}

module.exports = { renderMarkdown, slugify, computeDepth, extractTOC, injectHeadingIds, extractMentions, linkMentions, firstNLines };
