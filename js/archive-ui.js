import { readZipFile } from './zip-reader.js?v=archive-layout-2';
import { IMPORT_LIMITS } from './zip.js';
import { createSelectedZip, downloadFileName, packageFileName, uniqueDownloadNames } from './archive-files.js';

const TYPES = {
  html: 'text/html', htm: 'text/html', txt: 'text/plain', md: 'text/plain', css: 'text/css',
  js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', zip: 'application/zip',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  mp4: 'video/mp4', webm: 'video/webm', csv: 'text/csv',
};
const formatBytes = value => value < 1024 ? `${value} B` : value < 1024 * 1024
  ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;

export function setupArchiveBrowser({ getLargeFiles, showToast }) {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#archive-dialog'), input = $('#archive-input'), list = $('#archive-list');
  const search = $('#archive-search'), packageButton = $('#archive-package');
  const shareButton = $('#archive-share'), downloadLink = $('#archive-download');
  let records = [], selected = new Set(), archiveName = '', readController;
  let ticket = 0, exportTicket = 0, exportWorker, exportTimer, readyUrl;
  let shareFiles = [];
  const fileCache = new Map();

  // Downloads can still be consuming the URL after a dialog or selection changes.
  function retireUrl(url) { if (url) setTimeout(() => URL.revokeObjectURL(url), 60000); }
  function invalidateExport() {
    exportTicket++;
    exportWorker?.terminate(); exportWorker = null;
    clearTimeout(exportTimer);
    retireUrl(readyUrl); readyUrl = null;
    downloadLink.hidden = true;
    downloadLink.removeAttribute('href');
    packageButton.hidden = false;
    packageButton.textContent = '選択分をZIPにする';
    packageButton.disabled = selected.size === 0;
    $('#archive-status').textContent = '一覧の「保存」で1件ずつ保存できます。複数ファイルは選択分をZIPにまとめられます。';
  }
  function getFile(record) {
    if (!fileCache.has(record.path)) {
      fileCache.set(record.path, new File([record.bytes], downloadFileName(record.path), {
        type: TYPES[record.path.split('.').pop().toLowerCase()] || 'application/octet-stream',
      }));
    }
    return fileCache.get(record.path);
  }
  function filteredRecords() {
    const query = search.value.trim().toLocaleLowerCase();
    return records.filter(record => record.path.toLocaleLowerCase().includes(query));
  }
  function updateSelection() {
    const chosen = records.filter(record => selected.has(record.path));
    const visible = filteredRecords();
    const bytes = chosen.reduce((sum, record) => sum + record.bytes.byteLength, 0);
    $('#archive-summary').textContent = `${visible.length}/${records.length}件表示 · ${chosen.length}件選択 · ${formatBytes(bytes)}`;
    packageButton.disabled = !chosen.length || Boolean(exportWorker);
    $('#archive-select-visible').disabled = !visible.length;
    $('#archive-clear').disabled = !selected.size;
    shareFiles = [];
    shareButton.hidden = typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function';
    if (!shareButton.hidden && chosen.length) {
      try {
        const names = uniqueDownloadNames(chosen.map(record => record.path));
        const files = chosen.map((record, index) => new File([getFile(record)], names[index], { type: getFile(record).type }));
        if (navigator.canShare({ files })) shareFiles = files;
      } catch { /* Unsupported file types keep the direct-download/ZIP routes. */ }
    }
    shareButton.disabled = shareFiles.length === 0;
    shareButton.title = shareFiles.length ? '共有先で「ファイルに保存」を選べます' : 'この選択は共有できません。一覧の保存かZIP保存を使ってください。';
  }
  function downloadRecord(record) {
    try {
      const url = URL.createObjectURL(getFile(record));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = downloadFileName(record.path);
      document.body.append(anchor); anchor.click(); anchor.remove();
      retireUrl(url);
      $('#archive-status').textContent = `「${anchor.download}」のダウンロードを開始しました。保存先はブラウザの設定をご確認ください。`;
    } catch { showToast('保存を開始できませんでした。共有かZIP保存もお試しください。', true); }
  }
  function renderList() {
    const fragment = document.createDocumentFragment();
    const visible = filteredRecords();
    for (const record of visible) {
      const row = document.createElement('li'); row.className = 'archive-row';
      const label = document.createElement('label');
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
      checkbox.checked = selected.has(record.path);
      checkbox.setAttribute('aria-label', `${record.path}を選択`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(record.path); else selected.delete(record.path);
        invalidateExport(); updateSelection();
        $('#archive-status').textContent = '一覧の「保存」で1件ずつ保存できます。複数ファイルは選択分をZIPにまとめられます。';
      });
      const copy = document.createElement('span'); copy.className = 'archive-file-copy';
      const path = document.createElement('span'); path.className = 'archive-file-path'; path.textContent = record.path;
      const size = document.createElement('span'); size.className = 'archive-file-size'; size.textContent = formatBytes(record.bytes.byteLength);
      copy.append(path, size); label.append(checkbox, copy);
      const save = document.createElement('button'); save.className = 'archive-save-file'; save.textContent = '保存';
      save.setAttribute('aria-label', `${record.path}を保存`);
      save.addEventListener('click', () => downloadRecord(record));
      row.append(label, save); fragment.append(row);
    }
    list.replaceChildren(fragment);
    list.hidden = visible.length === 0;
    $('#archive-empty').hidden = visible.length !== 0;
    updateSelection();
  }
  async function openArchive(file) {
    const current = ++ticket;
    readController?.abort();
    const controller = new AbortController(); readController = controller;
    selected.clear(); invalidateExport(); records = []; fileCache.clear(); shareFiles = [];
    archiveName = file.name; search.value = ''; list.replaceChildren();
    $('#archive-name').textContent = file.name;
    $('#archive-content').hidden = true; $('#archive-error').hidden = true;
    $('#archive-progress').hidden = false;
    if (!dialog.open) dialog.showModal();
    try {
      if (!/\.zip$/i.test(file.name)) throw new Error('ZIPファイルを選んでください。');
      const result = await readZipFile(file, { largeFiles: getLargeFiles(), signal: controller.signal });
      if (current !== ticket) return;
      if (!result.length) throw new Error('取り出せるファイルがありません。');
      records = result.sort((a, b) => a.path.localeCompare(b.path));
      $('#archive-content').hidden = false;
      $('#archive-status').textContent = '一覧の「保存」で1件ずつ保存できます。複数ファイルは選択分をZIPにまとめられます。';
      renderList();
    } catch (error) {
      if (current !== ticket || controller.signal.aborted) return;
      $('#archive-error').textContent = error?.message || 'ZIPを読み込めませんでした。もう一度ファイルを選んでください。';
      $('#archive-error').hidden = false;
    } finally {
      if (current === ticket) $('#archive-progress').hidden = true;
    }
  }

  function zipReady(bytes, version) {
    if (version !== exportTicket || !dialog.open) return;
    exportWorker?.terminate(); exportWorker = null; clearTimeout(exportTimer);
    readyUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    downloadLink.href = readyUrl; downloadLink.download = packageFileName(archiveName);
    downloadLink.hidden = false; packageButton.hidden = true;
    $('#archive-status').textContent = `保存用ZIP（${formatBytes(bytes.byteLength)}）を用意しました。「ZIPを保存」を押してください。フォルダー構成は元のままです。`;
  }
  function exportFailed(message, version) {
    if (version !== exportTicket || !dialog.open) return;
    invalidateExport(); updateSelection();
    $('#archive-status').textContent = message || 'ZIPを作成できませんでした。選択数を減らしてお試しください。';
  }
  packageButton.addEventListener('click', () => {
    const chosen = records.filter(record => selected.has(record.path));
    if (!chosen.length) return;
    invalidateExport();
    const version = exportTicket;
    packageButton.disabled = true; packageButton.textContent = 'ZIPを準備中…';
    $('#archive-status').textContent = '選択したファイルをまとめています…';
    const paths = chosen.map(record => record.path);
    if (typeof Worker !== 'function') {
      // Do not synchronously assemble a large archive on a constrained device.
      if (chosen.reduce((sum, record) => sum + record.bytes.byteLength, 0) > IMPORT_LIMITS.bytes) {
        exportFailed('大容量ZIPの作成機能を起動できません。一覧から1件ずつ保存するか、選択する量を減らしてください。', version);
      } else {
        try { zipReady(createSelectedZip(chosen, paths), version); }
        catch (error) { exportFailed(error.message, version); }
      }
      return;
    }
    try {
      exportWorker = new Worker(new URL('./archive-export-worker.js', import.meta.url), { type: 'module', name: 'pocket-html-export' });
      exportWorker.onmessage = event => {
        if (event.data.error) exportFailed(event.data.error, version);
        else {
          try { zipReady(event.data.bytes, version); }
          catch (error) { exportFailed(error.message, version); }
        }
      };
      exportWorker.onerror = event => { event.preventDefault(); exportFailed('ZIPを作成できませんでした。ページを開き直すか、1件ずつ保存してください。', version); };
      exportWorker.onmessageerror = () => exportFailed('保存用ZIPのデータを読み取れませんでした。', version);
      exportTimer = setTimeout(() => exportFailed('ZIPの作成に時間がかかりすぎました。選択数を減らしてください。', version), 120000);
      // Keep originals usable for subsequent individual saves. Only selected
      // files are copied to the worker; the ZIP result transfers back once.
      exportWorker.postMessage({ records: chosen, paths });
    } catch (error) { exportFailed(error.message, version); }
  });
  shareButton.addEventListener('click', async () => {
    if (!shareFiles.length) return;
    try {
      // File preparation is already complete; keep this call in the tap gesture.
      await navigator.share({ files: shareFiles });
      if (dialog.open) $('#archive-status').textContent = '選択したファイルを共有先に渡しました。';
    } catch (error) {
      if (error.name !== 'AbortError') showToast('この選択は共有できません。一覧の保存かZIP保存をご利用ください。', true);
    }
  });
  search.addEventListener('input', renderList);
  $('#archive-select-visible').addEventListener('click', () => {
    for (const record of filteredRecords()) selected.add(record.path);
    invalidateExport(); renderList();
  });
  $('#archive-clear').addEventListener('click', () => { selected.clear(); invalidateExport(); renderList(); });
  $('#open-archive').addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files[0]; input.value = '';
    if (file) void openArchive(file);
  });
  dialog.addEventListener('close', () => {
    ticket++; readController?.abort(); readController = null;
    selected.clear(); invalidateExport(); records = []; fileCache.clear(); shareFiles = [];
    list.replaceChildren();
  });
}
