// View data helpers — pure functions, no side effects.
// Routes call these to get data for template rendering.
// NOT middleware. The route decides what data the view needs.

const postRepo = require('../repo/post');

/** Sidebar data — owner info, recent posts, stats. */
function sidebarData() {
  try {
    const db = require('../database').getDB();
    return {
      admin: db.prepare('SELECT id, username, display_name, avatar, bio, role, level FROM users WHERE id = 1').get()
        || { username: 'admin', display_name: 'Administrator', avatar: '/img/default-avatar.png', bio: '' },
      recentPosts: postRepo.recentPosts(10),
      recentComments: postRepo.recentComments(10),
      stats: postRepo.stats(),
      infoPages: getInfoPages(),
      friendLinks: getFriendLinks(),
    };
  } catch (_) {
    return { admin: { id: 1, username: 'admin', display_name: 'Administrator', avatar: '/img/default-avatar.png', bio: '' }, recentPosts: [], recentComments: [], stats: {}, infoPages: [], friendLinks: [] };
  }
}

function getFriendLinks() {
  try {
    const fs = require('fs');
    const path = require('path');
    const LINKS_FILE = path.join(__dirname, '..', '..', 'public', 'friend-links.json');
    if (!fs.existsSync(LINKS_FILE)) return [];
    return JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
  } catch (_) { return []; }
}

function getInfoPages() {
  try {
    const fs = require('fs');
    const path = require('path');
    const PAGES_DIR = path.join(__dirname, '..', '..', 'public', 'pages');
    if (!fs.existsSync(PAGES_DIR)) return [];
    return fs.readdirSync(PAGES_DIR).filter(f => f.endsWith('.md')).map(f => {
      const raw = fs.readFileSync(path.join(PAGES_DIR, f), 'utf8');
      const slug = f.replace('.md', '');
      let title = slug;
      if (raw.startsWith('---')) {
        const end = raw.indexOf('---', 3);
        if (end > 0) { const m = raw.slice(3, end).match(/title:\s*(.+)/); if (m) title = m[1].trim(); }
      }
      return { title, slug, url: '/pages/' + slug };
    });
  } catch (_) { return []; }
}

module.exports = { sidebarData, getInfoPages };
