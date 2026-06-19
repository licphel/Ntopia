// File service — image uploads, attachments, R2 storage.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const config = require('../config');
const { attachmentRepo } = require('../repo');
const r2 = require('./r2');

/** Safe attachment extensions — no executables. */
const SAFE_EXT = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml', 'toml',
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz',
  'py', 'js', 'ts', 'html', 'css', 'c', 'cpp', 'h', 'rs', 'go', 'java', 'rb',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp3', 'mp4', 'wav', 'ogg', 'webm',
]);

/** Fix double-encoded filenames from browser multipart uploads. */
function fixFilename(name) {
  if (!/[^\x00-\x7F]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (/[一-鿿぀-ゟ゠-ヿ]/.test(decoded)) return decoded;
  } catch (_) {}
  return name;
}

/** Content-Disposition header with UTF-8 filename. */
function contentDisposition(filename) {
  const latin1 = Buffer.from(filename, 'utf8').toString('latin1');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${latin1}"; filename*=UTF-8''${encoded}`;
}

/** Generate random stored filename. */
function storedName(ext) {
  return crypto.randomBytes(12).toString('hex') + ext;
}

const fileService = {
  SAFE_EXT,
  fixFilename,
  contentDisposition,
  storedName,

  /** Validate image extension/MIME for uploads. */
  validateImage(ext, mimeType) {
    return config.ALLOWED_IMAGE_MIME.includes(mimeType) &&
           config.ALLOWED_IMAGE_EXT.includes(ext);
  },

  /** Validate attachment extension. */
  validateAttachment(ext) {
    return SAFE_EXT.has(ext.slice(1).toLowerCase());
  },

  /** Process uploaded image: resize, convert to webp, upload to R2 or save local. */
  async processImage(inputPath, originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const outName = storedName('.webp');
    const outPath = path.join(config.UPLOADS_DIR, outName);

    await sharp(inputPath)
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .withMetadata({ exif: {} })
      .toFile(outPath);

    // Clean up original
    if (inputPath !== outPath) {
      try { fs.unlinkSync(inputPath); } catch (_) {}
    }

    if (r2.isEnabled()) {
      const buf = fs.readFileSync(outPath);
      const key = r2.makeKey('img', outName);
      const url = await r2.upload(key, buf, 'image/webp');
      try { fs.unlinkSync(outPath); } catch (_) {}
      return { ok: true, url };
    }

    return { ok: true, url: '/uploads/' + outName };
  },

  /** Process avatar: center-crop to square, resize to 256x256. */
  async processAvatar(inputPath, userId) {
    // Check not GIF
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === '.gif') {
      try { fs.unlinkSync(inputPath); } catch (_) {}
      return { ok: false, error: '头像不支持 GIF，请上传 JPG/PNG/WebP' };
    }

    try {
      const meta = await sharp(inputPath).metadata();
      const side = Math.min(meta.width, meta.height);
      const left = Math.floor((meta.width - side) / 2);
      const top = Math.floor((meta.height - side) / 2);

      const outBuf = await sharp(inputPath)
        .extract({ left, top, width: side, height: side })
        .resize(256, 256)
        .webp({ quality: 85 })
        .toBuffer();

      try { fs.unlinkSync(inputPath); } catch (_) {}

      let url;
      if (r2.isEnabled()) {
        const key = r2.makeKey('avatar', `avatar-${userId}.webp`);
        url = await r2.upload(key, outBuf, 'image/webp');
      } else {
        const outName = `avatar-${userId}.webp`;
        const outPath = path.join(config.UPLOADS_DIR, outName);
        fs.writeFileSync(outPath, outBuf);
        url = '/uploads/' + outName + '?v=' + Date.now();
      }

      return { ok: true, url };
    } catch (e) {
      console.error('Avatar process error:', e.message);
      try { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); } catch (_) {}
      return { ok: false, error: '图片处理失败，请尝试其他图片' };
    }
  },

  /** Store an attachment (local or R2). */
  async storeAttachment(file, vpath, userId) {
    const filename = fixFilename(file.originalname);
    const vpathClean = (vpath || '/').replace(/\.\./g, '').replace(/\/+/g, '/');
    let stored, fileSize;

    if (r2.isEnabled()) {
      const key = r2.makeKey('files', file.originalname);
      try {
        await r2.upload(key, file.buffer, file.mimetype);
      } catch (e) {
        console.error('[files] R2 upload error:', e.message);
        return { ok: false, error: '上传失败，请重试' };
      }
      stored = key;
      fileSize = file.buffer.length;
    } else {
      const ext = path.extname(file.originalname).toLowerCase();
      stored = storedName(ext);
      const dest = path.join(config.ATTACHMENTS_DIR, stored);
      if (file.buffer) {
        fs.writeFileSync(dest, file.buffer);
      } else if (file.path) {
        fs.copyFileSync(file.path, dest);
        try { fs.unlinkSync(file.path); } catch (_) {}
      }
      fileSize = file.size || (fs.existsSync(dest) ? fs.statSync(dest).size : 0);
    }

    attachmentRepo.create({
      userId, filename,
      storedName: stored,
      virtualPath: vpathClean,
      fileSize,
      mimeType: file.mimetype || '',
    });

    return { ok: true, filename, id: attachmentRepo.findLastId ? null : null };
  },

  /** List attachments in a path. */
  listAttachments(vpath, query, page) {
    const p = Math.max(1, page || 1);
    const limit = config.ATTACHMENT_PAGE_SIZE;

    if (query) {
      const result = attachmentRepo.search(query, { page: p, limit });
      return { ...result, folders: [], query, vpath };
    }

    const folders = attachmentRepo.listFolders(vpath || '/');
    const result = attachmentRepo.listInPath(vpath || '/', { page: p, limit });

    return { ...result, folders, query: '', vpath };
  },

  /** Get all folder paths. */
  allFolders() {
    return attachmentRepo.allFolderPaths();
  },

  /** Create a folder. */
  createFolder(userId, parent, name) {
    const cleanParent = (parent || '/').replace(/\/+/g, '/');
    const cleanName = (name || '').replace(/[/\\]/g, '').trim();
    if (!cleanName) return { ok: false, error: '请输入文件夹名' };

    const fullPath = cleanParent === '/' ? '/' + cleanName : cleanParent + '/' + cleanName;
    if (attachmentRepo.folderExists(fullPath)) return { ok: false, error: '文件夹已存在' };

    attachmentRepo.createFolder(userId, fullPath);
    return { ok: true, path: fullPath };
  },

  /** Download an attachment — get file info and increment counter. */
  getDownload(id) {
    const file = attachmentRepo.findById(id);
    if (!file) return null;
    attachmentRepo.incrementDownload(id);

    if (r2.isEnabled()) {
      return { file, redirect: true };
    }

    const filePath = path.join(config.ATTACHMENTS_DIR, file.stored_name);
    if (!fs.existsSync(filePath)) return null;
    return { file, localPath: filePath };
  },

  /** Get a presigned download URL from R2. */
  async getR2DownloadUrl(file) {
    return r2.downloadUrl(file.stored_name, file.filename);
  },

  /** Delete an attachment. */
  async deleteAttachment(id, user) {
    const file = attachmentRepo.findById(id);
    if (!file) return { ok: false, error: '文件不存在' };
    const auth = require('../lib/auth');
    if (!auth.isOwner(user, file) && !auth.canAccessAdmin(user)) {
      return { ok: false, error: '权限不足' };
    }

    if (r2.isEnabled()) {
      await r2.del(file.stored_name);
    } else {
      try {
        fs.unlinkSync(path.join(config.ATTACHMENTS_DIR, file.stored_name));
      } catch (_) {}
    }

    attachmentRepo.delete(id);
    return { ok: true };
  },
};

module.exports = fileService;
