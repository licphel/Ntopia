// Sort helpers — abstract sorting strategies for posts.
// Usage: sortedPosts = sortOrder(posts, 'hot', { now: '2024-01-01' })

const SORT = {
  NEWEST:  'newest',
  HOT:     'hot',
  REPLIES: 'replies',
};

/** Sort an array of post objects by the given order. */
function sortPosts(posts, order = 'newest', opts = {}) {
  const now = opts.now || new Date().toISOString().split('T')[0];

  switch (order) {
    case SORT.REPLIES:
      return [...posts].sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
    case SORT.HOT:
      return [...posts].sort((a, b) => {
        const scoreA = hotScore(a, now);
        const scoreB = hotScore(b, now);
        return scoreB - scoreA;
      });
    case SORT.NEWEST:
    default:
      return [...posts].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
}

/** Hacker News-style hot score: (replies * 3 + views * 0.1) / (hours_since_post + 4) */
function hotScore(post, now) {
  const hours = hoursSince(post.created_at, now);
  const comments = post.comment_count || 0;
  const views = post.view_count || 0;
  return (comments * 3.0 + views * 0.1) / (hours + 4.0);
}

function hoursSince(dateStr, nowStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr.replace(' ', 'T') + 'Z');
  const n = new Date(nowStr + 'T00:00:00Z');
  return Math.max(0, (n - d) / 3600000);
}

module.exports = { SORT, sortPosts, hotScore };
