import { Zip, ZipPassThrough } from './vendor/fflate.js';
import { normalizeArchivePath } from './zip.js';

/** Export selected files without interpreting filenames as JavaScript object keys. */
export function createSelectedZip(records, selectedPaths) {
  const files = new Map();
  for (const record of records) {
    if (typeof record?.path !== 'string' || !(record.bytes instanceof Uint8Array)) {
      throw new Error('保存するファイルのデータが正しくありません。');
    }
    const path = normalizeArchivePath(record.path);
    if (!path || record.path.endsWith('/') || record.path.endsWith('\\')) {
      throw new Error('保存するファイル名が正しくありません。');
    }
    if (files.has(path)) throw new Error('重複するファイル名があるため保存できません。');
    files.set(path, record.bytes);
  }

  const selected = new Set();
  for (const value of selectedPaths) {
    if (typeof value !== 'string') throw new Error('保存するファイルの選択が正しくありません。');
    const path = normalizeArchivePath(value);
    if (!files.has(path)) throw new Error('選択したファイルが見つかりません。');
    if (selected.has(path)) throw new Error('同じファイルが重複して選択されています。');
    selected.add(path);
  }
  if (!selected.size) throw new Error('保存するファイルを選んでください。');

  // Stored entries avoid expensive recompression on iPhone. Explicit entries also
  // preserve names such as "__proto__" that object-based ZIP APIs can mishandle.
  const chunks = [];
  let length = 0;
  const archive = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
    length += chunk.length;
  });
  for (const [path, bytes] of files) {
    if (!selected.has(path)) continue;
    const entry = new ZipPassThrough(path);
    archive.add(entry);
    entry.push(bytes, true);
  }
  archive.end();
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** A download is a single filename; its archive path is only kept inside ZIPs. */
export function downloadFileName(path) {
  const basename = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean).at(-1) || 'file';
  let name = basename.replace(/[<>:"|?*\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '_').replace(/[. ]+$/g, '');
  if (!name) name = 'file';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

export function packageFileName(originalName = 'files.zip') {
  const stem = downloadFileName(originalName).replace(/\.zip$/i, '').replace(/[. ]+$/g, '') || 'files';
  return `${stem}-selected.zip`;
}

/** Flattening paths for multi-file sharing must not overwrite equal basenames. */
export function uniqueDownloadNames(paths) {
  const names = Array.from(paths, downloadFileName);
  const key = name => name.normalize('NFC').toLowerCase();
  const reserved = new Set(names.map(key));
  const used = new Set();
  return names.map(name => {
    if (!used.has(key(name))) {
      used.add(key(name));
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    let candidate;
    let suffix = 2;
    do candidate = `${stem} (${suffix++})${extension}`;
    while (reserved.has(key(candidate)) || used.has(key(candidate)));
    used.add(key(candidate));
    return candidate;
  });
}
