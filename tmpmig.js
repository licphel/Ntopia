// Migrate old.db → ntopia.db
// Skips Chinese-named users, migrates posts/comments to "技术交流" section

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const oldDB = new Database(path.join(__dirname, 'old.db'));
const newDB = new Database(path.join(__dirname, 'data', 'ntopia.db'));
newDB.pragma('foreign_keys = ON');

// ── Find target section ──────────────────────────────────────
const techSection = newDB.prepare("SELECT id FROM categories WHERE name = '技术交流'").get();
if (!techSection) { console.error('技术交流 section not found'); process.exit(1); }
console.log('Target: 技术交流 id=' + techSection.id);

// ── User migration ───────────────────────────────────────────
const oldUsers = oldDB.prepare("SELECT * FROM users WHERE username NOT IN ('依鸣','巫亓') ORDER BY id").all();
const userMap = {}; // old_id → new_id

for (const u of oldUsers) {
  // Skip if username already exists in new DB
  const exists = newDB.prepare('SELECT id FROM users WHERE username = ?').get(u.username);
  if (exists) { userMap[u.id] = exists.id; console.log('User skip (exists): ' + u.username); continue; }

  const info = newDB.prepare(`INSERT INTO users (username, password_hash, display_name, bio, avatar, role, xp, level, email, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    u.username, u.password_hash, u.display_name, u.bio || '', u.avatar || '/img/default-avatar.png',
    u.role || 1, u.xp || 0, u.level || 1, u.email || '', u.created_at
  );
  userMap[u.id] = info.lastInsertRowid;
  console.log('User: ' + u.username + ' → ' + info.lastInsertRowid);
}

// ── Post migration ───────────────────────────────────────────
const oldPosts = oldDB.prepare("SELECT * FROM posts WHERE is_draft = 0 AND is_deleted = 0 ORDER BY id").all();
const postMap = {}; // old_id → new_id

for (const p of oldPosts) {
  const newAuthorId = userMap[p.author_id];
  if (!newAuthorId) { console.log('Post skip (no author): ' + p.title); continue; }

  const info = newDB.prepare(`INSERT INTO posts (title, content_md, content_html, category_id, author_id, is_draft, is_deleted, view_count, created_at, updated_at)
    VALUES (?,?,?,?,?,0,0,?,?,?)`).run(
    p.title, p.content_md, p.content_html, techSection.id, newAuthorId,
    p.view_count || 0, p.created_at, p.updated_at || p.created_at
  );
  postMap[p.id] = info.lastInsertRowid;
  console.log('Post: ' + p.title.slice(0,40) + ' → ' + info.lastInsertRowid);
}

// ── Comment migration ────────────────────────────────────────
const oldComments = oldDB.prepare("SELECT * FROM comments WHERE is_deleted = 0 OR is_deleted IS NULL ORDER BY id").all();
let cmtCount = 0;
for (const c of oldComments) {
  const newPostId = postMap[c.post_id];
  const newAuthorId = userMap[c.author_id];
  if (!newPostId || !newAuthorId) continue;

  newDB.prepare(`INSERT INTO comments (post_id, author_id, content_md, content_html, parent_id, created_at)
    VALUES (?,?,?,?,?,?)`).run(
    newPostId, newAuthorId, c.content_md, c.content_html, null, c.created_at
  );
  cmtCount++;
}
console.log('Comments: ' + cmtCount);

console.log('\nDone. Users: ' + Object.keys(userMap).length + ', Posts: ' + Object.keys(postMap).length + ', Comments: ' + cmtCount);
