import { staticValue } from '/assets/chunks/static.js';

const resultList = document.getElementById('results');
const summary = document.getElementById('summary');
let successes = 0;
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, run) {
  const row = document.createElement('li');
  row.textContent = `RUN: ${name}`;
  resultList.append(row);
  try {
    await run();
    successes++;
    row.className = 'pass';
    row.textContent = `PASS: ${name}`;
  } catch (error) {
    failures++;
    row.className = 'fail';
    row.textContent = `FAIL: ${name} — ${error.message}`;
  }
}

function requestWorker(url, options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url, options);
    const timer = setTimeout(() => finish(new Error('Worker timeout')), 8000);
    function finish(error, value) {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(value);
    }
    worker.onmessage = ({ data }) => {
      if (data.error) finish(new Error(data.error));
      else finish(null, data);
    };
    worker.onerror = (event) => finish(new Error(event.message || 'Worker load failed'));
    worker.postMessage('run');
  });
}

function xhrJSON(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'json';
    xhr.timeout = 8000;
    xhr.onload = () => xhr.status === 200 ? resolve(xhr.response) : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error('XHR failed'));
    xhr.ontimeout = () => reject(new Error('XHR timeout'));
    xhr.send();
  });
}

function idbRoundtrip() {
  return new Promise((resolve, reject) => {
    const name = 'pocket-http-fixture';
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('checks');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('checks', 'readwrite');
      const store = tx.objectStore('checks');
      store.put(42, 'value');
      const request = store.get('value');
      let value;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('IDB transaction aborted')); };
    };
  });
}

const checks = [
  ['HTTP document URL', async () => {
    assert(location.protocol === 'http:' || location.protocol === 'https:', location.href);
    assert(location.origin !== 'null', 'opaque origin');
  }],
  ['Static root module', async () => assert(staticValue === 42, 'wrong module export')],
  ['Computed dynamic import', async () => {
    const chunkName = ['dy', 'namic'].join('');
    const path = './chunks/' + chunkName + '.js';
    const chunk = await import(path);
    assert(chunk.dynamicValue === 43, 'wrong dynamic export');
  }],
  ['Root CSS and image', async () => {
    assert(getComputedStyle(document.documentElement).getPropertyValue('--http-fixture-loaded').trim() === 'yes', 'CSS not loaded');
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth === 32 ? resolve() : reject(new Error('wrong image width'));
      image.onerror = () => reject(new Error('root image not loaded'));
      image.src = '/assets/pixel.svg';
    });
  }],
  ['Root fetch JSON and query', async () => {
    const response = await fetch('/assets/data.json?version=1');
    assert(response.status === 200, `HTTP ${response.status}`);
    assert(response.headers.get('Content-Type')?.includes('application/json'), 'incorrect JSON MIME');
    assert((await response.json()).value === 44, 'wrong JSON');
  }],
  ['import.meta.url relative fetch', async () => {
    const response = await fetch(new URL('./data.json', import.meta.url));
    assert((await response.json()).value === 44, 'wrong relative JSON');
  }],
  ['XHR root JSON', async () => assert((await xhrJSON('/assets/data.json')).value === 44, 'wrong XHR JSON')],
  ['WebAssembly.instantiateStreaming', async () => {
    const response = await fetch(new URL('./add.wasm', import.meta.url));
    assert(response.headers.get('Content-Type')?.includes('application/wasm'), 'incorrect WASM MIME');
    const { instance } = await WebAssembly.instantiateStreaming(response);
    assert(instance.exports.add(20, 22) === 42, 'wrong WASM result');
  }],
  ['Classic Worker importScripts and fetch', async () => {
    const result = await requestWorker(new URL('./workers/classic.js', import.meta.url));
    assert(result.value === 49, `wrong classic Worker result: ${result.value}`);
  }],
  ['Absolute Worker URL with build directory', async () => {
    const result = await requestWorker('/dist/assets/workers/classic.js');
    assert(result.value === 49, `wrong absolute Worker result: ${result.value}`);
  }],
  ['Module Worker imports and fetch', async () => {
    const result = await requestWorker(new URL('./workers/module.js', import.meta.url), { type: 'module' });
    assert(result.value === 57, `wrong module Worker result: ${result.value}`);
  }],
  ['Native IndexedDB save', async () => assert(await idbRoundtrip() === 42, 'wrong IndexedDB value')],
  ['Missing asset returns 404', async () => {
    const response = await fetch('./missing.json');
    assert(response.status === 404, `HTTP ${response.status}`);
  }],
];

await Promise.all(checks.map(([name, run]) => check(name, run)));
summary.textContent = `${failures ? 'FAIL' : 'PASS'}: ${successes} / ${checks.length} checks`;
summary.dataset.complete = 'true';

const saved = document.getElementById('saved');
const storageKey = 'pocket-http-fixture-saved';
saved.textContent = localStorage.getItem(storageKey) || '0';
document.getElementById('save').addEventListener('click', () => {
  const value = Number(saved.textContent) + 1;
  localStorage.setItem(storageKey, String(value));
  saved.textContent = String(value);
});
