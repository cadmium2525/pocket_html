import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { deflateSync } from 'node:zlib';
import { zipSync } from '../js/vendor/fflate.js';
const base = resolve('tests/fixtures/bundle');
const files = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files['bundle/' + relative(base, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}
await collect(base);
function pngChunk(type, data) {
  const tag = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([tag, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, tag, data, checksum]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
files['bundle/assets/pixel.png'] = new Uint8Array(Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
  pngChunk('IDAT', deflateSync(Buffer.from([0, 112, 146, 65, 255]))), pngChunk('IEND', Buffer.alloc(0)),
]));
await mkdir('tests/artifacts', { recursive: true });
await writeFile('tests/artifacts/bundle.zip', zipSync(files));
console.log('Created tests/artifacts/bundle.zip');
