// Comprehensive auth library tests — every predicate, middleware, and role operation.
const { describe, it } = require('node:test');
const assert = require('node:assert');

const auth = require('../src/lib/auth');

// Test user fixtures
const guest = null;
const activeUser = { id: 2, username: 'alice', role: auth.LEVEL.USER,  banned: 0, email: 'a@b.com' };
const bannedUser  = { id: 3, username: 'bob',   role: auth.LEVEL.USER,  banned: 1, email: 'b@b.com' };
const noEmailUser = { id: 4, username: 'carol', role: auth.LEVEL.USER,  banned: 0, email: '' };
const modUser     = { id: 5, username: 'moddy', role: auth.LEVEL.MOD,   banned: 0, email: 'm@b.com' };
const adminUser   = { id: 6, username: 'admin', role: auth.LEVEL.ADMIN, banned: 0, email: 'a@b.com' };
const superUser   = { id: 7, username: 'super', role: auth.LEVEL.SUPER, banned: 0, email: 's@b.com' };
const ownerUser   = { id: 8, username: 'owner', role: auth.LEVEL.OWNER, banned: 0, email: 'o@b.com' };

// Content fixtures
const postByAlice  = { id: 1, author_id: 2, title: 'Hello', is_deleted: 0 };
const postDeleted   = { id: 2, author_id: 2, title: 'Gone',  is_deleted: 1 };
const commentByAlice = { id: 1, author_id: 2, content_md: 'hi' };

describe('auth — role constants', () => {
  it('LEVEL values are powers of 2', () => {
    const L = auth.LEVEL;
    assert.strictEqual(L.GUEST, 0);
    assert.strictEqual(L.USER,  1);
    assert.strictEqual(L.MOD,   16);
    assert.strictEqual(L.ADMIN, 32);
    assert.strictEqual(L.SUPER, 64);
    assert.strictEqual(L.OWNER, 128);
  });

  it('ROLE_STEPS is ordered correctly', () => {
    assert.deepStrictEqual(auth.ROLE_STEPS, [1, 16, 32, 64, 128]);
  });
});

describe('auth — isAuthenticated', () => {
  it('returns false for null/undefined', () => {
    assert.strictEqual(auth.isAuthenticated(null), false);
    assert.strictEqual(auth.isAuthenticated(undefined), false);
  });
  it('returns false for empty object', () => {
    assert.strictEqual(auth.isAuthenticated({}), false);
  });
  it('returns true for user with id', () => {
    assert.strictEqual(auth.isAuthenticated(activeUser), true);
  });
});

describe('auth — hasRole', () => {
  it('user has USER role',    () => assert.strictEqual(auth.hasRole(activeUser, auth.LEVEL.USER), true));
  it('user lacks MOD role',   () => assert.strictEqual(auth.hasRole(activeUser, auth.LEVEL.MOD), false));
  it('mod has MOD role',      () => assert.strictEqual(auth.hasRole(modUser, auth.LEVEL.MOD), true));
  it('mod has USER role',     () => assert.strictEqual(auth.hasRole(modUser, auth.LEVEL.USER), true));
  it('owner has OWNER role',  () => assert.strictEqual(auth.hasRole(ownerUser, auth.LEVEL.OWNER), true));
  it('guest fails all',       () => assert.ok(!auth.hasRole(guest, auth.LEVEL.USER)));
});

describe('auth — outranks', () => {
  it('admin outranks user',    () => assert.strictEqual(auth.outranks(adminUser, activeUser), true));
  it('mod outranks user',      () => assert.strictEqual(auth.outranks(modUser, activeUser), true));
  it('user does not outrank user', () => assert.strictEqual(auth.outranks(activeUser, activeUser), false));
  it('user does not outrank mod',  () => assert.strictEqual(auth.outranks(activeUser, modUser), false));
  it('owner outranks admin',   () => assert.strictEqual(auth.outranks(ownerUser, adminUser), true));
  it('admin does not outrank super', () => assert.strictEqual(auth.outranks(adminUser, superUser), false));
});

