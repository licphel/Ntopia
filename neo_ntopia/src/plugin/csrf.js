// CSRF protection plugin.
const crypto = require('crypto');

async function csrfPlugin(fastify) {
  fastify.decorate('generateCSRF', (session) => {
    if (!session._csrf) session._csrf = crypto.randomBytes(32).toString('hex');
    return session._csrf;
  });

  fastify.decorateRequest('csrf', '');

  fastify.addHook('preHandler', (request, reply, done) => {
    request.csrf = fastify.generateCSRF(request.session);
    reply.locals = reply.locals || {};
    reply.locals.csrf = request.csrf;

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      const token = (request.body || {})._csrf || request.headers['x-csrf-token'];
      if (!token || token !== request.session._csrf) {
        return reply.status(403).view('error', {
          title: '错误', code: 403, message: '请求无效',
          detail: 'CSRF 校验失败，请返回重试', back: '/',
        });
      }
      // Only log non-GET CSRF-triggering mutations if needed
    }
    done();
  });
}

module.exports = csrfPlugin;
