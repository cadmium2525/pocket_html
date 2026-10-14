import { readZip, IMPORT_LIMITS, normalizeArchivePath } from './zip.js';

const VIRTUAL_ORIGIN = 'https://html-viewer.local.invalid';
const STORAGE_PREFIX = 'html-viewer:game:v1:';
const STORAGE_LIMIT = 2 * 1024 * 1024;
const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', wasm: 'application/wasm', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  ico: 'image/x-icon', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  otf: 'font/otf', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml',
};
const mimeFor = path => MIME[path.split('.').pop().toLowerCase()] || 'application/octet-stream';
const htmlPath = path => /\.html?$/i.test(path);
const virtualUrl = path => `${VIRTUAL_ORIGIN}/${path.split('/').map(encodeURIComponent).join('/')}`;
const safeJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function resolveVirtualPath(value, fromPath) {
  const input = String(value).trim();
  if (!input || input.startsWith('#') || /^(?:data:|blob:|javascript:|mailto:|tel:)/i.test(input)) return null;
  try {
    const url = new URL(input, virtualUrl(fromPath));
    if (url.origin !== VIRTUAL_ORIGIN) return null;
    return { path: decodeURIComponent(url.pathname.slice(1)), hash: url.hash, search: url.search };
  } catch { return null; }
}

function asDataUrl(bytes, type) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return `data:${type};base64,${btoa(chunks.join(''))}`;
}
function textDataUrl(text, type) { return asDataUrl(new TextEncoder().encode(text), type); }

export function decodeHtml(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const preview = new TextDecoder().decode(bytes.subarray(0, 2048));
  const charset = preview.match(/<meta\s[^>]*charset\s*=\s*["']?\s*([\w-]+)/i)?.[1];
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); }
  catch { return new TextDecoder().decode(bytes); }
}

