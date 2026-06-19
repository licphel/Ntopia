// Markdown utility tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const md = require('../src/util/markdown');

describe('markdown — renderMarkdown', () => {
  it('returns empty for null', () => {
    assert.strictEqual(md.renderMarkdown(null), '');
    assert.strictEqual(md.renderMarkdown(''), '');
  });

  it('renders basic text', () => {
    const html = md.renderMarkdown('Hello');
    assert.ok(html.includes('Hello'));
  });

  it('renders bold', () => {
    const html = md.renderMarkdown('**bold**');
    assert.ok(html.includes('<strong>bold</strong>'));
  });

  it('preserves math blocks', () => {
    const html = md.renderMarkdown('Before $$x^2$$ after');
    assert.ok(html.includes('$$x^2$$'));
  });

  it('sanitizes XSS', () => {
    const html = md.renderMarkdown('<script>alert(1)</script>');
    assert.strictEqual(html.includes('<script>'), false);
  });
});

describe('markdown — extractTOC', () => {
  it('extracts h2 and h3', () => {
    const html = '<h2>Chapter 1</h2><p>text</p><h3>Section</h3>';
    const toc = md.extractTOC(html);
    assert.strictEqual(toc.length, 2);
    assert.strictEqual(toc[0].level, 2);
    assert.strictEqual(toc[0].text, 'Chapter 1');
    assert.strictEqual(toc[1].level, 3);
    assert.strictEqual(toc[1].text, 'Section');
  });

  it('skips non-heading tags', () => {
    const html = '<p>paragraph</p><h4>h4</h4>';
    const toc = md.extractTOC(html);
    assert.strictEqual(toc.length, 0);
  });
});

describe('markdown — injectHeadingIds', () => {
  it('adds ids to headings', () => {
    const html = md.injectHeadingIds('<h2>Title</h2><h3>Sub</h3>');
    assert.ok(html.includes('id="toc-0"'));
    assert.ok(html.includes('id="toc-1"'));
  });
});

describe('markdown — extractMentions', () => {
  it('extracts @username mentions', () => {
    const mentions = md.extractMentions('Hello @alice and @bob_test!');
    assert.ok(mentions.includes('alice'));
    assert.ok(mentions.includes('bob_test'));
  });

  it('deduplicates', () => {
    const mentions = md.extractMentions('Hi @alice and @alice again');
    assert.strictEqual(mentions.length, 1);
  });

  it('handles no mentions', () => {
    assert.strictEqual(md.extractMentions('no mentions').length, 0);
  });
});

describe('markdown — linkMentions', () => {
  it('links known usernames', () => {
    const result = md.linkMentions('Hi @alice', ['alice']);
    assert.ok(result.includes('[@alice](/users/alice)'));
  });

  it('ignores unknown usernames', () => {
    const result = md.linkMentions('Hi @bob', ['alice']);
    assert.ok(result.includes('@bob'));
    assert.strictEqual(result.includes('[@bob]'), false);
  });
});

describe('markdown — firstNLines', () => {
  it('returns first N block elements', () => {
    const html = '<p>Line 1</p><p>Line 2</p><p>Line 3</p>';
    const result = md.firstNLines(html, 2);
    const count = (result.match(/<p>/g) || []).length;
    assert.strictEqual(count, 2);
  });

  it('handles empty', () => {
    assert.strictEqual(md.firstNLines('', 5), '');
    assert.strictEqual(md.firstNLines(null, 5), '');
  });
});

describe('markdown — computeDepth', () => {
  it('sets depth for flat comments', () => {
    const comments = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: null },
    ];
    md.computeDepth(comments);
    assert.strictEqual(comments[0].depth, 0);
    assert.strictEqual(comments[1].depth, 0);
  });

  it('sets depth for nested comments', () => {
    const comments = [
      { id: 1, parent_id: null },
      { id: 2, parent_id: 1 },
      { id: 3, parent_id: 2 },
    ];
    md.computeDepth(comments);
    assert.strictEqual(comments[0].depth, 0);
    assert.strictEqual(comments[1].depth, 1);
    assert.strictEqual(comments[2].depth, 2);
  });

  it('caps depth at 5', () => {
    const comments = [];
    for (let i = 1; i <= 8; i++) {
      comments.push({ id: i, parent_id: i === 1 ? null : i - 1 });
    }
    md.computeDepth(comments);
    assert.strictEqual(comments[7].depth, 5);
  });
});
