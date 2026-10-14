import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../js/vendor/fflate.js';
import {
  IMPORT_LIMITS, LARGE_IMPORT_LIMITS, getImportLimits, inspectZip, readZip,
} from '../js/zip.js';
import { prepareDocument } from '../js/viewer-engine.js';

const MiB = 1024 * 1024;

function mutateCentral(bytes, entryIndex, mutate) {
  const copy = bytes.slice(), view = new DataView(copy.buffer);
  const end = copy.length - 22;
  let offset = view.getUint32(end + 16, true);
  for (let index = 0; index < entryIndex; index++) {
    offset += 46 + view.getUint16(offset + 28, true)
      + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  mutate(view, offset);
  return copy;
}

test('large imports require an explicit boolean and retain the 600-file limit', () => {
  assert.equal(IMPORT_LIMITS.bytes, 32 * MiB);
  assert.equal(LARGE_IMPORT_LIMITS.bytes, 128 * MiB);
  assert.equal(IMPORT_LIMITS.files, 600);
  assert.equal(LARGE_IMPORT_LIMITS.files, 600);
  assert.equal(getImportLimits(true), LARGE_IMPORT_LIMITS);
  for (const value of [undefined, false, 'true', 1, {}]) {
    assert.equal(getImportLimits(value), IMPORT_LIMITS);
  }
  const bytes = zipSync({ 'index.html': strToU8('<title>limit</title>') });
  assert.throws(() => inspectZip(bytes, { bytes: Infinity, files: Infinity }));
  assert.throws(() => readZip(bytes, { bytes: Infinity, files: Infinity }));
});

test('an actual 33 MiB asset imports intact only when the large profile is selected', () => {
  // Compressible audio/image-like bytes exercise the expanded-size guard,
  // without storing a large fixture or allocating a 128 MiB payload.
  const asset = new Uint8Array(33 * MiB).fill(0x5a);
  asset[0] = 0x31;
  asset[asset.length - 1] = 0x79;
  const entries = {
    'index.html': strToU8('<title>Large game</title>'),
    'assets/data.bin': asset,
  };
  const compressed = zipSync(entries, { level: 1 });
  assert.ok(compressed.byteLength < IMPORT_LIMITS.bytes);
  assert.throws(() => inspectZip(compressed), /32MB/);
  assert.throws(() => readZip(compressed), /32MB/);
  const records = readZip(compressed, LARGE_IMPORT_LIMITS);
  assert.equal(records.length, 2);
  assert.equal(records[1].path, 'assets/data.bin');
  assert.equal(Buffer.compare(records[1].bytes, asset), 0);

  // The same uncompressed ZIP exceeds the archive input guard as well.
  const stored = zipSync(entries, { level: 0 });
  assert.ok(stored.byteLength > IMPORT_LIMITS.bytes);
  assert.throws(() => inspectZip(stored), /32MB/);
  const inspected = inspectZip(stored, LARGE_IMPORT_LIMITS);
  assert.equal(inspected[1].size, asset.byteLength);
});

test('128 MiB is enforced per entry and in aggregate before ZIP extraction', () => {
  const fixture = zipSync({
    'index.html': strToU8('<title>size</title>'),
    'asset.bin': strToU8('small'),
  });
  const oversizedEntry = mutateCentral(fixture, 1, (view, offset) => {
    view.setUint32(offset + 24, LARGE_IMPORT_LIMITS.bytes + 1, true);
  });
  assert.throws(() => inspectZip(oversizedEntry, LARGE_IMPORT_LIMITS), /128MB/);
  assert.throws(() => readZip(oversizedEntry, LARGE_IMPORT_LIMITS), /128MB/);

  const firstHalf = mutateCentral(fixture, 0, (view, offset) => {
    view.setUint32(offset + 24, 64 * MiB, true);
  });
  const oversizedTotal = mutateCentral(firstHalf, 1, (view, offset) => {
    view.setUint32(offset + 24, 64 * MiB + 1, true);
  });
  assert.throws(() => inspectZip(oversizedTotal, LARGE_IMPORT_LIMITS), /128MB/);
  assert.throws(() => readZip(oversizedTotal, LARGE_IMPORT_LIMITS), /128MB/);
});

test('large ZIP mode continues to reject 601 files and damaged or unsafe entries', () => {
  const entries = Object.fromEntries(Array.from({ length: 600 }, (_, index) => [`${index}.txt`, new Uint8Array()]));
  assert.equal(inspectZip(zipSync(entries), LARGE_IMPORT_LIMITS).length, 600);
  entries['600.txt'] = new Uint8Array();
  assert.throws(() => inspectZip(zipSync(entries), LARGE_IMPORT_LIMITS), /600/);

  const bytes = zipSync({ 'index.html': strToU8('<title>safe</title>') });
  const badCrc = mutateCentral(bytes, 0, (view, offset) => view.setUint32(offset + 16, 0, true));
  const shortSize = mutateCentral(bytes, 0, (view, offset) => view.setUint32(offset + 24, 1, true));
  assert.throws(() => readZip(badCrc, LARGE_IMPORT_LIMITS), /破損/);
  assert.throws(() => readZip(shortSize, LARGE_IMPORT_LIMITS), /展開|破損/);
  assert.throws(() => readZip(zipSync({ '../index.html': strToU8('x') }), LARGE_IMPORT_LIMITS), /パス/);
  assert.throws(() => inspectZip(bytes.subarray(0, bytes.length - 3), LARGE_IMPORT_LIMITS));
});

test('document imports route the selected size profile before reading file bytes', async () => {
  let reads = 0;
  const sentinel = new Error('file read reached');
  const file = size => ({
    name: 'index.html', size,
    arrayBuffer() { reads++; throw sentinel; },
  });
  for (const options of [{}, { largeFiles: false }, { largeFiles: 'true' }]) {
    await assert.rejects(prepareDocument([file(33 * MiB)], options), /32MB/);
  }
  assert.equal(reads, 0);
  await assert.rejects(prepareDocument([file(33 * MiB)], { largeFiles: true }), error => error === sentinel);
  assert.equal(reads, 1);
  await assert.rejects(prepareDocument([file(LARGE_IMPORT_LIMITS.bytes + 1)], { largeFiles: true }), /128MB/);
  assert.equal(reads, 1);
  await assert.rejects(prepareDocument(Array.from({ length: 601 }, () => file(0)), { largeFiles: true }), /600/);
  assert.equal(reads, 1);
});
