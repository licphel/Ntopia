// Simple CSRF protection — token stored in session, validated on POST/PUT/DELETE
const crypto = require('crypto');

function generateToken(session) {
  if (!session._csrf) session._csrf = crypto.randomBytes(32).toString('hex');
  return session._csrf;
}

function csrfMiddleware(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const token = req.body._csrf || req.query._csrf || req.headers['x-csrf-token'];
    if (!token || token !== req.session._csrf) {
      return res.status(403).render('error', { title: '错误', code: 403, message: '请求无效', detail: 'CSRF 校验失败，请返回重试', back: '/' });
    }
  }
  next();
}

module.exports = { generateToken, csrfMiddleware };