describe('auth — isActive', () => {
  it('active user is active',    () => assert.strictEqual(auth.isActive(activeUser), true));
  it('banned user is not active', () => assert.strictEqual(auth.isActive(bannedUser), false));
  it('no-email user is not active', () => assert.strictEqual(auth.isActive(noEmailUser), false));
  it('guest is not active',      () => assert.strictEqual(auth.isActive(guest), false));
});

describe('auth — isOwner', () => {
  it('author owns their post', () => assert.strictEqual(auth.isOwner(activeUser, postByAlice), true));
  it('other user does not own post', () => assert.strictEqual(auth.isOwner(modUser, postByAlice), false));
  it('guest does not own anything',  () => assert.strictEqual(auth.isOwner(guest, postByAlice), false));
  it('null content handled',    () => assert.strictEqual(auth.isOwner(activeUser, null), false));
});

describe('auth — canEditPost', () => {
  it('author can edit own post',   () => assert.strictEqual(auth.canEditPost(activeUser, postByAlice), true));
  it('mod can edit any post',      () => assert.strictEqual(auth.canEditPost(modUser, postByAlice), true));
  it('admin can edit any post',    () => assert.strictEqual(auth.canEditPost(adminUser, postByAlice), true));
  it('other user cannot edit',     () => assert.strictEqual(auth.canEditPost(noEmailUser, postByAlice), false));
  it('guest cannot edit',         () => assert.strictEqual(auth.canEditPost(guest, postByAlice), false));
});

describe('auth — canDeletePost (same as canEditPost)', () => {
  it('author can delete', () => assert.strictEqual(auth.canDeletePost(activeUser, postByAlice), true));
  it('mod can delete',    () => assert.strictEqual(auth.canDeletePost(modUser, postByAlice), true));
});

describe('auth — canDeleteComment', () => {
  it('author can delete own comment', () => assert.strictEqual(auth.canDeleteComment(activeUser, commentByAlice), true));
  it('mod can delete any comment',    () => assert.strictEqual(auth.canDeleteComment(modUser, commentByAlice), true));
  it('other user cannot delete',      () => assert.strictEqual(auth.canDeleteComment(noEmailUser, commentByAlice), false));
});

describe('auth — canAccessAdmin', () => {
  it('admin can access',  () => assert.strictEqual(auth.canAccessAdmin(adminUser), true));
  it('super can access',  () => assert.strictEqual(auth.canAccessAdmin(superUser), true));
  it('owner can access',  () => assert.strictEqual(auth.canAccessAdmin(ownerUser), true));
  it('mod cannot access', () => assert.strictEqual(auth.canAccessAdmin(modUser), false));
  it('user cannot access',() => assert.strictEqual(auth.canAccessAdmin(activeUser), false));
});

describe('auth — canPurge (same as canAccessAdmin)', () => {
  it('admin can purge',   () => assert.strictEqual(auth.canPurge(adminUser), true));
  it('user cannot purge', () => assert.strictEqual(auth.canPurge(activeUser), false));
});

describe('auth — canViewDeleted', () => {
  it('owner can view deleted',  () => assert.strictEqual(auth.canViewDeleted(ownerUser), true));
  it('admin cannot view deleted', () => assert.strictEqual(auth.canViewDeleted(adminUser), false));
  it('mod cannot view deleted',  () => assert.strictEqual(auth.canViewDeleted(modUser), false));
  it('user cannot view deleted', () => assert.strictEqual(auth.canViewDeleted(activeUser), false));
});

describe('auth — canModerate', () => {
  it('mod can moderate',     () => assert.strictEqual(auth.canModerate(modUser), true));
  it('admin can moderate',   () => assert.strictEqual(auth.canModerate(adminUser), true));
  it('user cannot moderate', () => assert.strictEqual(auth.canModerate(activeUser), false));
});

describe('auth — canManageUser', () => {
  const targetUser = { id: 10, username: 'target', role: auth.LEVEL.USER, deleted_at: null };
  it('admin can manage user',    () => assert.strictEqual(auth.canManageUser(adminUser, targetUser), true));
  it('mod cannot manage user',   () => assert.strictEqual(auth.canManageUser(modUser, targetUser), false));
  it('user cannot manage user',  () => assert.strictEqual(auth.canManageUser(activeUser, targetUser), false));
  it('cannot manage same level', () => assert.strictEqual(auth.canManageUser(adminUser, { id: 11, role: auth.LEVEL.ADMIN }), false));
  it('cannot manage higher',     () => assert.strictEqual(auth.canManageUser(adminUser, { id: 12, role: auth.LEVEL.SUPER }), false));
});

