// XP system tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');

// xpRepo.xpForLevel is a pure function, testable without DB
const xpRepo = require('../src/repo/xp');

describe('xp — xpForLevel', () => {
  it('level 1 requires 0 XP', () => {
    assert.strictEqual(xpRepo.xpForLevel(1), 0);
  });

  it('XP increases monotonically', () => {
    let prev = xpRepo.xpForLevel(1);
    for (let l = 2; l <= 20; l++) {
      const cur = xpRepo.xpForLevel(l);
      assert.ok(cur > prev, `Level ${l} (${cur}) should be > level ${l - 1} (${prev})`);
      prev = cur;
    }
  });

  it('level 2 = 5', () => {
    assert.strictEqual(xpRepo.xpForLevel(2), 5);
  });

  it('level 3 = 5 + round(5*1.5) = 5+8 = 13', () => {
    assert.strictEqual(xpRepo.xpForLevel(3), 13);
  });

  it('returns 0 for level 0', () => {
    assert.strictEqual(xpRepo.xpForLevel(0), 0);
  });
});
