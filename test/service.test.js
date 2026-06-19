// Service + integration tests — post, bookmarks, sections.
const { describe, it, before } = require('node:test');
const assert = require('node:assert');

before(() => {
  require('dotenv').config();
  require('../src/database').initDB();
});

// ── Helpers ──────────────────────────────────────────────────
const postService = require('../src/service/post');
const socialService = require('../src/service/social');
const auth = require('../src/lib/auth');
const { postRepo, categoryRepo } = require('../src/repo');
const { getDB } = require('../src/database');

const testAuthor = { id: 1, username: 'admin', role: auth.LEVEL.OWNER, email: 'a@b.com' };

// Category IDs: defaults seeded at init (1=综合讨论, 2=技术交流, 3=分享创造, 4=提问求助, 5=日常闲聊)
const catId1 = 2;
const catId2 = 1;

describe('Post — create & list', () => {
  it('creates a post', async () => {
    const r = await postService.createPost({
      title: 'Test Post One', content: 'Hello **world**', category: catId1, isDraft: false,
    }, testAuthor);
    assert.ok(r.ok, r.error || 'createPost failed');
    assert.ok(r.id);
  });

  it('creates another post in a different section', async () => {
    const r = await postService.createPost({
      title: 'Test Post Two', content: 'Discussion', category: catId2, isDraft: false,
    }, testAuthor);
    assert.ok(r.ok);
  });

  it('creates a draft', async () => {
    const r = await postService.createPost({
      title: 'Draft', content: 'secret', category: null, isDraft: true,
    }, testAuthor);
    assert.ok(r.ok);
    assert.ok(r.isDraft);
  });

  it('lists all posts', () => {
    const r = postService.listPosts(null, 'newest', 1);
    assert.ok(r.posts.length >= 2);
  });

  it('filters by specific category', () => {
    const r = postService.listPosts(catId1, 'newest', 1);
    r.posts.forEach(p => assert.strictEqual(p.category_id, catId1));
  });

  it('filters by specific section', () => {
    const r = postService.listPosts(catId2, 'newest', 1);
    r.posts.forEach(p => assert.strictEqual(p.category_id, catId2));
  });

  it('retrieves a single post', () => {
    const p = getDB().prepare("SELECT id FROM posts WHERE title = 'Test Post One' AND is_deleted = 0").get();
    if (p) {
      const r = postService.getPost(p.id, testAuthor, {});
      assert.ok(!r.notFound);
      assert.strictEqual(r.post.title, 'Test Post One');
      assert.ok(r.comments !== undefined);
    }
  });

  it('edit post', () => {
    const post = getDB().prepare("SELECT id FROM posts WHERE title = 'Test Post One' AND is_deleted = 0").get();
    if (post) {
      const r = postService.editPost(post.id, {
        title: 'Updated Post One', content: 'Updated content', category: catId2, isDraft: false,
      }, testAuthor);
      assert.ok(r.ok);
      const updated = postRepo.findByIdAny(post.id);
      assert.strictEqual(updated.title, 'Updated Post One');
      assert.strictEqual(updated.category_id, catId2);
    }
  });

  it('soft-deletes a post (author)', () => {
    const { getDB } = require('../src/database');
    const post = getDB().prepare("SELECT id FROM posts WHERE title = 'Test Post Two' AND is_deleted = 0").get();
    if (!post) return;
    const r = postService.deletePost(post.id, testAuthor);
    assert.ok(r.ok);
  });
});

describe('Bookmarks', () => {
  it('toggles bookmark on a post', () => {
    const p = getDB().prepare("SELECT id FROM posts WHERE title = 'Test Post One' AND is_deleted = 0").get();
    if (!p) return;
    const r1 = socialService.toggleBookmark(1, p.id);
    assert.ok(r1.bookmarked);
    assert.strictEqual(r1.count, 1);

    const r2 = socialService.toggleBookmark(1, p.id);
    assert.ok(!r2.bookmarked);
    assert.strictEqual(r2.count, 0);
  });

  it('lists user bookmarks', () => {
    const r = socialService.getBookmarks(1, 1);
    assert.ok(r.posts !== undefined);
    assert.ok(r.totalPages !== undefined);
  });
});

describe('Sections', () => {
  it('default sections exist', () => {
    const sections = categoryRepo.all();
    assert.ok(sections.length >= 5);
    const names = sections.map(s => s.name);
    assert.ok(names.includes('技术交流'));
    assert.ok(names.includes('综合讨论'));
    assert.ok(names.includes('分享创造'));
  });
});
