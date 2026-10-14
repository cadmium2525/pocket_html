import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mimeFor, decodePath, namespaceUrl, locateRequest, selectRootPath, findAssetPath, parseByteRange, fileResponse,
} from '../js/http-protocol.js';

const token = '0123456789abcdef0123456789abcdef';
const scope = 'https://example.github.io/pocket_html/serve/';
const mount = { token, rootPath: 'game/dist/', paths: ['game/dist/index.html', 'game/dist/assets/main.js', 'game/dist/assets/worker.js', 'game/dist/scenes/index.html'] };

test('HTTP namespace keeps GitHub Pages subpath and rejects malformed paths', () => {
  const url = namespaceUrl(scope, token, 'game/dist/日本語.html');
  assert.equal(locateRequest(url, scope).path, 'game/dist/日本語.html');
  assert.equal(new URL(url).pathname.startsWith('/pocket_html/serve/'), true);
  assert.equal(decodePath('assets/a%2Fb.js'), null);
  assert.equal(decodePath('assets/%5Cmain.js'), null);
  assert.equal(decodePath('assets/%00main.js'), null);
  assert.equal(decodePath('%E0%A4%A'), null);
  assert.throws(() => namespaceUrl(scope, '../other'));
});

test('root Vite assets route only from a client in the same mount', () => {
  const client = namespaceUrl(scope, token, mount.entryPath || 'game/dist/index.html');
  const route = locateRequest('https://example.github.io/assets/main.js?v=1', scope, client);
  assert.deepEqual(findAssetPath(route, mount, '/pocket_html/'), { path: 'game/dist/assets/main.js', directory: false });
  assert.equal(locateRequest('https://example.github.io/assets/main.js', scope), null);
  assert.equal(locateRequest('https://external.example/assets/main.js', scope, client), null);
  assert.equal(locateRequest(namespaceUrl(scope, 'f'.repeat(32), 'index.html'), scope, client), null);
  const repositoryBase = locateRequest('https://example.github.io/pocket_html/assets/main.js', scope, client);
  assert.equal(findAssetPath(repositoryBase, mount, '/pocket_html/').path, 'game/dist/assets/main.js');
});

test('directory index lookup and missing assets remain bounded to mount records', () => {
  assert.deepEqual(findAssetPath({ path: 'game/dist/scenes/', rootRelative: false }, mount, '/pocket_html/'), { path: 'game/dist/scenes/index.html', directory: true });
  assert.equal(findAssetPath({ path: 'game/dist/absent.js', rootRelative: false }, mount, '/pocket_html/'), null);
  assert.equal(mimeFor('runtime.wasm'), 'application/wasm');
  assert.equal(mimeFor('module.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(mimeFor('texture.bin'), 'application/octet-stream');
});

test('absolute Worker URLs preserve an existing archive prefix and GitHub Pages base', () => {
  const workerPaths = ['game/assets/worker.js', 'game/assets/module.mjs'];
  assert.equal(selectRootPath('assets/worker.js', 'game/', workerPaths, '/pocket_html/'), 'game/assets/worker.js');
  assert.equal(selectRootPath('game/assets/worker.js', 'game/', workerPaths, '/pocket_html/'), 'game/assets/worker.js');
  assert.equal(selectRootPath('pocket_html/assets/module.mjs', 'game/', workerPaths, '/pocket_html/'), 'game/assets/module.mjs');
  assert.equal(selectRootPath('pocket_html/game/assets/worker.js', 'game/', workerPaths, '/pocket_html/'), 'game/assets/worker.js');
});

test('absolute base and directory URLs preserve existing folders and trailing slashes', () => {
  const paths = ['game/index.html', 'game/assets/main.js', 'game/scenes/index.html'];
  assert.equal(selectRootPath('game/', 'game/', paths, '/pocket_html/', true), 'game/');
  assert.equal(selectRootPath('game/scenes/', 'game/', paths, '/pocket_html/', true), 'game/scenes/');
  assert.equal(selectRootPath('scenes/', 'game/', paths, '/pocket_html/', true), 'game/scenes/');
  assert.equal(selectRootPath('game/scenes', 'game/', paths, '/pocket_html/', true), 'game/scenes');
  assert.equal(selectRootPath('', 'game/', paths, '/pocket_html/', true), 'game/');
  assert.equal(selectRootPath('game/scenes2/', 'game/', paths, '/pocket_html/', true), 'game/game/scenes2/');
});

test('HTTP range supports media intervals, suffixes and invalid requests', () => {
  assert.deepEqual(parseByteRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=0-100', 10), { start: 0, end: 9 });
  for (const header of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=9007199254740992-']) assert.equal(parseByteRange(header, 10), false);
});

test('HTTP GET, HEAD, partial responses and static-only methods have proper metadata', async () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4]);
  const get = fileResponse(bytes, 'game.wasm', new Request('https://example.com/game.wasm'));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Content-Type'), 'application/wasm');
  assert.equal(get.headers.get('Content-Length'), '5');
  assert.deepEqual(new Uint8Array(await get.arrayBuffer()), bytes);
  const head = fileResponse(bytes, 'game.wasm', new Request('https://example.com/game.wasm', { method: 'HEAD' }));
  assert.equal(head.headers.get('Content-Length'), '5');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const partial = fileResponse(bytes, 'game.wasm', new Request('https://example.com/game.wasm', { headers: { Range: 'bytes=1-3' } }));
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('Content-Range'), 'bytes 1-3/5');
  assert.deepEqual(new Uint8Array(await partial.arrayBuffer()), new Uint8Array([1, 2, 3]));
  const invalid = fileResponse(bytes, 'game.wasm', new Request('https://example.com/game.wasm', { headers: { Range: 'bytes=50-' } }));
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('Content-Range'), 'bytes */5');
  const post = fileResponse(bytes, 'game.wasm', new Request('https://example.com/game.wasm', { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
});
