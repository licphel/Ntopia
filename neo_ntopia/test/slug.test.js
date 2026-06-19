// Slug utility tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const slug = require('../src/util/slug');

describe('slug — slugify', () => {
  it('lowercases', () => {
    assert.strictEqual(slug.slugify('Hello'), 'hello');
  });

  it('replaces spaces with hyphens', () => {
    assert.strictEqual(slug.slugify('hello world'), 'hello-world');
  });

  it('removes special characters', () => {
    assert.strictEqual(slug.slugify('hello!!! world???'), 'hello-world');
  });

  it('handles Chinese characters', () => {
    const result = slug.slugify('你好世界');
    assert.ok(result.includes('你好世界'));
  });

  it('returns untitled for empty input', () => {
    assert.strictEqual(slug.slugify('!!!'), 'untitled');
  });

  it('trims leading/trailing hyphens', () => {
    assert.strictEqual(slug.slugify('  hello  '), 'hello');
  });
});

describe('slug — postSlug', () => {
  it('includes timestamp suffix', () => {
    const result = slug.postSlug('My Post');
    assert.ok(result.startsWith('my-post-'));
    assert.ok(result.length > 'my-post-'.length);
  });
});

describe('slug — categorySlug', () => {
  it('includes timestamp suffix', () => {
    const result = slug.categorySlug('Tech');
    assert.ok(result.startsWith('tech-'));
  });
});
