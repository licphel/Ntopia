// Attachment data access — file storage repository.
const { getDB } = require('../database');

const attachmentRepo = {
  /** List files in a virtual path with folder support. */
  listInPath(vpath, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const vpathEscaped = vpath === '/' ? '/' : vpath;
    const files = getDB().prepare(`
      SELECT a.*, u.username, u.display_name, u.role, u.level
      FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.virtual_path = ? AND a.filename != '.folder'
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all(vpathEscaped, limit, offset);
    const total = getDB().prepare(
      "SELECT COUNT(*) as c FROM attachments WHERE virtual_path = ? AND filename != '.folder'"
    ).get(vpathEscaped);
    return { files, total: total.c };
  },

  /** List sub-folders for a virtual path. */
  listFolders(vpath) {
    const prefix = vpath === '/' ? '/' : vpath + '/';
    const prefixLen = prefix.length;
    const seen = new Set();
    const folders = [];

    // Explicit .folder markers
    const markers = getDB().prepare(`
      SELECT DISTINCT virtual_path FROM attachments
      WHERE virtual_path LIKE ? AND filename = '.folder'
    `).all(prefix + '%');
    for (const m of markers) {
      const name = m.virtual_path.slice(prefixLen);
      const slash = name.indexOf('/');
      const dir = slash >= 0 ? name.slice(0, slash) : name;
      if (dir && !seen.has(dir)) { seen.add(dir); folders.push({ name: dir }); }
    }

    // Intermediate folders from deeper files
    const deepPaths = getDB().prepare(`
      SELECT DISTINCT virtual_path FROM attachments
      WHERE virtual_path LIKE ? AND filename != '.folder'
    `).all(prefix + '%');
    for (const p of deepPaths) {
      const sub = p.virtual_path.slice(prefixLen);
      const slash = sub.indexOf('/');
      if (slash >= 0) {
        const dir = sub.slice(0, slash);
        if (dir && !seen.has(dir)) { seen.add(dir); folders.push({ name: dir }); }
      }
    }

    return folders;
  },

  /** Search files by name. */
  search(query, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;
    const files = getDB().prepare(`
      SELECT a.*, u.username, u.display_name, u.role, u.level
      FROM attachments a JOIN users u ON a.user_id = u.id
      WHERE a.filename LIKE ? ORDER BY a.created_at DESC LIMIT ? OFFSET ?
    `).all('%' + query + '%', limit, offset);
    const total = getDB().prepare(
      'SELECT COUNT(*) as c FROM attachments WHERE filename LIKE ?'
    ).get('%' + query + '%');
    return { files, total: total.c };
  },

  /** Get all folder paths (for toolbar picker). */
  allFolderPaths() {
    const paths = getDB().prepare(
      "SELECT DISTINCT virtual_path FROM attachments WHERE virtual_path != '/' ORDER BY virtual_path"
    ).all();
    return ['/', ...paths.map(p => p.virtual_path)];
  },

  /** Check if a folder exists. */
  folderExists(vpath) {
    return !!getDB().prepare(
      'SELECT 1 FROM attachments WHERE virtual_path = ? AND filename = ?'
    ).get(vpath, '.folder');
  },

  /** Create a folder (sentinel record). */
  createFolder(userId, vpath) {
    getDB().prepare(`
      INSERT INTO attachments (user_id, filename, stored_name, virtual_path, file_size, mime_type)
      VALUES (?, '.folder', '', ?, 0, 'inode/directory')
    `).run(userId, vpath);
  },

  /** Insert a file record. */
  create({ userId, filename, storedName, virtualPath, fileSize, mimeType }) {
    getDB().prepare(`
      INSERT INTO attachments (user_id, filename, stored_name, virtual_path, file_size, mime_type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, filename, storedName, virtualPath || '/', fileSize, mimeType || '');
  },

  /** Find file by ID. */
  findById(id) {
    return getDB().prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  },

  /** Increment download count. */
  incrementDownload(id) {
    getDB().prepare(
      'UPDATE attachments SET download_count = download_count + 1 WHERE id = ?'
    ).run(id);
  },

  /** Delete a file record. */
  delete(id) {
    getDB().prepare('DELETE FROM attachments WHERE id = ?').run(id);
  },
};

module.exports = attachmentRepo;
