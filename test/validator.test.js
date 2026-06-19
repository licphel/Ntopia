// Validator tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const v = require('../src/util/validator');

describe('validator — validateUsername', () => {
  it('rejects empty',        () => assert.ok(v.validateUsername('')));
  it('rejects too short',    () => assert.ok(v.validateUsername('a')));
  it('rejects too long',     () => assert.ok(v.validateUsername('a'.repeat(65))));
  it('rejects special chars',() => assert.ok(v.validateUsername('hello world')));
  it('rejects pure symbols', () => assert.ok(v.validateUsername('!!!')));
  it('accepts normal',       () => assert.strictEqual(v.validateUsername('alice'), null));
  it('accepts chinese',      () => assert.strictEqual(v.validateUsername('你好世界'), null));
  it('accepts mixed',        () => assert.strictEqual(v.validateUsername('user_123'), null));
});

describe('validator — validatePassword', () => {
  it('rejects empty',      () => assert.ok(v.validatePassword('')));
  it('rejects too short',  () => assert.ok(v.validatePassword('ab')));
  it('rejects too long',   () => assert.ok(v.validatePassword('x'.repeat(65))));
  it('accepts normal',     () => assert.strictEqual(v.validatePassword('abcd'), null));
  it('accepts long',       () => assert.strictEqual(v.validatePassword('a1b2c3d4e5f6'), null));
});

describe('validator — validateEmail', () => {
  it('rejects empty',      () => assert.ok(v.validateEmail('')));
  it('rejects no @',       () => assert.ok(v.validateEmail('alice')));
  it('rejects no domain',  () => assert.ok(v.validateEmail('a@')));
  it('rejects no TLD',     () => assert.ok(v.validateEmail('a@b')));
  it('accepts valid',      () => assert.strictEqual(v.validateEmail('a@b.com'), null));
  it('accepts subdomain',  () => assert.strictEqual(v.validateEmail('a@mail.b.com'), null));
});

describe('validator — validateTitle', () => {
  it('rejects empty',      () => assert.ok(v.validateTitle('')));
  it('rejects whitespace', () => assert.ok(v.validateTitle('   ')));
  it('rejects too long',   () => assert.ok(v.validateTitle('x'.repeat(201))));
  it('accepts normal',     () => assert.strictEqual(v.validateTitle('Hello World'), null));
});

describe('validator — validateContent', () => {
  it('rejects empty',      () => assert.ok(v.validateContent('')));
  it('rejects whitespace', () => assert.ok(v.validateContent('  ')));
  it('accepts any text',   () => assert.strictEqual(v.validateContent('Hello'), null));
});

describe('validator — validateDisplayName', () => {
  it('accepts null/empty', () => assert.strictEqual(v.validateDisplayName(''), null));
  it('accepts normal',     () => assert.strictEqual(v.validateDisplayName('Alice'), null));
  it('rejects too long',   () => assert.ok(v.validateDisplayName('x'.repeat(65))));
});
