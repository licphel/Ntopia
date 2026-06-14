// Permission helpers — single source of truth

const LEVEL = { GUEST: 0, USER: 1, MOD: 16, ADMIN: 32, SUPER: 64, OWNER: 128 };

function role(user) { return (user && user.role) || 0; }
function id(user) { return (user && user.id) || 0; }

// Viewing permissions
function canViewDeletedPost(viewer, post) {
  if (!post || !post.is_deleted) return true;
  return id(viewer) === post.author_id || role(viewer) >= LEVEL.OWNER;
}

function canViewDeletedComment(viewer, comment, postAuthorId) {
  if (!comment || !comment.is_deleted) return true;
  return id(viewer) === comment.author_id || role(viewer) >= LEVEL.OWNER || id(viewer) === postAuthorId;
}

// Action permissions
function canPost(viewer) {
  return !!viewer && !viewer.banned && !!viewer.email;
}

function canEdit(viewer, post) {
  if (!viewer || !post) return false;
  return id(viewer) === post.author_id || role(viewer) > LEVEL.MOD;
}

function canDelete(viewer, post) {
  if (!viewer || !post) return false;
  return id(viewer) === post.author_id || role(viewer) > LEVEL.MOD;
}

function canDeleteComment(viewer, comment) {
  if (!viewer || !comment) return false;
  return id(viewer) === comment.author_id || role(viewer) > LEVEL.MOD;
}

function canManageUser(viewer, target) {
  if (!viewer || !target) return false;
  return role(viewer) > role(target);
}

function canAccessAdmin(viewer) {
  return role(viewer) >= LEVEL.ADMIN;
}

function canPurge(viewer) {
  return role(viewer) >= LEVEL.ADMIN;
}

// Viewing filter helpers
function postFilter(viewer) {
  if (role(viewer) >= LEVEL.OWNER) return '';
  return 'AND is_deleted = 0';
}

function commentFilter(viewer, postAuthorId) {
  if (role(viewer) >= LEVEL.OWNER) return '';
  return `AND c.is_deleted = 0`;
}

module.exports = { LEVEL, role, id, canViewDeletedPost, canViewDeletedComment, canPost, canEdit, canDelete, canDeleteComment, canManageUser, canAccessAdmin, canPurge, postFilter, commentFilter };