async function contentKey(records) {
  const sorted = [...records].sort((a, b) => a.path.localeCompare(b.path));
  if (globalThis.crypto?.subtle) {
    const hashes = [];
    for (const file of sorted) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', file.bytes));
      hashes.push(`${file.path}:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`);
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(hashes.join('\n'))));
    return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  // Development on file:// or an older browser still gets a deterministic key.
  let hash = 2166136261;
  for (const record of sorted) {
    for (const byte of new TextEncoder().encode(record.path)) hash = Math.imul(hash ^ byte, 16777619);
    for (const byte of record.bytes) hash = Math.imul(hash ^ byte, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(16)}`;
}

async function collectFiles(input) {
  const files = [...input];
  if (!files.length) throw new Error('HTMLファイルまたはZIPを選んでください。');
  if (files.length > IMPORT_LIMITS.files) throw new Error('一度に開くファイルは600個以下にしてください。');
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > IMPORT_LIMITS.bytes) throw new Error('ファイルの合計サイズは32MB以下にしてください。');
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    return { records: readZip(new Uint8Array(await files[0].arrayBuffer())), name: files[0].name };
  }
  if (files.some(file => /\.zip$/i.test(file.name))) throw new Error('ZIPは1つずつ開いてください。');
  const records = [], seen = new Set();
  for (const file of files) {
    const path = normalizeArchivePath(file.webkitRelativePath || file.name);
    if (seen.has(path)) throw new Error(`「${path}」が重複しています。ZIPにまとめるとフォルダ構成を保てます。`);
    seen.add(path);
    records.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return { records, name: files.length === 1 ? files[0].name : `${files.length}個のファイル` };
}

/** Small JS lexer: imports are rewritten without changing comments or strings. */
function jsTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const start = index, char = source[index];
    if (/\s/.test(char)) { index++; continue; }
    if (source.startsWith('//', index)) { index = source.indexOf('\n', index + 2); if (index < 0) break; continue; }
    if (source.startsWith('/*', index)) { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue; }
    // A regexp literal can contain quote/keyword text. Skip it as one token.
    const previous = tokens[tokens.length - 1]?.value;
    if (char === '/' && (!previous || ['=', '(', '[', '{', ',', ':', ';', '!', '?', '>', 'return', 'throw', 'yield', 'case'].includes(previous))) {
      index++;
      let characterClass = false;
      while (index < source.length) {
        const current = source[index++];
        if (current === '\\') { index++; continue; }
        if (current === '[') characterClass = true;
        if (current === ']') characterClass = false;
        if (current === '/' && !characterClass) break;
      }
      while (/[a-z]/i.test(source[index] || '')) index++;
      tokens.push({ value: 'regexp', kind: 'regexp', start, end: index });
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      index++;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index++] === char) break;
      }
      if (char !== '`') {
        const raw = source.slice(start + 1, index - 1);
        tokens.push({ value: raw.replace(/\\(["'\\])/g, '$1'), kind: 'string', start, end: index });
      }
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      index++;
      while (/[\w$]/.test(source[index] || '')) index++;
      tokens.push({ value: source.slice(start, index), kind: 'word', start, end: index });
    } else { tokens.push({ value: char, kind: 'punct', start, end: ++index }); }
  }
  return tokens;
}

export function rewriteModule(source, path, availablePaths, warning = () => {}) {
  const tokens = jsTokens(source), edits = [];
  let declaration = false;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index], next = tokens[index + 1];
    if (token.kind === 'string' || tokens[index - 1]?.value === '.') continue;
    if (token.value === ';') declaration = false;
    if (token.value === 'import' || token.value === 'export') declaration = true;
    if (token.value === 'import' && tokens.slice(index + 1, index + 5).map(item => item.value).join('') === '.meta.url') {
      edits.push({ start: token.start, end: tokens[index + 4].end, text: JSON.stringify(virtualUrl(path)) });
    }
    const specifier = token.value === 'import' && next?.kind === 'string' ? next
      : token.value === 'import' && next?.value === '(' && tokens[index + 2]?.kind === 'string' ? tokens[index + 2]
        : token.value === 'from' && declaration && next?.kind === 'string' ? next : null;
    if (!specifier) continue;
    const local = resolveVirtualPath(specifier.value, path);
    // Bare package names keep their meaning in the document's import map.
    if (!local || !/^(?:\.?\.?\/|\/|https?:)/.test(specifier.value)) continue;
    if (!availablePaths.has(local.path)) warning(`モジュール「${local.path}」が見つかりません。`);
    edits.push({ start: specifier.start, end: specifier.end, text: JSON.stringify(virtualUrl(local.path)) });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}

function runtimeBootstrap(config) {
  'use strict';
  const send = (type, detail = {}) => parent.postMessage({ viewerBridge: config.token, type, ...detail }, '*');
  const limit = 2 * 1024 * 1024;
  function storage(kind, initial) {
    const data = Object.assign(Object.create(null), initial);
    const target = {
      getItem(key) { key = String(key); return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem(key, value) {
        key = String(key); value = String(value);
        const candidate = Object.assign(Object.create(null), data, { [key]: value });
        if (JSON.stringify(candidate).length > limit) throw new DOMException('保存容量を超えました。', 'QuotaExceededError');
        data[key] = value; send('storage', { kind, op: 'set', key, value });
      },
      removeItem(key) { key = String(key); delete data[key]; send('storage', { kind, op: 'remove', key }); },
      clear() { for (const key of Object.keys(data)) delete data[key]; send('storage', { kind, op: 'clear' }); },
      key(index) { return Object.keys(data)[Number(index)] ?? null; },
    };
    Object.defineProperty(target, 'length', { get: () => Object.keys(data).length, configurable: true });
    return new Proxy(target, {
      get(object, key) { return key in object || typeof key === 'symbol' ? Reflect.get(object, key) : object.getItem(key) ?? undefined; },
      set(object, key, value) { if (typeof key !== 'string') return Reflect.set(object, key, value); object.setItem(key, value); return true; },
      deleteProperty(object, key) { object.removeItem(key); return true; },
      ownKeys() { return Object.keys(data); },
      getOwnPropertyDescriptor(object, key) { return Object.prototype.hasOwnProperty.call(data, key) ? { configurable: true, enumerable: true, writable: true, value: data[key] } : Reflect.getOwnPropertyDescriptor(object, key); },
    });
  }
  for (const kind of ['localStorage', 'sessionStorage']) {
    try { Object.defineProperty(window, kind, { value: storage(kind, config.storage[kind]), configurable: true }); }
    catch { send('storage-warning', { message: 'このブラウザではゲームの保存機能を利用できません。' }); }
  }
  const assets = config.assets, reverse = Object.create(null);
  for (const [path, url] of Object.entries(assets)) reverse[url] = path;
  function localPath(value, from = config.entryPath) {
    try {
      const input = String(value);
      if (reverse[input]) return { path: reverse[input], hash: '' };
      if (/^(?:data:|blob:|#)/i.test(input)) return null;
      const url = new URL(input, `${config.origin}/${from.split('/').map(encodeURIComponent).join('/')}`);
      if (url.origin !== config.origin) return null;
      return { path: decodeURIComponent(url.pathname.slice(1)), hash: url.hash };
    } catch { return null; }
  }
  function resolve(value, from) {
    const local = localPath(value, from);
    if (!local) return value;
    if (assets[local.path]) return assets[local.path] + local.hash;
    if (config.externalBase) { try { return new URL(String(value), config.externalBase).href; } catch {} }
    return 'about:blank#viewer-missing-resource';
  }
  function resolveCss(value) {
    if (value == null) return value;
    return String(value).replace(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)/gi,
      (match, double, single, bare) => `url("${String(resolve(double ?? single ?? bare)).replace(/"/g, '%22')}")`);
  }
  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) window.fetch = function(input, init) {
    const value = typeof input === 'string' || input instanceof URL ? input : input.url;
    const local = localPath(value);
    if (!local) return nativeFetch(input, init);
    if (!assets[local.path]) {
      if (config.externalBase) return nativeFetch(new URL(String(value), config.externalBase), init);
      return Promise.reject(new TypeError(`ファイルが見つかりません: ${local.path}`));
    }
    const method = init?.method || (typeof input === 'object' && input.method) || 'GET';
    if (method !== 'GET' && method !== 'HEAD') return Promise.reject(new TypeError('ローカルファイルへの書き込み通信には対応していません。'));
    return nativeFetch(assets[local.path], { ...init, method });
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) { return originalOpen.call(this, method, resolve(url), ...rest); };
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    if (/^(?:src|href|poster|data)$/i.test(name) && this.tagName !== 'A' && this.tagName !== 'BASE') value = resolve(value);
    if (String(name).toLowerCase() === 'style') value = resolveCss(value);
    return originalSetAttribute.call(this, name, value);
  };
  const attributes = [[HTMLImageElement, 'src'], [HTMLScriptElement, 'src'], [HTMLLinkElement, 'href'],
    [HTMLMediaElement, 'src'], [HTMLSourceElement, 'src'], [HTMLVideoElement, 'poster'], [HTMLIFrameElement, 'src'], [HTMLObjectElement, 'data']];
  for (const [constructor, name] of attributes) {
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, name);
    if (!descriptor?.set) continue;
    try { Object.defineProperty(constructor.prototype, name, {
      ...descriptor,
      get() {
        const value = descriptor.get.call(this);
        // Bundlers often locate additional resources from currentScript.src.
        return constructor === HTMLScriptElement && reverse[value]
          ? `${config.origin}/${reverse[value].split('/').map(encodeURIComponent).join('/')}` : value;
      },
      set(value) { descriptor.set.call(this, resolve(value)); },
    }); } catch {}
  }
  const nativeStyleSetProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) { return nativeStyleSetProperty.call(this, name, resolveCss(value), priority); };
  for (const name of ['cssText', 'backgroundImage', 'maskImage', 'webkitMaskImage', 'listStyleImage', 'content']) {
    const descriptor = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, name);
    if (descriptor?.set) {
      try { Object.defineProperty(CSSStyleDeclaration.prototype, name, { ...descriptor, set(value) { descriptor.set.call(this, resolveCss(value)); } }); } catch {}
    }
  }
  if (window.CSSStyleSheet?.prototype.insertRule) {
    const nativeInsertRule = CSSStyleSheet.prototype.insertRule;
    CSSStyleSheet.prototype.insertRule = function(rule, index) { return nativeInsertRule.call(this, resolveCss(rule), index); };
  }
  if (window.Worker) {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker { constructor(url, options) { super(resolve(url), options); } };
  }
  const short = value => String(value ?? '').slice(0, 2500);
  window.addEventListener('error', event => {
    if (event.target !== window) {
      const resource = event.target?.getAttribute?.('src') || event.target?.getAttribute?.('href') || event.target?.tagName;
      send('error', { message: `リソースを読み込めませんでした: ${short(reverse[resource] || resource)}` });
    } else send('error', { message: short(event.message), stack: short(event.error?.stack), line: event.lineno });
  }, true);
  window.addEventListener('unhandledrejection', event => send('error', { message: short(event.reason?.message || event.reason), stack: short(event.reason?.stack) }));
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href');
    if (href?.startsWith('#')) return;
    const local = localPath(href);
    if (local && /\.html?$/i.test(local.path) && config.entries.includes(local.path)) {
      event.preventDefault(); send('navigate', { entryPath: local.path, hash: local.hash });
    }
  });
  window.addEventListener('load', () => {
    if (config.initialHash) {
      try { location.hash = config.initialHash; } catch {}
      try { document.getElementById(decodeURIComponent(config.initialHash.slice(1)))?.scrollIntoView(); } catch {}
    }
    send('ready', { title: document.title });
  }, { once: true });
}

