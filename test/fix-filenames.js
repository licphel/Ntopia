// Fix double-encoded filenames in existing DB records
require('dotenv').config();
const { initDB, db } = require('../lib/db');
initDB({ migrateOnly: true });

function fixFilename(name) {
  if (!/[^\x00-\x7F]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (/[一-鿿]/.test(decoded)) return decoded;
  } catch (_) {}
  return name;
}

const rows = db.prepare('SELECT id, filename FROM attachments').all();
let fixed = 0;
for (const r of rows) {
  const newName = fixFilename(r.filename);
  if (newName !== r.filename) {
    db.prepare('UPDATE attachments SET filename = ? WHERE id = ?').run(newName, r.id);
    console.log(`#${r.id}: "${r.filename.slice(0,40)}" → "${newName.slice(0,40)}"`);
    fixed++;
  }
}
console.log(`Fixed ${fixed} of ${rows.length} records.`);
process.exit(0);
