// Cloudflare R2 storage (S3-compatible)
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const config = require('./config');

function getClient() {
  if (!config.R2_ENDPOINT || !config.R2_ACCESS_KEY) return null;
  return new S3Client({
    region: 'auto',
    endpoint: config.R2_ENDPOINT,
    credentials: {
      accessKeyId: config.R2_ACCESS_KEY,
      secretAccessKey: config.R2_SECRET_KEY,
    },
    forcePathStyle: true,
  });
}

// Generate a unique key for R2
function r2Key(prefix, originalName) {
  const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase();
  return prefix + '/' + crypto.randomBytes(12).toString('hex') + ext;
}

// Is R2 configured?
function enabled() {
  return !!(config.R2_ENDPOINT && config.R2_ACCESS_KEY);
}

// Upload a buffer or stream to R2
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

// Delete from R2
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

// Generate a presigned download URL (valid 1 hour)
async function downloadUrl(key, filename) {
  const client = getClient();
  if (!client) return null;
  const cmd = new GetObjectCommand({
    Bucket: config.R2_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
    ResponseContentType: 'application/octet-stream',
  });
  return getSignedUrl(client, cmd, { expiresIn: 3600 });
}

module.exports = { enabled, upload, del, downloadUrl, r2Key };