function readSnapshot(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') return Object.create(null);
    return Object.assign(Object.create(null), Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === 'string')));
  } catch { return Object.create(null); }
}

/** Read a validated bundle for either isolated display or browser-local HTTP. */
export async function readDocumentBundle(input, options = {}) {
  const { records, name } = await collectFiles(input);
  const entries = records.filter(record => htmlPath(record.path)).map(record => ({ path: record.path, name: record.path.split('/').pop() }));
  entries.sort((a, b) => {
    const index = path => /(^|\/)index\.html?$/i.test(path) ? 0 : 1;
    return index(a.path) - index(b.path) || a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path);
  });
  if (!entries.length) throw new Error('HTMLファイルが見つかりません。拡張子が.htmlまたは.htmのファイルを選んでください。');
  const entryPath = options.entryPath || entries[0].path;
  const primary = records.find(record => record.path === entryPath && htmlPath(record.path));
  if (!primary) throw new Error('指定されたHTMLファイルが見つかりません。');
  const parsed = new DOMParser().parseFromString(decodeHtml(primary.bytes), 'text/html');
  return { records, name, entries, entryPath, primary, title: parsed.title.trim() || primary.path.split('/').pop(), documentKey: await contentKey(records) };
}

/** Prepare an isolated document. No uploaded files leave this browser. */
export async function prepareDocument(input, options = {}) {
  const { records, name, entries, entryPath, primary, documentKey } = await readDocumentBundle(input, options);
  const warningSet = new Set(), warn = value => warningSet.add(value);
  const paths = new Set(records.map(record => record.path));
  const assets = Object.create(null), cssRecords = new Map(), javascriptRecords = new Map();
  for (const record of records) {
    if (/\.css$/i.test(record.path)) cssRecords.set(record.path, decodeHtml(record.bytes));
    else if (/\.(?:m?js)$/i.test(record.path)) javascriptRecords.set(record.path, decodeHtml(record.bytes));
    else assets[record.path] = asDataUrl(record.bytes, mimeFor(record.path));
  }
  const pendingCss = new Set();
  const cssUrl = (value, from) => {
    const local = resolveVirtualPath(value, from);
    if (!local) return value;
    if (cssRecords.has(local.path)) buildCss(local.path);
    if (assets[local.path]) return assets[local.path] + local.hash;
    warn(`参照先「${local.path}」がありません。関連ファイルをZIPに含めてください。`);
    return 'data:application/octet-stream;base64,';
  };
  function rewriteCss(source, path) {
    return source.replace(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s)]+))\s*\)|@import\s+(?:"([^"\n]*)"|'([^'\n]*)')/gi,
      (match, double, single, bare, importDouble, importSingle) => {
        const value = double ?? single ?? bare ?? importDouble ?? importSingle;
        const resolved = cssUrl(value, path).replace(/"/g, '%22');
        return importDouble !== undefined || importSingle !== undefined ? `@import "${resolved}"` : `url("${resolved}")`;
      });
  }
  function buildCss(path) {
    if (assets[path]) return;
    if (pendingCss.has(path)) { warn(`CSS「${path}」の循環参照を省略しました。`); return; }
    pendingCss.add(path);
    assets[path] = textDataUrl(rewriteCss(cssRecords.get(path), path), 'text/css');
    pendingCss.delete(path);
  }
  for (const path of cssRecords.keys()) buildCss(path);
  for (const [path, source] of javascriptRecords) {
    // Identical scripts in different directories still need distinct URLs:
    // currentScript.src can be used to find resources next to that script.
    assets[path] = textDataUrl(`${rewriteModule(source, path, paths, warn)}\n//# sourceURL=${virtualUrl(path)}\n`, 'text/javascript');
  }
  const document = new DOMParser().parseFromString(decodeHtml(primary.bytes), 'text/html');
  const title = document.title.trim() || primary.path.split('/').pop();
  let externalBase = null;
  for (const base of document.querySelectorAll('base')) {
    const href = base.getAttribute('href');
    if (/^https?:\/\//i.test(href || '')) externalBase = href;
    base.remove();
  }
  // Imported CSPs describe their original host. They cannot describe injected data
  // assets/bridge. Remove just those meta directives; HTTP headers remain intact.
  for (const meta of document.querySelectorAll('meta[http-equiv]')) {
    if (/^(?:content-security-policy|content-security-policy-report-only|refresh)$/i.test(meta.getAttribute('http-equiv'))) meta.remove();
  }
  for (const meta of document.querySelectorAll('meta[charset]')) meta.setAttribute('charset', 'utf-8');
  if (!document.querySelector('meta[name="viewport" i]')) {
    const viewport = document.createElement('meta');
    viewport.name = 'viewport'; viewport.content = 'width=device-width, initial-scale=1';
    document.head.prepend(viewport);
  }
  const resolveAsset = (value, path = entryPath) => {
    const local = resolveVirtualPath(value, path);
    if (!local) return value;
    if (assets[local.path]) return assets[local.path] + local.hash;
    if (externalBase) { try { return new URL(value, externalBase).href; } catch {} }
    warn(`参照先「${local.path}」がありません。関連ファイルをZIPに含めてください。`);
    return 'about:blank#viewer-missing-resource';
  };
  const importMap = { imports: Object.create(null), scopes: Object.create(null) };
  for (const [path, url] of Object.entries(assets)) {
    if (/\.(?:m?js|json|css|wasm)$/i.test(path)) importMap.imports[virtualUrl(path)] = url;
  }
  const importKey = key => {
    if (/^(?:\.?\.?\/|\/|[a-z][\w+.-]*:)/i.test(key)) {
      try { return new URL(key, virtualUrl(entryPath)).href; } catch {}
    }
    return key;
  };
  function rewriteAliases(aliases) {
    const rewritten = Object.create(null);
    for (const [key, value] of Object.entries(aliases || {})) {
      const local = typeof value === 'string' ? resolveVirtualPath(value, entryPath) : null;
      if (key.endsWith('/') && typeof value === 'string' && value.endsWith('/') && local) {
        // data URLs cannot serve as URL-directory prefixes. Expand bundled
        // aliases (e.g. three/addons/ → ./jsm/) to concrete module mappings.
        let matches = 0;
        for (const [path, url] of Object.entries(assets)) {
          if (!path.startsWith(local.path)) continue;
          rewritten[importKey(key + path.slice(local.path.length))] = url;
          matches++;
        }
        if (!matches) warn(`import mapの参照先「${local.path}」にファイルがありません。`);
      } else rewritten[importKey(key)] = typeof value === 'string' ? resolveAsset(value) : value;
    }
    return rewritten;
  }
  for (const script of document.querySelectorAll('script[type="importmap"]')) {
    try {
      const original = JSON.parse(script.textContent);
      Object.assign(importMap.imports, rewriteAliases(original.imports));
      for (const [scope, aliases] of Object.entries(original.scopes || {})) {
        const rewritten = rewriteAliases(aliases), localScope = resolveVirtualPath(scope, entryPath);
        if (localScope) {
          // Inline modules use the virtual document URL. External modules have
          // concrete data URLs, so add each matching module as an exact scope.
          importMap.scopes[virtualUrl(localScope.path)] = rewritten;
          for (const path of javascriptRecords.keys()) {
            if (path === localScope.path || (localScope.path.endsWith('/') && path.startsWith(localScope.path))) {
              importMap.scopes[assets[path]] = rewritten;
            }
          }
        } else importMap.scopes[importKey(scope)] = rewritten;
      }
    } catch { warn('HTML内のimport mapを読み取れませんでした。'); }
    script.remove();
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of ['src', 'poster', 'data', 'background', 'xlink:href']) {
      if (element.hasAttribute(attribute)) element.setAttribute(attribute, resolveAsset(element.getAttribute(attribute)));
    }
    if (element.hasAttribute('href') && element.tagName !== 'A') element.setAttribute('href', resolveAsset(element.getAttribute('href')));
    if (element.hasAttribute('srcset')) {
      const input = element.getAttribute('srcset'), candidates = [];
      let position = 0;
      while (position < input.length) {
        while (/[\s,]/.test(input[position] || '') && position < input.length) position++;
        const start = position, data = input.slice(position, position + 5).toLowerCase() === 'data:';
        while (position < input.length && !/\s/.test(input[position]) && (data || input[position] !== ',')) position++;
        const rawUrl = input.slice(start, position), endedWithComma = rawUrl.endsWith(',');
        const url = rawUrl.replace(/,+$/, '');
        if (endedWithComma) { if (url) candidates.push(resolveAsset(url)); continue; }
        const descriptorStart = position;
        while (position < input.length && input[position] !== ',') position++;
        const descriptor = input.slice(descriptorStart, position).trim();
        if (url) candidates.push(`${resolveAsset(url)}${descriptor ? ' ' + descriptor : ''}`);
        position++;
      }
      element.setAttribute('srcset', candidates.join(', '));
    }
    if (element.hasAttribute('style')) element.setAttribute('style', rewriteCss(element.getAttribute('style'), entryPath));
    if (element.tagName === 'STYLE') element.textContent = rewriteCss(element.textContent, entryPath);
    if (element.tagName === 'SCRIPT') {
      if (element.getAttribute('type') === 'module' && !element.hasAttribute('src')) element.textContent = rewriteModule(element.textContent, entryPath, paths, warn);
      // SRI hashes refer to original bytes, which can change during URL rewriting.
      element.removeAttribute('integrity'); element.removeAttribute('crossorigin');
    }
    if (element.tagName === 'LINK') { element.removeAttribute('integrity'); element.removeAttribute('crossorigin'); }
  }
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  const token = [...tokenBytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const storageKey = STORAGE_PREFIX + documentKey;
  let durableStorage, temporaryStorage;
  try { durableStorage = globalThis.localStorage; } catch { warn('ブラウザの保存機能が無効です。ゲームの保存はこの表示中だけ保持されます。'); }
  try { temporaryStorage = globalThis.sessionStorage; } catch {}
  const snapshots = {
    localStorage: readSnapshot(durableStorage, storageKey),
    sessionStorage: readSnapshot(temporaryStorage, storageKey),
  };
  const base = document.createElement('base'); base.href = externalBase || virtualUrl(entryPath);
  const mapScript = document.createElement('script'); mapScript.type = 'importmap'; mapScript.textContent = safeJson(importMap);
  const bridge = document.createElement('script');
  const initialHash = typeof options.hash === 'string' && options.hash.startsWith('#') ? options.hash.slice(0, 1000) : '';
  bridge.textContent = `(${runtimeBootstrap.toString()})(${safeJson({ token, assets, storage: snapshots, entryPath, externalBase, initialHash, origin: VIRTUAL_ORIGIN, entries: entries.map(entry => entry.path) })});`;
  document.head.prepend(base, bridge, mapScript);
  const html = '<!doctype html>\n' + document.documentElement.outerHTML;
  let frame = null, handler = null, listener = null, disposed = false, quotaReported = false;
  const session = {
    html, title, name, documentKey, entryPath, entries, fileCount: records.length, warnings: [...warningSet],
    attach(iframe, onEvent = () => {}) {
      if (disposed) throw new Error('このViewerセッションは終了しています。');
      if (listener) window.removeEventListener('message', listener);
      frame = iframe; handler = onEvent;
      listener = event => {
        if (disposed || event.source !== frame.contentWindow || !event.data || event.data.viewerBridge !== token) return;
        const message = event.data;
        if (message.type === 'storage') {
          if (!['localStorage', 'sessionStorage'].includes(message.kind) || !['set', 'remove', 'clear'].includes(message.op)) return;
          const snapshot = snapshots[message.kind];
          if (message.op === 'clear') { for (const key of Object.keys(snapshot)) delete snapshot[key]; }
          else if (typeof message.key === 'string') {
            if (message.op === 'remove') delete snapshot[message.key];
            else if (typeof message.value === 'string' && message.key.length + message.value.length <= STORAGE_LIMIT) snapshot[message.key] = message.value;
            else return;
          } else return;
          try {
            const serialized = JSON.stringify(snapshot);
            if (serialized.length > STORAGE_LIMIT) throw new Error('quota');
            const target = message.kind === 'localStorage' ? durableStorage : temporaryStorage;
            if (!target) throw new Error('disabled');
            target.setItem(storageKey, serialized);
          } catch {
            if (!quotaReported) { handler({ type: 'storage-warning', message: 'ゲームの保存容量を超えたか、ブラウザの保存機能が無効です。' }); quotaReported = true; }
          }
          return;
        }
        if (message.type === 'navigate') {
          if (entries.some(entry => entry.path === message.entryPath)) handler({ type: 'navigate', entryPath: message.entryPath, hash: typeof message.hash === 'string' ? message.hash : '' });
        } else if (['ready', 'error', 'storage-warning'].includes(message.type)) {
          handler({ type: message.type, message: String(message.message || '').slice(0, 2500), title: String(message.title || '').slice(0, 300), stack: String(message.stack || '').slice(0, 2500), line: Number(message.line) || 0 });
        }
      };
      window.addEventListener('message', listener);
    },
    dispose() {
      disposed = true;
      if (listener) window.removeEventListener('message', listener);
      listener = null; frame = null; handler = null;
      // Assets are data URLs, so there are no parent-origin Blob URLs to revoke.
      session.html = '';
    },
  };
  return session;
}
