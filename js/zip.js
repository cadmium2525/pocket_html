import { inflateSync } from './vendor/fflate.js';

export const IMPORT_LIMITS = Object.freeze({ bytes: 32 * 1024 * 1024, files: 600 });

/** ZIP names are virtual paths, never filesystem paths. Reject ambiguous paths. */
export function normalizeArchivePath(name) {
  const path = String(name).replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:/i.test(path) || path.includes('\0')) {
    throw new Error('ZIP内に安全に扱えないファイル名があります。');
  }
  const parts = path.split('/');
  if (parts.some(part => part === '..')) throw new Error('ZIP内の「..」を含むパスは開けません。');
  return parts.filter(part => part && part !== '.').join('/');
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Preflight the central directory before allocating any decompressed buffers. */
export function inspectZip(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > IMPORT_LIMITS.bytes) {
    throw new Error('ZIPは32MB以下にしてください。');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
    if (u32(pos) === 0x06054b50 && pos + 22 + u16(pos + 20) === bytes.length) { end = pos; break; }
  }
  if (end < 0) throw new Error('ZIPの形式を読み取れませんでした。');
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) {
    throw new Error('分割ZIPには対応していません。');
  }
  const count = u16(end + 10), directorySize = u32(end + 12), directoryOffset = u32(end + 16);
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error('ZIP64には対応していません。通常のZIPで保存してください。');
  }
  if (count > IMPORT_LIMITS.files) throw new Error('ZIP内のファイル数は600個以下にしてください。');
  if (directoryOffset + directorySize > end) throw new Error('ZIPの索引が壊れています。');
  const entries = [], seen = new Set();
  let offset = directoryOffset, total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > directoryOffset + directorySize || u32(offset) !== 0x02014b50) {
      throw new Error('ZIPのファイル情報が壊れています。');
    }
    const flags = u16(offset + 8), method = u16(offset + 10), crc = u32(offset + 16);
    const compressedSize = u32(offset + 20), size = u32(offset + 24);
    const nameSize = u16(offset + 28), extraSize = u16(offset + 30), commentSize = u16(offset + 32);
    const localOffset = u32(offset + 42), next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > directoryOffset + directorySize) throw new Error('ZIPのファイル名情報が壊れています。');
    if (flags & 1) throw new Error('パスワード付きZIPには対応していません。');
    if (method !== 0 && method !== 8) throw new Error('このZIPの圧縮方式には対応していません。');
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64のファイルには対応していません。');
    }
    const rawName = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(offset + 46, offset + 46 + nameSize));
    const path = normalizeArchivePath(rawName);
    if (seen.has(path)) throw new Error('ZIP内に重複するファイル名があります。');
    seen.add(path);
    total += size;
    if (size > IMPORT_LIMITS.bytes || total > IMPORT_LIMITS.bytes) {
      throw new Error('ZIPを展開した合計サイズは32MB以下にしてください。');
    }
    if (localOffset + 30 > directoryOffset || u32(localOffset) !== 0x04034b50) {
      throw new Error('ZIPのファイル位置が壊れています。');
    }
    if (u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method) {
      throw new Error('ZIPの圧縮情報が一致しません。');
    }
    const dataOffset = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    if (dataOffset > directoryOffset || dataOffset + compressedSize > directoryOffset) {
      throw new Error('ZIPの圧縮データが壊れています。');
    }
    if (!rawName.endsWith('/') && !path.startsWith('__MACOSX/') && !/(^|\/)\.DS_Store$/.test(path)) {
      entries.push({ path, flags, method, size, compressedSize, dataOffset, crc });
    }
    offset = next;
  }
  if (offset !== directoryOffset + directorySize) throw new Error('ZIPの索引サイズが一致しません。');
  return entries;
}

export function readZip(bytes) {
  const records = inspectZip(bytes);
  return records.map(record => {
    const compressed = bytes.subarray(record.dataOffset, record.dataOffset + record.compressedSize);
    let data;
    try {
      data = record.method === 0 ? compressed.slice() : inflateSync(compressed, { out: new Uint8Array(record.size) });
    } catch {
      throw new Error(`「${record.path}」の圧縮データを展開できませんでした。`);
    }
    if (data.length !== record.size || crc32(data) !== record.crc) {
      throw new Error(`「${record.path}」が破損しています。`);
    }
    return { path: record.path, bytes: data };
  });
}
