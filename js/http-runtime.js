import { readDocumentBundle, decodeHtml } from './viewer-engine.js';
import {
  MOUNT_TTL, namespaceUrl, rootFor, decodePath, selectRootPath, storeMount, deleteMount, purgeExpiredMounts,
} from './http-protocol.js';

const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

async function activeRegistration(workerUrl, scopeUrl) {
  if (!globalThis.isSecureContext || !navigator.serviceWorker) {
    throw new Error('HTTPモードにはHTTPSのSafariなど、Service Workerに対応したブラウザが必要です。');
  }
  const registration = await navigator.serviceWorker.register(workerUrl, { scope: scopeUrl, type: 'module', updateViaCache: 'none' });
  if (registration.active?.state === 'activated') return registration;
  await new Promise((resolve, reject) => {
    const worker = registration.installing || registration.waiting || registration.active;
    if (!worker) { reject(new Error('HTTPモードの配信機能を起動できませんでした。')); return; }
    const timeout = setTimeout(() => finish(new Error('HTTPモードの起動がタイムアウトしました。ページを再読み込みしてください。')), 20000);
    const finish = error => {
      clearTimeout(timeout); worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === 'activated') finish();
      else if (worker.state === 'redundant') finish(new Error('HTTPモードの配信機能を起動できませんでした。'));
    };
    worker.addEventListener('statechange', changed); changed();
  });
  return registration;
}

function bootstrap(config, resolveRootPath) {
  const notify = value => parent.postMessage({ viewerBridge: config.token, ...value }, '*');
  const mountUrl = input => {
    const url = new URL(String(input), document.baseURI);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || url.pathname.startsWith(config.mountPath)) return input;
    const path = resolveRootPath(decodeURIComponent(url.pathname.slice(1)), config.rootPath, config.workerPaths, config.viewerPath);
    const mapped = new URL(path.split('/').map(encodeURIComponent).join('/'), config.mountUrl);
    mapped.search = url.search; mapped.hash = url.hash;
    return mapped.href;
  };
  // Worker clients need their own URL within scope to keep local imports/fetch working.
  for (const name of ['Worker', 'SharedWorker']) {
    const NativeWorker = globalThis[name];
    if (!NativeWorker) continue;
    globalThis[name] = class extends NativeWorker {
      constructor(url, options) { super(mountUrl(url), options); }
    };
  }
  window.addEventListener('error', event => notify({ type: 'error', message: event.message || 'ファイルの読み込みに失敗しました。', line: event.lineno, stack: event.error?.stack || '' }));
  window.addEventListener('unhandledrejection', event => notify({ type: 'error', message: String(event.reason?.message || event.reason), stack: event.reason?.stack || '' }));
  const ready = () => notify({ type: 'ready', title: document.title });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
}

function mapRootUrl(value, mount, scopeUrl, viewerPath) {
  if (!/^\/(?!\/)/.test(value)) return value;
  try {
    const url = new URL(value, scopeUrl), path = decodeURIComponent(url.pathname.slice(1));
    const selected = selectRootPath(path, mount.rootPath, mount.paths, viewerPath, true);
    return namespaceUrl(scopeUrl, mount.token, selected) + url.search + url.hash;
  } catch { return value; }
}

