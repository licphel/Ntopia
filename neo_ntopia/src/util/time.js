// Network-synced time utility with periodic re-sync.
const https = require('https');
const http = require('http');

const TIME_SOURCES = [
  { host: 'www.baidu.com',  path: '/' },
  { host: 'www.google.com', path: '/' },
  { host: 'cloudflare.com', path: '/cdn-cgi/trace' },
  { host: 'www.microsoft.com', path: '/' },
];

let offsetMs = 0;
let synced = false;

function fetchTime(host, path) {
  return new Promise((resolve, reject) => {
    const mod = host === 'www.baidu.com' ? http : https;
    const req = mod.get(
      { host, path, timeout: 5000, headers: { 'User-Agent': 'Ntopia/2.0' } },
      (res) => {
        const dateStr = res.headers.date;
        res.resume();
        if (dateStr) resolve(new Date(dateStr).getTime());
        else reject(new Error('No Date header'));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function syncTime() {
  const localNow = Date.now();
  const results = [];

  for (const src of TIME_SOURCES) {
    try { results.push(await fetchTime(src.host, src.path)); } catch (_) {}
  }

  if (results.length >= 2) {
    const offsets = results.map(t => t - localNow).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)];
    const filtered = offsets.filter(o => Math.abs(o - median) < 60000);
    if (filtered.length > 0) {
      offsetMs = Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length);
      synced = true;
      console.log(`[time] Synced: offset=${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s from ${results.length} sources`);
      return;
    }
  }

  if (results.length === 1) {
    offsetMs = results[0] - localNow;
    synced = true;
    console.log(`[time] Synced from single source: offset=${(offsetMs / 1000).toFixed(1)}s`);
    return;
  }

  console.log('[time] Failed to sync, using local clock');
}

// Sync at startup
syncTime();

// Re-sync every 4 hours
setInterval(syncTime, 4 * 60 * 60 * 1000).unref();

function now() {
  return new Date(Date.now() + offsetMs);
}

function toISO() {
  return now().toISOString();
}

function today() {
  return toISO().slice(0, 10);
}

function yesterday() {
  const d = now();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function toSQL(date) {
  let d;
  if (date instanceof Date) d = date;
  else if (typeof date === 'number') d = new Date(date);
  else d = now();
  return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

function sqlFromNow(mod) {
  const m = mod.match(/^([+-])\s*(\d+)\s*(second|minute|hour|day)s?$/);
  if (!m) return toSQL();
  let ms = parseInt(m[2], 10) * 1000;
  const unit = m[3];
  if (unit === 'minute') ms *= 60;
  else if (unit === 'hour') ms *= 3600;
  else if (unit === 'day') ms *= 86400;
  return toSQL(new Date(Date.now() + offsetMs + (m[1] === '+' ? ms : -ms)));
}

function timeTag(sqlDate, opts) {
  if (!sqlDate) return '';
  const iso = sqlDate.replace(' ', 'T') + 'Z';
  const fmt = (opts && opts.fmt) || 'datetime';
  const d = new Date(iso);
  let fallback = iso.slice(0, 16).replace('T', ' ');
  if (fmt === 'date') fallback = iso.slice(0, 10);
  else if (fmt === 'day') fallback = d.getUTCDate();
  else if (fmt === 'month') fallback = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  else if (fmt === 'short') fallback = iso.slice(5, 16).replace('T', ' ');
  else if (fmt === 'year') fallback = d.getUTCFullYear();
  const cls = (opts && opts.cls) || 'local-time';
  return `<time class="${cls}" datetime="${iso}" data-fmt="${fmt}">${fallback}</time>`;
}

module.exports = { now, toISO, today, yesterday, toSQL, sqlFromNow, syncTime, timeTag, offsetMs, synced };
