// Repository barrel — all data access modules in one place.
const userRepo = require('./user');
const postRepo = require('./post');
const commentRepo = require('./comment');
const messageRepo = require('./message');
const notificationRepo = require('./notification');
const { likeRepo, bookmarkRepo } = require('./like');
const followRepo = require('./follow');
const reportRepo = require('./report');
const attachmentRepo = require('./attachment');
const xpRepo = require('./xp');
const { categoryRepo, emailCodeRepo } = require('./category');
const subCategoryRepo = require('./sub_category');
const sectionFollowRepo = require('./section_follow');
const sectionSubModRepo = require('./section_sub_mod');
const guestbookRepo = require('./guestbook');

module.exports = {
  userRepo,
  postRepo,
  commentRepo,
  messageRepo,
  notificationRepo,
  likeRepo,
  bookmarkRepo,
  followRepo,
  reportRepo,
  attachmentRepo,
  xpRepo,
  categoryRepo,
  emailCodeRepo,
  subCategoryRepo,
  sectionFollowRepo,
  sectionSubModRepo,
  guestbookRepo,
};
