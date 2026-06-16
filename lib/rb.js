// Red-Black List — reads/writes evaluations from xlsx directly
const XLSX = require('xlsx');
const { pinyin } = require('pinyin');
const path = require('path');
const fs = require('fs');

const XLSX_PATH = path.join(__dirname, '..', 'public', 'utils', 'rb', 'redblack.xlsx');
const LOCK_PATH = XLSX_PATH + '.lock';

// Pinyin helpers for fuzzy search
function toPinyin(text) {
  try {
    return pinyin(text, { style: 'normal' }).map(x => x[0]).join('');
  } catch (_) { return ''; }
}
function toPinyinInitials(text) {
  try {
    return pinyin(text, { style: 'first_letter' }).map(x => x[0]).join('');
  } catch (_) { return ''; }
}

// In-memory cache: { course_code, course_name, teacher, review, year }
let cache = null;
let cacheTime = 0;

function acquireLock() {
  // Simple file-based lock with retry
  const maxWait = 5000, interval = 50;
  const start = Date.now();
  while (fs.existsSync(LOCK_PATH)) {
    if (Date.now() - start > maxWait) throw new Error('Lock timeout');
    const t = Date.now();
    while (Date.now() - t < interval) { /* spin */ }
  }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
}

function parseSheet() {
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const results = [];
  let lastCode = '', lastName = '';

  for (let i = 3; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const code = (r[0] || '').toString().trim();
    const name = (r[1] || '').toString().trim();
    const teacher = (r[2] || '').toString().trim();

    // Skip section headers
    if (code.startsWith('↓') || code.startsWith('说明')) continue;
    if (!code && !teacher) continue;

    // Track last known course info for rows that inherit it
    if (code && !code.startsWith('↓')) { lastCode = code; lastName = name; }

    const effectiveCode = code || lastCode;
    const effectiveName = name || lastName;

    if (!teacher) continue;

    // Collect all review columns (index 3-25)
    for (let j = 3; j < r.length; j++) {
      const review = (r[j] || '').toString().trim();
      if (review && review.length > 0) {
        results.push({
          course_code: effectiveCode,
          course_name: effectiveName,
          teacher: teacher,
          review: review,
          year: '-',
          _py: toPinyin(teacher) + ' ' + toPinyinInitials(teacher) + ' ' +
               toPinyin(effectiveName) + ' ' + toPinyinInitials(effectiveName)
        });
      }
    }
  }
  return results;
}

function loadCache() {
  const now = Date.now();
  if (cache && now - cacheTime < 30 * 1000) return cache; // 30s TTL
  cache = parseSheet();
  cacheTime = now;
  return cache;
}

// Search evaluations (supports Chinese, pinyin, pinyin initials, fuzzy)
function search(query, field) {
  const data = loadCache();
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return [];

  function matches(e) {
    // Exact Chinese match
    if (e.teacher.includes(query) || e.course_name.includes(query) || e.course_code.includes(query)) return true;
    // Pinyin / initials match (no spaces)
    if (e._py && e._py.replace(/\s/g, '').includes(q)) return true;
    // Individual word matching (split query by whitespace)
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.every(w =>
        e.teacher.includes(w) || e.course_name.includes(w) || e.course_code.includes(w) ||
        (e._py && e._py.includes(w))
      );
    }
    return false;
  }

  if (field === 'teacher') {
    return data.filter(e => e.teacher.includes(query) || (e._py && e._py.includes(q)));
  } else if (field === 'course') {
    return data.filter(e => e.course_name.includes(query) || e.course_code.includes(query) || (e._py && e._py.includes(q)));
  }
  return data.filter(matches);
}

// Get all unique teachers
function getTeachers() {
  const data = loadCache();
  const seen = new Set();
  return data.filter(e => { const t = e.teacher; if (seen.has(t)) return false; seen.add(t); return true; })
    .map(e => ({ teacher: e.teacher, course_name: e.course_name }))
    .sort((a, b) => a.teacher.localeCompare(b.teacher, 'zh'));
}

// Add a new evaluation (appends to xlsx)
function addEvaluation(teacher, course_name, year, review) {
  acquireLock();
  try {
    const wb = XLSX.readFile(XLSX_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // Append new row: course_code='', course_name, teacher, review, empty for remaining review cols
    const newRow = ['', course_name, teacher, review];
    // Pad to match column count (26 columns)
    while (newRow.length < 26) newRow.push('');
    // Set year in a hidden way — prepend to review: "[2024] actual review"
    if (year && year !== '-') {
      newRow[3] = '[' + year + '] ' + review;
    }
    rows.push(newRow);

    // Write back
    const newWs = XLSX.utils.aoa_to_sheet(rows);
    // Copy column widths from original
    if (ws['!cols']) newWs['!cols'] = ws['!cols'];
    wb.Sheets[wb.SheetNames[0]] = newWs;
    XLSX.writeFile(wb, XLSX_PATH);

    // Invalidate cache
    cache = null;
    cacheTime = 0;
  } finally {
    releaseLock();
  }
}

module.exports = { search, getTeachers, addEvaluation, loadCache };
