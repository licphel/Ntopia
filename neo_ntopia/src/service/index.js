// Service barrel — all business logic modules in one place.
const auth = require('./auth');
const email = require('./email');
const moderation = require('./moderation');
const post = require('./post');
const comment = require('./comment');
const user = require('./user');
const social = require('./social');
const file = require('./file');
const r2 = require('./r2');
const admin = require('./admin');
const notification = require('./notification');

module.exports = {
  auth,
  email,
  moderation,
  post,
  comment,
  user,
  social,
  file,
  r2,
  admin,
  notification,
};
