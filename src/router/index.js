// Route barrel.
function mountAll(app) {
  app.use('/posts', require('./comment'));
  app.use('/',        require('./post'));
  app.use('/auth',    require('./auth'));
  app.use('/users',   require('./user'));
  app.use('/',        require('./search'));
  app.use('/admin',   require('./admin'));
  app.use('/',        require('./social'));
  app.use('/settings', require('./settings'));
  app.use('/files',   require('./file'));
  app.use('/report',  require('./report'));
  app.use('/',        require('./feed'));
  app.use('/',        require('./page'));
  app.use('/',        require('./tools'));
  app.use('/',        require('./guestbook'));
}

module.exports = { mountAll };
