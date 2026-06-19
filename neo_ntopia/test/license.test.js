// License tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { LICENSES, licenseText } = require('../src/lib/license');

describe('license — LICENSES', () => {
  it('has all expected licenses', () => {
    const keys = LICENSES.map(l => l.key);
    assert.ok(keys.includes(''));
    assert.ok(keys.includes('MIT'));
    assert.ok(keys.includes('CC-BY-4.0'));
    assert.ok(keys.includes('CC-BY-SA-4.0'));
    assert.ok(keys.includes('CC-BY-NC-SA-4.0'));
    assert.ok(keys.includes('CC0-1.0'));
    assert.ok(keys.includes('GPL-3.0'));
  });

  it('each license has key and name', () => {
    LICENSES.forEach(l => {
      assert.ok('key' in l);
      assert.ok('name' in l);
    });
  });
});

describe('license — licenseText', () => {
  it('default is All Rights Reserved', () => {
    const text = licenseText('', { author: 'Alice', year: 2024 });
    assert.ok(text.includes('All rights reserved'));
    assert.ok(text.includes('Alice'));
  });

  it('MIT includes copyright and permission', () => {
    const text = licenseText('MIT', { author: 'Bob', year: 2024 });
    assert.ok(text.includes('MIT License'));
    assert.ok(text.includes('Copyright (c) 2024 Bob'));
    assert.ok(text.includes('Permission is hereby granted'));
  });

  it('CC licenses include URL', () => {
    const text = licenseText('CC-BY-4.0', { author: 'C' });
    assert.ok(text.includes('creativecommons.org/licenses/by/4.0/'));
  });

  it('CC0 includes public domain', () => {
    const text = licenseText('CC0-1.0', { author: 'D' });
    assert.ok(text.includes('public domain'));
  });
});
