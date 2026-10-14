import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../js/vendor/fflate.js';
import { readZip, inspectZip, normalizeArchivePath, IMPORT_LIMITS } from '../js/zip.js';
import { resolveVirtualPath, rewriteModule, decodeHtml } from '../js/viewer-engine.js';

const fixture = () => zipSync({
  'project/index.html': strToU8('<!doctype html><title>日本語</title>'),
  'project/assets/settings.json': strToU8('{"score":42}'),
  'project/assets/plain.txt': [strToU8('uncompressed'), { level: 0 }],
});
function mutateCentral(bytes, mutate) {
  const copy = bytes.slice(), view = new DataView(copy.buffer);
  for (let offset = 0; offset < copy.length - 4; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) { mutate(view, offset, copy); return copy; }
  }
  throw new Error('Test ZIP missing central directory');
}

test('reads stored/deflated ZIP resources without losing Unicode HTML', () => {
  const records = readZip(fixture());
  assert.equal(records.length, 3);
  assert.equal(records[0].path, 'project/index.html');
  assert.match(decodeHtml(records[0].bytes), /日本語/);
  assert.equal(new TextDecoder().decode(records[2].bytes), 'uncompressed');
});

test('rejects absolute paths, parent traversal, NUL, duplicate paths', () => {
  for (const path of ['/index.html', '../index.html', 'a/../index.html', 'C:/index.html', 'a\0b']) {
    assert.throws(() => normalizeArchivePath(path));
  }
  assert.equal(normalizeArchivePath('game\\assets\\image.png'), 'game/assets/image.png');
  assert.throws(() => readZip(zipSync({ '../index.html': strToU8('x') })), /パス/);
  assert.throws(() => readZip(zipSync({ 'a/index.html': strToU8('a'), 'a\\index.html': strToU8('b') })), /重複/);
});

test('rejects truncated, encrypted, unsupported, oversized ZIPs before extraction', () => {
  const bytes = fixture();
  assert.throws(() => inspectZip(bytes.subarray(0, bytes.length - 10)));
  assert.throws(() => inspectZip(new Uint8Array(IMPORT_LIMITS.bytes + 1)), /32MB/);
  assert.throws(() => inspectZip(mutateCentral(bytes, (view, offset) => view.setUint16(offset + 8, 1, true))), /パスワード/);
  assert.throws(() => inspectZip(mutateCentral(bytes, (view, offset) => view.setUint16(offset + 10, 99, true))), /圧縮方式/);
  assert.throws(() => inspectZip(mutateCentral(bytes, (view, offset) => view.setUint32(offset + 24, IMPORT_LIMITS.bytes + 1, true))), /32MB/);
});

test('rejects CRC damage and forged short decompressed sizes', () => {
  const bytes = fixture();
  assert.throws(() => readZip(mutateCentral(bytes, (view, offset) => view.setUint32(offset + 16, 0, true))), /破損/);
  assert.throws(() => readZip(mutateCentral(bytes, (view, offset) => view.setUint32(offset + 24, 1, true))), /展開|破損/);
});

test('resolves nested virtual resources and preserves external/data/anchor URLs', () => {
  assert.deepEqual(resolveVirtualPath('../data.json?v=2#start', 'assets/main.js'), { path: 'data.json', search: '?v=2', hash: '#start' });
  assert.deepEqual(resolveVirtualPath('./日本語.png', 'assets/main.js'), { path: 'assets/日本語.png', search: '', hash: '' });
  for (const value of ['https://example.com/x.js', 'data:text/plain,hello', 'blob:https://example.com/foo', '#score']) {
    assert.equal(resolveVirtualPath(value, 'index.html'), null);
  }
});

test('rewrites module declarations, dynamic literals and import.meta without changing quoted/comment/regexp text', () => {
  const input = `import {x} from './lib/b.js';
export {x} from './lib/b.js';
import './lib/b.js';
import('./a.js');
const url = new URL('./data.json', import.meta.url);
const example = "import './a.js'";
const pattern = /import 'a.js'/;
const arrowPattern = () => /import 'a.js'/;
object.import('./a.js');
// import './missing.js';
/* export {x} from './missing.js'; */
import external from 'package-name';`;
  const output = rewriteModule(input, 'a.js', new Set(['a.js', 'lib/b.js']));
  assert.equal((output.match(/https:\/\/html-viewer.local.invalid\/lib\/b.js/g) || []).length, 3);
  assert.equal((output.match(/https:\/\/html-viewer.local.invalid\/a.js/g) || []).length, 2);
  assert.ok(output.includes('const example = "import \'./a.js\'";'));
  assert.ok(output.includes("const pattern = /import 'a.js'/;"));
  assert.ok(output.includes("const arrowPattern = () => /import 'a.js'/;"));
  assert.ok(output.includes("object.import('./a.js');"));
  assert.ok(output.includes("// import './missing.js';"));
  assert.ok(output.includes("import external from 'package-name';"));
});

test('reports missing local modules and decodes charset declarations', () => {
  const warnings = [];
  rewriteModule("import './missing.js';", 'index.html', new Set(['index.html']), warning => warnings.push(warning));
  assert.equal(warnings.length, 1);
  const shiftJis = new Uint8Array([...new TextEncoder().encode('<meta charset="shift_jis"><title>'), 0x93, 0xfa, 0x96, 0x7b]);
  assert.match(decodeHtml(shiftJis), /日本/);
});
