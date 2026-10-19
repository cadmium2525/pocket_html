import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelectedZip, downloadFileName, packageFileName, uniqueDownloadNames } from '../js/archive-files.js';
import { inspectZip, readZip } from '../js/zip.js';

const text = value => new TextEncoder().encode(value);
const fixture = () => [
  { path: 'game/index.html', bytes: text('<title>そういう意味</title>') },
  { path: 'game/images/data.bin', bytes: new Uint8Array([0, 255, 1, 128]) },
  { path: 'game/audio/data.bin', bytes: new Uint8Array([7, 0, 254]) },
  { path: 'game/資料/空.txt', bytes: new Uint8Array() },
];

test('selected ZIP preserves binary bytes, relative paths and same basenames in different directories', () => {
  const records = fixture();
  const chosen = ['game/images/data.bin', 'game/audio/data.bin'];
  const archive = createSelectedZip(records, new Set(chosen));
  assert.deepEqual(readZip(archive), records.filter(record => chosen.includes(record.path)));
  assert.deepEqual(inspectZip(archive).map(entry => entry.method), [0, 0]);
});

test('selected ZIP keeps Unicode paths and empty files, including all-file selection', () => {
  const records = fixture();
  assert.deepEqual(readZip(createSelectedZip(records, records.map(record => record.path))), records);
  assert.deepEqual(readZip(createSelectedZip(records, ['game/資料/空.txt'])), [records[3]]);
});

test('prototype-like filenames are ordinary entries and never mutate Object.prototype', () => {
  const records = ['__proto__', 'constructor', 'prototype', '__proto__/polluted.txt'].map(path => ({ path, bytes: text(path) }));
  const originalPrototype = Object.getPrototypeOf({});
  assert.deepEqual(readZip(createSelectedZip(records, records.map(record => record.path))), records);
  assert.equal(Object.getPrototypeOf({}), originalPrototype);
  assert.equal(Object.prototype.polluted, undefined);
});

test('unsafe and ambiguous archive paths cannot be exported', () => {
  for (const path of ['../secret.txt', 'a/../secret.txt', '/secret.txt', 'C:/secret.txt', 'a\0b', '', '.', 'directory/']) {
    assert.throws(() => createSelectedZip([{ path, bytes: text('x') }], [path]));
  }
  assert.throws(() => createSelectedZip([
    { path: 'a/b.txt', bytes: text('a') }, { path: 'a\\b.txt', bytes: text('b') },
  ], ['a/b.txt']), /重複/);
  assert.throws(() => createSelectedZip([{ path: 'a.txt', bytes: 'text' }], ['a.txt']), /データ/);
});

test('empty, unknown and duplicate selections cannot silently produce incomplete ZIPs', () => {
  const records = fixture();
  assert.throws(() => createSelectedZip(records, []), /選んで/);
  assert.throws(() => createSelectedZip(records, ['missing.txt']), /見つかりません/);
  assert.throws(() => createSelectedZip(records, ['game/index.html', 'game/./index.html']), /重複/);
  assert.throws(() => createSelectedZip(records, ['../secret.txt']), /パス/);
});

test('individual and ZIP download names are safe filenames while retaining Japanese names', () => {
  assert.equal(downloadFileName('game/資料/説明.txt'), '説明.txt');
  assert.equal(downloadFileName('game\\images\\photo.png'), 'photo.png');
  assert.equal(downloadFileName('dir/a:b?c*<d>|"\0\n.txt'), 'a_b_c__d_____.txt');
  assert.equal(downloadFileName('dir/... '), 'file');
  assert.equal(downloadFileName('dir/CON.txt'), '_CON.txt');
  assert.equal(downloadFileName(''), 'file');
  assert.equal(packageFileName('そういう意味.ZIP'), 'そういう意味-selected.zip');
  assert.equal(packageFileName('C:\\folder\\game.zip'), 'game-selected.zip');
  assert.equal(packageFileName(), 'files-selected.zip');
});

test('multi-file downloads avoid case-insensitive collisions and reserve existing numbered filenames', () => {
  assert.deepEqual(uniqueDownloadNames([
    'images/a.txt', 'audio/A.TXT', 'docs/a (2).txt', 'other/a.txt',
  ]), ['a.txt', 'A (3).TXT', 'a (2).txt', 'a (4).txt']);
  assert.deepEqual(uniqueDownloadNames(['a/.env', 'b/.env', 'c/説明.txt', 'd/説明.txt']), [
    '.env', '.env (2)', '説明.txt', '説明 (2).txt',
  ]);
  assert.deepEqual(uniqueDownloadNames(['a/a:b.txt', 'b/a?b.txt', 'c/a_b (2).txt']), [
    'a_b.txt', 'a_b (3).txt', 'a_b (2).txt',
  ]);
  assert.deepEqual(uniqueDownloadNames([]), []);
});
