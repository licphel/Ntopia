// Cloudflare R2 storage service (S3-compatible).
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const config = require('../config');

let _client = null;

function getClient() {
  if (!config.R2_ENDPOINT || !config.R2_ACCESS_KEY) return null;
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: config.R2_ENDPOINT,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY,
        secretAccessKey: config.R2_SECRET_KEY,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

function isEnabled() {
  return !!(config.R2_ENDPOINT && config.R2_ACCESS_KEY);
}

function makeKey(prefix, originalName) {
  const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
  return prefix + '/' + crypto.randomBytes(12).toString('hex') + ext;
}

async function upload(key, body, contentType) {
  const client = getClient();
  if (!client) throw new Error('R2 not configured');
  await client.send(new PutObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType || 'application/octet-stream',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return config.R2_PUBLIC_URL + '/' + key;
}

async function del(key) {
  const client = getClient();
  if (!client) return;
  try {
    await client.send(new DeleteObjectCommand({
      Bucket: config.R2_BUCKET,
      Key: key,
    }));
  } catch (e) {
    console.error('[r2] Delete error:', e.message);
  }
}

async function downloadUrl(key, filename) {
  const client = getClient();
  if (!client) return null;
  const latin1 = Buffer.from(filename, 'utf8').toString('latin1');
  const cmd = new GetObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${latin1}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    ResponseContentType: 'application/octet-stream',
  });
  return getSignedUrl(client, cmd, { expiresIn: 3600 });
}

module.exports = { isEnabled, makeKey, upload, del, downloadUrl };
