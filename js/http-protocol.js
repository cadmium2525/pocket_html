/** Browser-local static HTTP mounts. This module also contains pure routing helpers. */
export const HTTP_DB = 'pocket-html-http-v1';
export const MOUNT_TTL = 24 * 60 * 60 * 1000;
export const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', wasm: 'application/wasm',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac',
  mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8', xml: 'application/xml; charset=utf-8',
};

export const mimeFor = path => MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
export const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
export const rootFor = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';

export function decodePath(path) {
  try {
    const parts = path.split('/').map(decodeURIComponent);
    if (parts.some(part => /[\\/\u0000]/.test(part) || part === '..' || part === '.')) return null;
    return parts.join('/');
  } catch { return null; }
}

export function namespaceUrl(scopeUrl, token, path = '') {
  if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid HTTP mount token.');
  return new URL(`${token}/${encodePath(path)}`, scopeUrl).href;
}

/** Resolve an absolute archive URL, respecting both entry-directory and archive-root files. */
export function selectRootPath(path, rootPath, paths, viewerPath = '', includeDirectories = false) {
  const candidates = [rootPath + path, path];
  const prefix = viewerPath.replace(/^\//, '');
  if (prefix && path.startsWith(prefix)) {
    const relative = path.slice(prefix.length);
    candidates.push(rootPath + relative, relative);
  }
  const known = new Set(paths);
  return candidates.find(candidate => known.has(candidate) || (includeDirectories && paths.some(knownPath => {
    const directory = candidate.endsWith('/') || !candidate ? candidate : candidate + '/';
    return knownPath.startsWith(directory);
  }))) || candidates[0];
}

/** A URL outside the mount is routable only when its requesting client is mounted. */
export function locateRequest(requestUrl, scopeUrl, clientUrl = '') {
  const request = new URL(requestUrl), scope = new URL(scopeUrl);
  if (request.origin !== scope.origin) return null;
  const parse = url => {
    if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
    const suffix = url.pathname.slice(scope.pathname.length), separator = suffix.indexOf('/');
    const token = separator < 0 ? suffix : suffix.slice(0, separator);
    if (!TOKEN_PATTERN.test(token)) return null;
    const path = decodePath(separator < 0 ? '' : suffix.slice(separator + 1));
    return path === null ? null : { token, path, rootRelative: false };
  };
  const requested = parse(request);
  let client = null;
  try { if (clientUrl) client = parse(new URL(clientUrl)); } catch {}
  if (requested) {
    if (client && requested.token !== client.token) return null;
    return requested;
  }
  if (request.pathname.startsWith(scope.pathname) || !client) return null;
  const path = decodePath(request.pathname.slice(1));
  return path === null ? null : { token: client.token, path, rootRelative: true };
}

export function findAssetPath(route, mount, viewerPath) {
  const paths = new Set(mount.paths);
  const candidates = route.rootRelative ? [mount.rootPath + route.path, route.path] : [route.path];
  const prefix = viewerPath.replace(/^\//, '');
  if (route.rootRelative && prefix && route.path.startsWith(prefix)) {
    const relative = route.path.slice(prefix.length);
    candidates.push(mount.rootPath + relative, relative);
  }
  for (const candidate of candidates) {
    if (paths.has(candidate)) return { path: candidate, directory: false };
    const directory = candidate.endsWith('/') || !candidate ? candidate : `${candidate}/`;
    for (const name of ['index.html', 'index.htm']) {
      if (paths.has(directory + name)) return { path: directory + name, directory: true };
    }
  }
  return null;
}

export function parseByteRange(header, length) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || length === 0) return false;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, length - suffix); end = length - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : length - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= length || start > end) return false;
    end = Math.min(end, length - 1);
  }
  return { start, end };
}

export function fileResponse(bytes, path, request, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': mimeFor(path), 'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...extraHeaders,
  });
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD');
    headers.set('Content-Type', 'text/plain; charset=utf-8');
    return new Response('このViewerは静的ファイルの配信に対応しています。', { status: 405, headers });
  }
  const range = request.method === 'GET' ? parseByteRange(request.headers.get('Range'), bytes.byteLength) : null;
  if (range === false) {
    headers.set('Content-Range', `bytes */${bytes.byteLength}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
  headers.set('Content-Length', String(body.byteLength));
  if (range) headers.set('Content-Range', `bytes ${range.start}-${range.end}/${bytes.byteLength}`);
  return new Response(request.method === 'HEAD' ? null : body, { status: range ? 206 : 200, headers });
}

let databasePromise;
export function openMountDb() {
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(HTTP_DB, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('mounts', { keyPath: 'token' });
      database.createObjectStore('files', { keyPath: ['token', 'path'] });
      database.createObjectStore('clients', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = undefined; };
      resolve(database);
    };
    request.onerror = () => { databasePromise = undefined; reject(request.error); };
    request.onblocked = () => { databasePromise = undefined; reject(new Error('ブラウザ内の配信データを開けませんでした。別のPocket HTMLタブを閉じてください。')); };
  });
  return databasePromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('ブラウザ内の保存に失敗しました。'));
  });
}

export async function storeMount(mount, records) {
  const database = await openMountDb(), transaction = database.transaction(['mounts', 'files'], 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('mounts').put(mount);
  const files = transaction.objectStore('files');
  for (const record of records) files.put({ token: mount.token, path: record.path, bytes: record.bytes });
  await done;
}

export async function readMountRecord(store, key) {
  const database = await openMountDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function rememberClient(id, token, expires) {
  if (!id || !TOKEN_PATTERN.test(token)) return;
  const database = await openMountDb(), transaction = database.transaction('clients', 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('clients').put({ id, token, expires });
  await done;
}

export async function deleteMount(token) {
  const mount = await readMountRecord('mounts', token);
  if (!mount) return;
  const database = await openMountDb(), transaction = database.transaction(['mounts', 'files', 'clients'], 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore('mounts').delete(token);
  for (const path of mount.paths) transaction.objectStore('files').delete([token, path]);
  const cursorRequest = transaction.objectStore('clients').openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    if (cursor.value.token === token) cursor.delete();
    cursor.continue();
  };
  await done;
}

export async function purgeExpiredMounts(now = Date.now()) {
  const database = await openMountDb();
  const expired = await new Promise((resolve, reject) => {
    const request = database.transaction('mounts').objectStore('mounts').getAll();
    request.onsuccess = () => resolve(request.result.filter(mount => mount.expires <= now).map(mount => mount.token));
    request.onerror = () => reject(request.error);
  });
  for (const token of expired) await deleteMount(token);
}
