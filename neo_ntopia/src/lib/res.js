// API response helpers — for routes that return JSON.
function ok(data) { return { ok: true, ...data }; }
function err(msg, code) { return { ok: false, error: msg, code: code || 400 }; }
function redirect(url) { return { ok: true, redirect: url }; }
module.exports = { ok, err, redirect };
