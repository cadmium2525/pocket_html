import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../js/vendor/fflate.js';
import { readZipFile } from '../js/zip-reader.js';
import { readZip, IMPORT_LIMITS } from '../js/zip.js';

test('ZIP file browsing reads non-HTML files, Japanese names and zero-byte files', async () => {
  const bytes = zipSync({ '資料/説明.txt': strToU8('原文'), 'empty.bin': new Uint8Array() });
  const records = await readZipFile(new File([bytes], 'FILES.ZIP'));
  assert.deepEqual(records.map(record => record.path), ['資料/説明.txt', 'empty.bin']);
  assert.equal(new TextDecoder().decode(records[0].bytes), '原文');
  assert.equal(records[1].bytes.byteLength, 0);
});

test('file size and cancellation stop reading before allocation or extraction', async () => {
  let reads = 0;
  const file = { size: IMPORT_LIMITS.bytes + 1, arrayBuffer() { reads++; throw new Error('should not read'); } };
  await assert.rejects(readZipFile(file), /32MB/);
  assert.equal(reads, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readZipFile(file, { largeFiles: true, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(reads, 0);
  const whileReading = new AbortController();
  await assert.rejects(readZipFile({ size: 2, async arrayBuffer() {
    whileReading.abort(); return new Uint8Array([0, 0]).buffer;
  } }, { signal: whileReading.signal }), { name: 'AbortError' });
});

test('undecodable legacy filenames fail clearly instead of being saved under corrupted names', () => {
  const bytes = zipSync({ 'a.txt': strToU8('original') });
  const view = new DataView(bytes.buffer);
  const central = view.getUint32(bytes.length - 6, true);
  bytes[30] = 0x82;
  bytes[central + 46] = 0x82;
  assert.throws(() => readZip(bytes), /UTF-8/);
});
