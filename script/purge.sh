#!/usr/bin/env bash
# Purge all soft-deleted content immediately. Usage: ./script/purge.sh -y
set -e
cd "$(dirname "$0")/.."

node -e "
const { initDB, getDB } = require('./src/database');
initDB();
const db = getDB();

const counts = {
  posts: db.prepare('SELECT COUNT(*) as c FROM posts WHERE is_deleted = 1').get().c,
  comments: db.prepare('SELECT COUNT(*) as c FROM comments WHERE is_deleted = 1').get().c,
  users: db.prepare('SELECT COUNT(*) as c FROM users WHERE deleted_at IS NOT NULL').get().c,
};
console.log('待清理: ' + counts.posts + ' 帖, ' + counts.comments + ' 评论, ' + counts.users + ' 用户');

if (counts.posts + counts.comments + counts.users === 0) {
  console.log('没有需要清理的内容。');
  process.exit(0);
}

if (process.argv.includes('-y') || process.argv.includes('--yes')) {
  db.exec(\`
    DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1);
    DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1);
    DELETE FROM reports WHERE type = 'post' AND target_id IN (SELECT id FROM posts WHERE is_deleted = 1);
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1));
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1));
    DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE is_deleted = 1);
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE is_deleted = 1);
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE is_deleted = 1);
    DELETE FROM comments WHERE parent_id IN (SELECT id FROM comments WHERE is_deleted = 1);
    DELETE FROM comments WHERE is_deleted = 1;
    DELETE FROM posts WHERE is_deleted = 1;

    DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM bookmarks WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM reports WHERE type = 'post' AND target_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM comments WHERE parent_id IN (SELECT id FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM comments WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM likes WHERE comment_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)));
    DELETE FROM reports WHERE type = 'comment' AND target_id IN (SELECT id FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)));
    DELETE FROM comments WHERE post_id IN (SELECT id FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL));
    DELETE FROM posts WHERE author_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM likes WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM bookmarks WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM follows WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL) OR follow_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM messages WHERE from_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL) OR to_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM checkins WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM xp_log WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM section_sub_mods WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM section_follows WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM login_logs WHERE user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM email_codes WHERE email IN (SELECT email FROM users WHERE deleted_at IS NOT NULL);
    DELETE FROM users WHERE deleted_at IS NOT NULL;
    DELETE FROM email_codes WHERE expires_at < datetime('now');
  \`);
  console.log('清理完成。');
} else {
  console.log('确认执行？运行: ./script/purge.sh -y');
  process.exit(1);
}
"
