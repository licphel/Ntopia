#!/usr/bin/env node
// Full seed: 1000 posts + 私信 to admin + nested comments on 20 posts
require('dotenv').config();
const { initDB, db } = require('../lib/db');
const { renderMarkdown, slugify } = require('../lib/helpers');
initDB();

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

const categories = ['computer', 'math', 'nature', 'life', 'misc', 'forum'];
const titles = ['探索','分析','实践','思考','回顾','展望','漫谈','记录','总结','分享','学习','研究','对比','优化','构建','设计','实现','调试','重构','Python','JavaScript','Rust','Go','Linux','算法','数据结构','网络','数据库','编译器','机器学习','深度学习','自然语言','安全','加密','分布式','React','Vue','CSS','HTML','SQL','Redis','Docker','K8s','性能','并发','内存','调试器'];
const suffixes = ['笔记','心得','指南','入门','进阶','实战','原理','技巧','方案','之路','小记','思考','总结','探索'];
const bodies = [
  '这是一篇关于%s的深入探讨。\n\n## 概述\n\n本文将从多个角度分析%s的相关概念和应用场景。\n\n## 核心要点\n\n1. 理解基本概念\n2. 掌握核心原理\n3. 实践应用\n\n```python\ndef main():\n    print("Hello Ntopia!")\n```\n\n## 总结\n\n以上就是关于%s的主要内容。欢迎讨论。',
  '最近研究%s，记录一些想法。\n\n## 背景\n\n%s在业界已有不少应用。\n\n| 方案 | 优点 | 缺点 |\n|------|------|------|\n| A | 简单 | 扩展性差 |\n| B | 强大 | 复杂 |\n\n> 实践出真知。',
  '分享关于%s的实践经验。\n\n## 项目背景\n\n遇到%s相关问题，经过探索找到方案。\n\n1. 发现问题\n2. 分析原因\n3. 设计方案\n4. 实施验证\n\n$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$\n\n希望对大家有帮助。',
  '聊聊%s。\n\n%s是一个值得深入的方向。\n\n- 效率提升\n- 质量保证\n- 可维护性\n\n从基础开始，循序渐进。',
  '关于%s的思考。\n\n## 引子\n\n%s最近很热门，谈谈看法。\n\n1. **技术层面**：扎实的基础\n2. **工程层面**：注重实践迭代\n\n```rust\nfn main() {\n    println!("Hello!");\n}\n```\n\n技术道路没有终点。',
];
const commentTexts = [
  '好文章，学习了！', '写得很好，感谢分享。', '这个观点很有意思。',
  '补充：实际应用还需考虑性能问题。', '请问有参考推荐吗？', '受益匪浅，收藏了。',
  '关于这点有不同看法，可以进一步讨论吗？', '实践部分很好，期待更多。',
  '代码示例清晰，帮助很大。', '总结得不错。', 'Markdown排版漂亮。',
  '能详细讲讲第二步吗？', '同意，工具只是手段。', '提醒：最新版可能有breaking change。',
  '楼主辛苦了！', '能分享开发环境吗？', '有意思，mark一下。',
  '这个方向很有前景。', '对比表格清晰，一目了然。',
  '感谢，正好需要这个。', '补充一个参考链接供参考。',
  '之前遇到过类似问题，用另一种方案解决的。', '期待下一篇！',
  '写得通俗易懂，赞。', '请问可以转载吗？',
];

const senderNames = ['Tester', 'Bot', 'Reader', 'Visitor'];

console.log('Clearing old data...');
db.exec('DELETE FROM comments');
db.exec('DELETE FROM likes');
db.exec('DELETE FROM bookmarks');
db.exec('DELETE FROM post_revisions');
db.exec('DELETE FROM notifications');
db.exec('DELETE FROM messages');
db.exec('DELETE FROM posts');

