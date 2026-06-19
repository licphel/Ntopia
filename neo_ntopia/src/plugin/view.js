// EJS view engine plugin.
const path = require('path');

async function viewPlugin(fastify) {
  await fastify.register(require('@fastify/view'), {
    engine: { ejs: require('ejs') },
    root: path.join(__dirname, '..', '..', '..', 'views'),
    layout: 'layout',
    propertyName: 'view',
  });
}

module.exports = viewPlugin;
