// Red-Black List — reads/writes evaluations from xlsx directly
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const XLSX_PATH = path.join(__dirname, '..', 'public', 'utils', 'rb', 'redblack.xlsx');
const LOCK_PATH = XLSX_PATH + '.lock';

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
          year: '-'
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

// Search evaluations
function search(query, field) {
  const data = loadCache();
  const q = query.toLowerCase();
  if (field === 'teacher') {
    return data.filter(e => e.teacher.toLowerCase().includes(q));
  } else if (field === 'course') {
    return data.filter(e => e.course_name.toLowerCase().includes(q) || e.course_code.toLowerCase().includes(q));
  }
  return data.filter(e =>
    e.teacher.toLowerCase().includes(q) ||
    e.course_name.toLowerCase().includes(q) ||
    e.course_code.toLowerCase().includes(q)
  );
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