function rewriteCss(source, resolve) {
  return source.replace(/url\(\s*(["']?)(\/(?!\/)[^"')\s]+)\1\s*\)/gi, (_, quote, url) => `url(${quote}${resolve(url)}${quote})`)
    .replace(/(@import\s+)(["'])(\/(?!\/)[^"']+)\2/gi, (_, prefix, quote, url) => `${prefix}${quote}${resolve(url)}${quote}`);
}

function prepareRecords(bundle, mount, scopeUrl, viewerPath, warnings) {
  const resolve = value => mapRootUrl(value, mount, scopeUrl, viewerPath);
  const workerPaths = mount.paths.filter(path => /\.(?:js|mjs)$/i.test(path));
  return bundle.records.map(record => {
    if (/\.css$/i.test(record.path)) return { ...record, bytes: new TextEncoder().encode(rewriteCss(new TextDecoder().decode(record.bytes), resolve)) };
    if (!/\.html?$/i.test(record.path)) return record;
    const document = new DOMParser().parseFromString(decodeHtml(record.bytes), 'text/html');
    const policies = document.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]');
    if (policies.length) warnings.add('読み込んだHTMLのCSP設定は、Viewer内で実行できるように取り除いています。');
    policies.forEach(policy => policy.remove());
    for (const element of document.querySelectorAll('*')) {
      for (const attribute of ['src', 'href', 'poster', 'action', 'data']) {
        if (element.hasAttribute(attribute)) element.setAttribute(attribute, resolve(element.getAttribute(attribute)));
      }
      if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style'), resolve));
      if (element.tagName === 'STYLE') element.textContent = rewriteCss(element.textContent, resolve);
      // Rewritten CSS cannot retain its original integrity hash.
      if (element.tagName === 'LINK' && element.rel === 'stylesheet') element.removeAttribute('integrity');
      if (element.tagName === 'SCRIPT' && element.type === 'importmap') {
        try {
          const map = JSON.parse(element.textContent);
          if (map.imports) for (const key of Object.keys(map.imports)) if (typeof map.imports[key] === 'string') map.imports[key] = resolve(map.imports[key]);
          if (map.scopes) {
            const scopes = {};
            for (const [key, imports] of Object.entries(map.scopes)) {
              scopes[resolve(key)] = imports;
              for (const name of Object.keys(imports)) if (typeof imports[name] === 'string') imports[name] = resolve(imports[name]);
            }
            map.scopes = scopes;
          }
          element.textContent = safeJson(map);
        } catch { warnings.add('JSONとして読み込めないimport mapがあります。'); }
      }
    }
    const script = document.createElement('script');
    script.textContent = `(${bootstrap.toString()})(${safeJson({
      token: mount.token, rootPath: mount.rootPath, workerPaths,
      mountUrl: namespaceUrl(scopeUrl, mount.token), mountPath: new URL(namespaceUrl(scopeUrl, mount.token)).pathname,
      viewerPath: viewerPath.replace(/^\//, ''),
    })}, (${selectRootPath.toString()}));`;
    document.head.prepend(script);
    return { ...record, bytes: new TextEncoder().encode('<!doctype html>\n' + document.documentElement.outerHTML) };
  });
}

export async function prepareHttpDocument(files, options = {}) {
  const bundle = await readDocumentBundle(files, options);
  const viewerUrl = new URL('../', import.meta.url), scopeUrl = new URL('serve/', viewerUrl).href;
  await activeRegistration(new URL('http-sw.js', viewerUrl).href, scopeUrl);
  const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
  const token = [...tokenBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const now = Date.now(), mount = {
    token, created: now, expires: now + MOUNT_TTL, rootPath: rootFor(bundle.entryPath),
    entryPath: bundle.entryPath, paths: bundle.records.map(record => record.path),
  };
  const warnings = new Set([
    'HTTPモードでは読み込んだページがViewerと同じ保存領域を使います。信頼できるファイルだけを開いてください。',
    'Node.js・Python・PHPなどのサーバー処理や、ビルド前のソースコードは実行できません。',
  ]);
  const records = prepareRecords(bundle, mount, scopeUrl, viewerUrl.pathname, warnings);
  try { await purgeExpiredMounts(); await storeMount(mount, records); }
  catch { throw new Error('HTTPモード用のファイルをブラウザ内に保存できませんでした。保存容量やSafariの設定を確認してください。'); }
  let frame = null, listener = null, loadListener = null, disposed = false;
  const hash = typeof options.hash === 'string' && options.hash.startsWith('#') ? options.hash.slice(0, 1000) : '';
  const mountPrefix = new URL(namespaceUrl(scopeUrl, token));
  const syncCurrentEntry = () => {
    if (!frame || disposed) return;
    try {
      const url = new URL(frame.contentWindow.location.href);
      if (url.origin !== mountPrefix.origin || !url.pathname.startsWith(mountPrefix.pathname)) return;
      let path = decodePath(url.pathname.slice(mountPrefix.pathname.length));
      if (path === null) return;
      if (!path || path.endsWith('/')) path = ['index.html', 'index.htm'].map(name => path + name).find(candidate => bundle.entries.some(entry => entry.path === candidate)) || path;
      if (!bundle.entries.some(entry => entry.path === path)) return;
      session.entryPath = path;
      session.title = frame.contentDocument?.title.trim() || path.split('/').pop();
    } catch { /* A page can navigate away from the local HTTP mount. */ }
  };
  const session = {
    name: bundle.name, title: bundle.title, entryPath: bundle.entryPath, entries: bundle.entries,
    fileCount: bundle.records.length, documentKey: bundle.documentKey, warnings: [...warnings],
    url: namespaceUrl(scopeUrl, token, bundle.entryPath) + hash, mode: 'http',
    attach(iframe, onEvent = () => {}) {
      if (disposed) throw new Error('このViewerセッションは終了しています。');
      if (listener) window.removeEventListener('message', listener);
      if (frame && loadListener) frame.removeEventListener('load', loadListener);
      frame = iframe;
      loadListener = syncCurrentEntry;
      frame.addEventListener('load', loadListener);
      listener = event => {
        if (disposed || event.source !== frame.contentWindow || event.data?.viewerBridge !== token) return;
        if (!['ready', 'error', 'storage-warning'].includes(event.data.type)) return;
        if (event.data.type === 'ready') syncCurrentEntry();
        onEvent({
          type: event.data.type, message: String(event.data.message || '').slice(0, 2500),
          title: String(event.data.title || '').slice(0, 300), stack: String(event.data.stack || '').slice(0, 2500),
          line: Number(event.data.line) || 0,
        });
      };
      window.addEventListener('message', listener);
    },
    dispose() {
      disposed = true;
      if (listener) window.removeEventListener('message', listener);
      if (frame && loadListener) frame.removeEventListener('load', loadListener);
      listener = null; loadListener = null; frame = null;
      return deleteMount(token).catch(() => {});
    },
  };
  return session;
}