// ── 1. Create 1000 posts ───────────────────────────────────────
console.log('Creating 1000 posts...');
const insertPost = db.prepare(`INSERT INTO posts (title, slug, content_md, content_html, excerpt, category, tags, author_id, is_draft, is_deleted, view_count, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, datetime('now', ?), datetime('now', ?))`);

const postIds = [];
for (let i = 0; i < 1000; i++) {
  const t1 = rand(titles), t2 = rand(titles), t3 = rand(titles);
  const title = `${t1}${t2}与${t3}${rand(suffixes)}`;
  const cat = rand(categories);
  const tag = rand(['Python', 'JavaScript', 'Rust', 'Linux', 'AI', 'Web', '安全', '数据库', '', '']);
  const body = rand(bodies).replace(/%s/g, () => rand(titles));
  const slug = slugify(title) + '-' + Date.now() + '-' + i;
  const html = renderMarkdown(body);
  const excerpt = body.replace(/[#*>`|_\-\n\[\]()]/g, '').slice(0, 120);
  const views = randInt(10, 5000);
  const offset = '-' + randInt(0, 90) + ' days';

  const info = insertPost.run(title, slug, body, html, excerpt, cat, tag, views, offset, offset);
  postIds.push(info.lastInsertRowid);
  if (i % 200 === 0) process.stdout.write(`  ${i}/1000...\n`);
}
console.log('  Posts: 1000 done.');

// ── Resolve test user IDs ──────────────────────────────────────
const bcrypt = require('bcryptjs');
const hash = bcrypt.hashSync('1111', 10);
const testUsers = [];
for (const name of ['t2', 't3', 't4', 't5']) {
  let u = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (!u) {
    db.prepare('INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, 1, ?)').run(name, hash, name, '1111@test.com');
    u = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  }
  testUsers.push(u.id);
}
const allAuthors = [1, ...testUsers]; // admin + test users
console.log('Authors: id=1 +', testUsers.join(','));

// ── 2. Send messages to admin ──────────────────────────────────
console.log('Sending messages to admin...');
const msgCount = randInt(30, 80);
const insertMsg = db.prepare(`INSERT INTO messages (from_id, to_id, content_md, content_html, created_at)
  VALUES (?, 1, ?, ?, datetime('now', ?))`);

for (let i = 0; i < msgCount; i++) {
  const text = rand(commentTexts);
  const html = renderMarkdown(text);
  const offset = '-' + randInt(0, 30) + ' days';
  const fromId = rand(allAuthors);
  insertMsg.run(fromId, text, html, offset);
}
console.log(`  Messages: ${msgCount} sent.`);

// ── 3. Comments on 20 random posts ─────────────────────────────
console.log('Creating comments...');
const cmtTargets = new Set();
while (cmtTargets.size < 20) cmtTargets.add(randInt(0, 999));

const insertCmt = db.prepare(`INSERT INTO comments (post_id, author_id, content_md, content_html, parent_id, created_at)
  VALUES (?, ?, ?, ?, ?, datetime('now', ?))`);

let totalCmts = 0;
let nestedCount = 0;
[...cmtTargets].sort((a,b)=>a-b).forEach(idx => {
  const postId = postIds[idx];
  const count = randInt(1, 100);
  const cmtIds = [];

  for (let c = 0; c < count; c++) {
    const text = rand(commentTexts);
    const html = renderMarkdown(text);
    const offset = '-' + randInt(0, 7) + ' days';
    const authorId = rand(allAuthors);

    let parentId = null;
    if (cmtIds.length > 0 && Math.random() < 0.3) {
      parentId = rand(cmtIds);
      nestedCount++;
    }

    const info = insertCmt.run(postId, authorId, text, html, parentId, offset);
    cmtIds.push(info.lastInsertRowid);
    totalCmts++;
  }
});
console.log(`  Comments: ${totalCmts} (${nestedCount} nested) on 20 posts.`);

console.log('\nDone!');
process.exit(0);
