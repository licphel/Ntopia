// Smoke tests for Ntopia core modules
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// ── Helpers (pure functions, safe to test) ──────────────────────
describe('helpers', () => {
  const { slugify, renderMarkdown, extractMentions, linkMentions, extractTOC, injectHeadingIds } = require('../lib/helpers');

  it('slugify should convert Chinese + English text', () => {
    assert.strictEqual(slugify('Hello World 你好'), 'hello-world-你好');
    assert.strictEqual(slugify('  Foo   Bar  '), 'foo-bar');
    assert.strictEqual(slugify('###'), 'untitled');
  });

  it('renderMarkdown should produce safe HTML', () => {
    const html = renderMarkdown('**bold** and *italic*');
    assert.ok(html.includes('<strong>bold</strong>'));
    assert.ok(html.includes('<em>italic</em>'));
  });

  it('renderMarkdown should strip XSS', () => {
    const html = renderMarkdown('<script>alert("xss")</script>');
    assert.ok(!html.includes('<script>'));
  });

  it('extractMentions should find @usernames', () => {
    const mentions = extractMentions('Hello @alice and @bob_test, not @');
    assert.deepStrictEqual(mentions, ['alice', 'bob_test']);
  });

  it('extractMentions should deduplicate', () => {
    const mentions = extractMentions('@alice @alice @bob');
    assert.deepStrictEqual(mentions, ['alice', 'bob']);
  });

  it('linkMentions should convert @names to markdown links', () => {
    const result = linkMentions('Hi @alice and @bob', ['alice']);
    assert.ok(result.includes('[@alice](/users/alice)'));
    assert.ok(!result.includes('[@bob]')); // bob not in valid list
  });

  it('extractTOC should find h2 and h3 headings', () => {
    const toc = extractTOC('<h2>Chapter 1</h2><p>text</p><h3>Section</h3>');
    assert.strictEqual(toc.length, 2);
    assert.strictEqual(toc[0].level, 2);
    assert.strictEqual(toc[0].text, 'Chapter 1');
    assert.strictEqual(toc[1].level, 3);
  });

  it('injectHeadingIds should add id attributes', () => {
    const result = injectHeadingIds('<h2>Title</h2><h3>Sub</h3>');
    assert.ok(result.includes('id="toc-0"'));
    assert.ok(result.includes('id="toc-1"'));
  });
});

// ── XP system (pure math) ──────────────────────────────────────
describe('xp', () => {
  const { xpForLevel } = require('../lib/xp');

  it('xpForLevel(1) should be 0', () => {
    assert.strictEqual(xpForLevel(1), 0);
  });

  it('xpForLevel should increase with level', () => {
    assert.ok(xpForLevel(5) > xpForLevel(3));
    assert.ok(xpForLevel(10) > xpForLevel(5));
  });

  it('xpForLevel should be monotonic', () => {
    let prev = -1;
    for (let i = 1; i <= 20; i++) {
      const cur = xpForLevel(i);
      assert.ok(cur >= prev, `Level ${i}: ${cur} >= ${prev}`);
      prev = cur;
    }
  });
});

// ── Permissions ────────────────────────────────────────────────
describe('perm', () => {
  const { role, id, canEdit, canDelete, canDeleteComment, canAccessAdmin, canPost } = require('../lib/perm');

  const guest = null;
  const user = { id: 5, role: 1, banned: 0 };
  const mod = { id: 3, role: 16 };
  const admin = { id: 2, role: 32 };
  const owner = { id: 1, role: 128 };
  const bannedUser = { id: 9, role: 1, banned: 1 };
  const post = { author_id: 5 };

  it('role should return 0 for null', () => assert.strictEqual(role(guest), 0));
  it('role should return user role', () => assert.strictEqual(role(admin), 32));

  it('id should return 0 for null', () => assert.strictEqual(id(guest), 0));
  it('id should return user id', () => assert.strictEqual(id(user), 5));

  it('canPost should require email', () => {
    assert.strictEqual(canPost(user), false);
  });

  it('canEdit should allow owner of post', () => {
    assert.strictEqual(canEdit(user, post), true);
  });

  it('canEdit should allow admin', () => {
    assert.strictEqual(canEdit(admin, post), true);
  });

  it('canEdit should deny other user', () => {
    assert.strictEqual(canEdit({ id: 6, role: 1 }, post), false);
  });

  it('canEdit should deny guest', () => {
    assert.strictEqual(canEdit(guest, post), false);
  });

  it('canDelete should allow owner or admin+', () => {
    assert.strictEqual(canDelete(user, post), true);          // owner
    assert.strictEqual(canDelete({ id: 6, role: 1 }, post), false); // other user
    assert.strictEqual(canDelete(mod, post), false);           // mod NOT > MOD
    assert.strictEqual(canDelete(admin, post), true);          // admin > MOD
  });

  it('canDeleteComment should allow owner or admin+', () => {
    const cmt = { author_id: 5 };
    assert.strictEqual(canDeleteComment(user, cmt), true);          // owner
    assert.strictEqual(canDeleteComment(mod, cmt), false);           // mod NOT > MOD
    assert.strictEqual(canDeleteComment({ id: 6, role: 1 }, cmt), false); // other user
    assert.strictEqual(canDeleteComment(admin, cmt), true);          // admin > MOD
  });

  it('canAccessAdmin should require ADMIN level', () => {
    assert.strictEqual(canAccessAdmin(guest), false);
    assert.strictEqual(canAccessAdmin(user), false);
    assert.strictEqual(canAccessAdmin(mod), false);
    assert.strictEqual(canAccessAdmin(admin), true);
    assert.strictEqual(canAccessAdmin(owner), true);
  });
});

// ── CSRF ───────────────────────────────────────────────────────
describe('csrf', () => {
  const { generateToken } = require('../lib/csrf');

  it('generateToken should create and return a hex token', () => {
    const session = {};
    const token = generateToken(session);
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 64);
    assert.strictEqual(session._csrf, token);
  });

  it('generateToken should reuse existing token', () => {
    const session = { _csrf: 'existing' };
    assert.strictEqual(generateToken(session), 'existing');
  });
});
