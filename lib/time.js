// Network-synced time utility
// Fetches time from HTTP Date headers on startup, applies offset to local clock.
// Falls back to local time if all sources fail.

const https = require('https');
const http = require('http');

// Reliable servers to query for Date header
const TIME_SOURCES = [
  { host: 'www.baidu.com', path: '/' },
  { host: 'www.google.com', path: '/' },
  { host: 'cloudflare.com', path: '/cdn-cgi/trace' },
  { host: 'www.microsoft.com', path: '/' },
];

let offsetMs = 0;        // networkTime - localTime
let synced = false;

function fetchTime(host, path) {
  return new Promise((resolve, reject) => {
    const mod = host === 'www.baidu.com' ? http : https;
    const req = mod.get({ host, path, timeout: 5000, headers: { 'User-Agent': 'Ntopia/1.0' } }, (res) => {
      const dateStr = res.headers.date;
      res.resume(); // discard body
      if (dateStr) {
        resolve(new Date(dateStr).getTime());
      } else {
        reject(new Error('No Date header'));
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function syncTime() {
  const localNow = Date.now();
  const results = [];

  for (const src of TIME_SOURCES) {
    try {
      const netTime = await fetchTime(src.host, src.path);
      results.push(netTime);
    } catch (e) {
      // source failed, try next
    }
  }

  if (results.length >= 2) {
    // Use median offset
    const offsets = results.map(t => t - localNow).sort((a, b) => a - b);
    const median = offsets[Math.floor(offsets.length / 2)];

    // Reject outliers (> 60 seconds from median)
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

// Call at startup
syncTime();

// Re-sync every 4 hours to correct drift
setInterval(syncTime, 4 * 60 * 60 * 1000).unref();

function now() {
  return new Date(Date.now() + offsetMs);
}

function toISO() {
  return now().toISOString();
}

function toISOString(date) {
  // Convert a Date (or local-time string) applying offset
  if (date instanceof Date) {
    return new Date(date.getTime() + offsetMs).toISOString();
  }
  return new Date(new Date(date).getTime() + offsetMs).toISOString();
}

function today() {
  return toISO().slice(0, 10);
}

function yesterday() {
  const d = now();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { now, toISO, toISOString, today, yesterday, offsetMs, synced };
