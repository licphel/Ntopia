// CSRF middleware tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { generateToken } = require('../src/middleware/csrf');

describe('csrf — generateToken', () => {
  it('generates a hex string', () => {
    const session = {};
    const token = generateToken(session);
    assert.strictEqual(typeof token, 'string');
    assert.strictEqual(token.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(token));
  });

  it('reuses existing token', () => {
    const session = {};
    const t1 = generateToken(session);
    const t2 = generateToken(session);
    assert.strictEqual(t1, t2);
  });

  it('stores token on session', () => {
    const session = {};
    generateToken(session);
    assert.ok(session._csrf);
    assert.strictEqual(typeof session._csrf, 'string');
  });

  it('generates different tokens for different sessions', () => {
    const s1 = {}, s2 = {};
    const t1 = generateToken(s1);
    const t2 = generateToken(s2);
    assert.notStrictEqual(t1, t2);
  });
});
