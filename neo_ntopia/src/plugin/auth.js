// Auth decorators — mirror of lib/auth.js middleware, as Fastify preHandler functions.
const auth = require('../lib/auth');

async function authPlugin(fastify) {
  // Decorate fastify with guard functions that return Fastify preHandler arrays

  fastify.decorate('requireAuth', (request, reply, done) => {
    if (!request.user) return reply.redirect('/auth/login');
    done();
  });

  fastify.decorate('requireAuthAPI', (request, reply, done) => {
    if (!request.user) return reply.status(401).send({ ok: false, error: '请先登录' });
    done();
  });

  fastify.decorate('requireActive', (request, reply, done) => {
    if (!request.user) return reply.redirect('/auth/login');
    const user = require('../database').getDB().prepare('SELECT banned, email FROM users WHERE id = ?').get(request.user.id);
    if (!user || user.banned || !user.email) {
      return reply.status(403).view('error', {
        title: '错误', code: 403, message: '账号受限',
        detail: (user && user.banned) ? '你的账号已被管理员封禁' : '请前往设置页面绑定邮箱后再操作',
        back: '/',
      });
    }
    done();
  });

  fastify.decorate('requireRole', (level) => {
    return (request, reply, done) => {
      if (!auth.hasRole(request.user, level)) {
        return reply.status(403).view('error', {
          title: '错误', code: 403, message: '权限不足',
          detail: '需要更高权限', back: '/',
        });
      }
      done();
    };
  });
}

module.exports = authPlugin;