describe('auth — canBanUser', () => {
  it('can ban lower user', () => assert.strictEqual(auth.canBanUser(adminUser, { id: 10, role: 1 }), true));
  it('cannot ban self',     () => assert.strictEqual(auth.canBanUser(adminUser, { id: 6, role: 32 }), false));
  it('cannot ban higher',   () => assert.strictEqual(auth.canBanUser(adminUser, { id: 7, role: 64 }), false));
});

describe('auth — canDeleteUser', () => {
  const target = { id: 10, username: 'target', role: auth.LEVEL.USER, deleted_at: null };
  const deleted = { id: 11, username: 'gone', role: auth.LEVEL.USER, deleted_at: '2024-01-01' };
  it('can delete active user',  () => assert.strictEqual(auth.canDeleteUser(adminUser, target), true));
  it('cannot delete already-deleted', () => assert.strictEqual(auth.canDeleteUser(adminUser, deleted), false));
});

describe('auth — nextPromotion', () => {
  it('promotes user to mod under admin', () => assert.strictEqual(auth.nextPromotion(adminUser, { id: 10, role: 1 }), 16));
  it('promotes mod to admin under super', () => assert.strictEqual(auth.nextPromotion(superUser, { id: 10, role: 16 }), 32));
  it('returns null when no step possible', () => assert.strictEqual(auth.nextPromotion(adminUser, { id: 10, role: 32 }), null));
  it('returns null when not authorized', () => assert.strictEqual(auth.nextPromotion(modUser, { id: 10, role: 1 }), null));
});

describe('auth — nextDemotion', () => {
  it('demotes mod to user', () => assert.strictEqual(auth.nextDemotion(adminUser, { id: 10, role: 16 }), 1));
  it('demotes admin to mod', () => assert.strictEqual(auth.nextDemotion(superUser, { id: 10, role: 32 }), 16));
  it('user is lowest', () => assert.strictEqual(auth.nextDemotion(adminUser, { id: 10, role: 1 }), null));
});

describe('auth — roleBadge', () => {
  it('guest/user badge', () => {
    const b = auth.roleBadge(1);
    assert.strictEqual(b.text, 'User');
  });
  it('mod badge', () => {
    assert.strictEqual(auth.roleBadge(16).text, 'Mod');
  });
  it('admin badge', () => {
    assert.strictEqual(auth.roleBadge(32).text, 'Admin');
  });
  it('super badge', () => {
    assert.strictEqual(auth.roleBadge(64).text, 'Super');
  });
  it('owner badge', () => {
    assert.strictEqual(auth.roleBadge(128).text, 'Owner');
  });
});

describe('auth — sessionUserFromDB', () => {
  it('builds session user from DB row', () => {
    const dbUser = { id: 1, username: 'test', display_name: 'Test', role: 1, avatar: '/img/x.png', xp: 10, level: 2, email: 'a@b.com' };
    const su = auth.sessionUserFromDB(dbUser);
    assert.strictEqual(su.id, 1);
    assert.strictEqual(su.username, 'test');
    assert.strictEqual(su.role, 1);
    assert.strictEqual(su.xp, 10);
    assert.strictEqual(su.level, 2);
    assert.strictEqual(su.needsEmail, false);
  });
  it('marks needsEmail when empty', () => {
    const su = auth.sessionUserFromDB({ id: 1, role: 1, email: '' });
    assert.strictEqual(su.needsEmail, true);
  });
  it('returns null for null input', () => {
    assert.strictEqual(auth.sessionUserFromDB(null), null);
  });
});

describe('auth — middleware requireRole returns function', () => {
  it('returns a function', () => {
    const mw = auth.requireRole(auth.LEVEL.ADMIN);
    assert.strictEqual(typeof mw, 'function');
  });
});
