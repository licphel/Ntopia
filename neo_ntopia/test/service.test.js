// Service + integration tests — post, forum, bookmarks.
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

const testAuthor = { id: 1, username: 'admin', role: auth.LEVEL.OWNER, email: 'a@b.com' };

describe('Post — create & list', () => {
  it('creates a blog post', async () => {
    const r = await postService.createPost({
      title: 'Test Blog Post', content: 'Hello **world**', category: 'computer', tags: 'js,test', license: 'MIT', isDraft: false,
    }, testAuthor);
    assert.ok(r.ok, r.error || 'createPost failed');
    assert.ok(r.slug);
  });

  it('creates a forum post', async () => {
    const r = await postService.createPost({
      title: 'Test Forum Post', content: 'Forum discussion', category: 'general', tags: '', license: '', isDraft: false,
    }, testAuthor);
    assert.ok(r.ok);
  });

  it('creates a draft', async () => {
    const r = await postService.createPost({
      title: 'Draft', content: 'secret', category: '', tags: '', license: '', isDraft: true,
    }, testAuthor);
    assert.ok(r.ok);
    assert.ok(r.isDraft);
  });

  it('lists blog posts (only type=blog categories)', () => {
    const r = postService.listPosts(null, 'newest', 1, { categoryType: 'blog' });
    assert.ok(r.posts.length >= 1);
    // All returned posts should have blog category
    const blogSlugs = categoryRepo.all('blog').map(c => c.slug);
    r.posts.forEach(p => {
      assert.ok(blogSlugs.includes(p.category) || !p.category, `post ${p.title} has non-blog category: ${p.category}`);
    });
  });

  it('lists forum posts (only type=forum categories)', () => {
    const r = postService.listPosts(null, 'newest', 1, { categoryType: 'forum' });
    assert.ok(r.posts.length >= 1);
    const forumSlugs = categoryRepo.all('forum').map(c => c.slug);
    r.posts.forEach(p => {
      assert.ok(forumSlugs.includes(p.category), `post ${p.title} has non-forum category: ${p.category}`);
    });
  });

  it('filters blog by specific category', () => {
    const r = postService.listPosts('computer', 'newest', 1, { categoryType: 'blog' });
    r.posts.forEach(p => assert.strictEqual(p.category, 'computer'));
  });

  it('filters forum by specific section', () => {
    const r = postService.listPosts('general', 'newest', 1, { categoryType: 'forum' });
    r.posts.forEach(p => assert.strictEqual(p.category, 'general'));
  });

  it('retrieves a single post', () => {
    const post = postRepo.findBySlugAny('test-blog-post');
    if (post) {
      const r = postService.getPost(post.slug, testAuthor, {});
      assert.ok(!r.notFound);
      assert.strictEqual(r.post.title, 'Test Blog Post');
      assert.ok(r.comments !== undefined);
    }
  });

  it('edit post', () => {
    const post = postRepo.findBySlugAny('test-blog-post');
    if (post) {
      const r = postService.editPost(post.slug, {
        title: 'Updated Blog Post', content: 'Updated content', category: 'math', tags: 'updated', license: '', isDraft: false,
      }, testAuthor);
      assert.ok(r.ok);
      const updated = postRepo.findBySlugAny(post.slug);
      assert.strictEqual(updated.title, 'Updated Blog Post');
      assert.strictEqual(updated.category, 'math');
    }
  });

  it('soft-deletes a post (author)', () => {
    const { getDB } = require('../src/database');
    const post = getDB().prepare("SELECT slug FROM posts WHERE title = 'Test Forum Post' AND is_deleted = 0").get();
    if (!post) return;
    const r = postService.deletePost(post.slug, testAuthor);
    assert.ok(r.ok);
  });
});

describe('Bookmarks', () => {
  it('toggles bookmark on a post', () => {
    const post = postRepo.findBySlugAny('test-blog-post');
    if (!post) return;
    const r1 = socialService.toggleBookmark(1, post.id);
    assert.ok(r1.bookmarked);
    assert.strictEqual(r1.count, 1);

    const r2 = socialService.toggleBookmark(1, post.id);
    assert.ok(!r2.bookmarked);
    assert.strictEqual(r2.count, 0);
  });

  it('lists user bookmarks', () => {
    const r = socialService.getBookmarks(1, 1);
    assert.ok(r.posts !== undefined);
    assert.ok(r.totalPages !== undefined);
  });
});

describe('Forum sections', () => {
  it('all forum sections exist', () => {
    const sections = categoryRepo.all('forum');
    assert.ok(sections.length >= 5);
    const slugs = sections.map(s => s.slug);
    assert.ok(slugs.includes('general'));
    assert.ok(slugs.includes('tech'));
    assert.ok(slugs.includes('share'));
  });

  it('blog categories exist', () => {
    const cats = categoryRepo.all('blog');
    assert.ok(cats.length >= 5);
    const slugs = cats.map(c => c.slug);
    assert.ok(slugs.includes('computer'));
    assert.ok(slugs.includes('math'));
  });

  it('categories filtered by type are disjoint', () => {
    const blog = categoryRepo.all('blog').map(c => c.slug);
    const forum = categoryRepo.all('forum').map(c => c.slug);
    const overlap = blog.filter(s => forum.includes(s));
    assert.strictEqual(overlap.length, 0, 'blog and forum categories must not overlap');
  });
});
