// Sort helpers — abstract sorting strategies for posts.
const SORT = { NEWEST: 'newest', HOT: 'hot', REPLIES: 'replies' };

function sortPosts(posts, order = 'newest', opts = {}) {
  const now = opts.now || new Date().toISOString().split('T')[0];
  switch (order) {
    case SORT.REPLIES:
      return [...posts].sort((a, b) => (b.comment_count || 0) - (a.comment_count || 0));
    case SORT.HOT:
      return [...posts].sort((a, b) => hotScore(b, now) - hotScore(a, now));
    default:
      return [...posts].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }
}

function hotScore(post, now) {
  const hours = Math.max(0, (new Date(now + 'T00:00:00Z') - new Date((post.created_at || '').replace(' ', 'T') + 'Z')) / 3600000) || 9999;
  return ((post.comment_count || 0) * 3.0 + (post.view_count || 0) * 0.1) / (hours + 4.0);
}

module.exports = { SORT, sortPosts };
