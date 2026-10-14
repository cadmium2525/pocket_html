import {
  locateRequest, namespaceUrl, findAssetPath, fileResponse,
  readMountRecord, rememberClient, purgeExpiredMounts,
} from './js/http-protocol.js';

const scopeUrl = self.registration.scope;
const viewerPath = new URL('../', scopeUrl).pathname;
const errorResponse = (status, message) => new Response(message, {
  status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
});

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(), purgeExpiredMounts().catch(() => {}),
])));

async function serve(event) {
  try {
    let clientUrl = '';
    if (event.clientId) clientUrl = (await self.clients.get(event.clientId))?.url || '';
    // pushState can change the document URL while its service worker stays attached.
    let route = locateRequest(event.request.url, scopeUrl, clientUrl);
    if (!route && event.clientId && !new URL(event.request.url).pathname.startsWith(new URL(scopeUrl).pathname)) {
      const saved = await readMountRecord('clients', event.clientId);
      if (saved && saved.expires > Date.now()) route = locateRequest(event.request.url, scopeUrl, namespaceUrl(scopeUrl, saved.token));
    }
    if (!route) return errorResponse(404, 'このHTTPセッション内のファイルが見つかりません。');
    const mount = await readMountRecord('mounts', route.token);
    if (!mount || mount.expires <= Date.now()) return errorResponse(410, 'このHTTPセッションは終了しました。Viewerでファイルをもう一度開いてください。');
    const asset = findAssetPath(route, mount, viewerPath);
    if (!asset) return errorResponse(404, `ファイル「${route.path}」が見つかりません。ZIP内のフォルダ構成を確認してください。`);
    const canonical = new URL(namespaceUrl(scopeUrl, route.token, asset.path));
    const incoming = new URL(event.request.url);
    // Root-path modules keep their own canonical mount URL, including import.meta.url.
    if (route.rootRelative || (asset.directory && !incoming.pathname.endsWith('/'))) {
      if (!['GET', 'HEAD'].includes(event.request.method)) return errorResponse(405, 'GET / HEAD以外のサーバー処理には対応していません。');
      canonical.search = incoming.search;
      return new Response(null, { status: 307, headers: { Location: canonical.href, 'Cache-Control': 'no-store' } });
    }
    const record = await readMountRecord('files', [route.token, asset.path]);
    if (!record) return errorResponse(404, 'ブラウザ内のファイルが削除されています。もう一度開いてください。');
    if (event.resultingClientId) event.waitUntil(rememberClient(event.resultingClientId, route.token, mount.expires).catch(() => {}));
    const extraHeaders = /\.html?$/i.test(asset.path) ? {
      // Header policies persist if an imported document removes a meta element.
      'Content-Security-Policy': `worker-src ${namespaceUrl(scopeUrl, route.token)} blob:; object-src 'none'`,
    } : {};
    return fileResponse(new Uint8Array(record.bytes), asset.path, event.request, extraHeaders);
  } catch {
    return errorResponse(503, 'ブラウザ内の配信データを読み込めませんでした。Viewerでファイルをもう一度開いてください。');
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // External HTTPS requests retain the browser's normal CORS behavior.
  if (url.origin !== new URL(scopeUrl).origin) return;
  if (url.pathname.startsWith(new URL(scopeUrl).pathname) || event.clientId) event.respondWith(serve(event));
});
