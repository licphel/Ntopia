// Time utility tests.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const time = require('../src/util/time');

describe('time — toSQL', () => {
  it('returns SQL datetime format', () => {
    const sql = time.toSQL();
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sql));
  });

  it('returns correct format for a given date', () => {
    const d = new Date('2024-06-15T12:30:00Z');
    const sql = time.toSQL(d);
    assert.strictEqual(sql.slice(0, 10), '2024-06-15');
  });
});

describe('time — today', () => {
  it('returns YYYY-MM-DD', () => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(time.today()));
  });
});

describe('time — sqlFromNow', () => {
  it('parses "+1 hour"', () => {
    const sql = time.sqlFromNow('+1 hour');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sql));
  });

  it('parses "-60 days"', () => {
    const sql = time.sqlFromNow('-60 days');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sql));
  });

  it('parses "+5 minutes"', () => {
    const sql = time.sqlFromNow('+5 minutes');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sql));
  });

  it('returns now for invalid modifier', () => {
    const sql = time.sqlFromNow('garbage');
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sql));
  });
});

describe('time — timeTag', () => {
  it('renders time element', () => {
    const tag = time.timeTag('2024-06-15 12:30:00');
    assert.ok(tag.startsWith('<time'));
    assert.ok(tag.includes('datetime='));
    assert.ok(tag.includes('2024-06-15T12:30:00Z'));
  });

  it('handles null', () => {
    assert.strictEqual(time.timeTag(null), '');
  });

  it('accepts format option', () => {
    const tag = time.timeTag('2024-06-15 12:30:00', { fmt: 'date' });
    assert.ok(tag.includes('data-fmt="date"'));
  });
});
