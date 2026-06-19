// Upload + Preview plugin — registered after auth decorators are available.
const path = require('path');
const config = require('../config');
const multer = require('multer');

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: config.UPLOADS_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname)),
  }),
  limits: { fileSize: config.MAX_IMAGE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ok = config.ALLOWED_IMAGE_MIME.includes(file.mimetype) && config.ALLOWED_IMAGE_EXT.includes(ext);
    cb(ok ? null : new Error('仅允许 JPG/PNG/WebP'), ok);
  },
});

async function uploadPlugin(fastify) {
  fastify.post('/upload', { preHandler: [fastify.requireAuth] }, async (request, reply) => {
    const file = await new Promise((resolve, reject) => {
      imageUpload.single('file')(request.raw, reply.raw, (err) => err ? reject(err) : resolve(request.raw.file));
    });
    if (!file) return reply.status(400).send({ error: 'No file' });
    const { fileService } = require('../service/file');
    const result = await fileService.processImage(file.path, file.originalname);
    return reply.send(result);
  });

  fastify.post('/preview', { preHandler: [fastify.requireAuth] }, (request, reply) => {
    const { renderMarkdown } = require('../util/markdown');
    return reply.send({ html: renderMarkdown(request.body.content || '') });
  });
}

module.exports = uploadPlugin;
