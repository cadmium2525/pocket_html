import { readZip, inspectZip, IMPORT_LIMITS, getImportLimits } from './zip.js';

const abortError = () => new DOMException('ZIPの展開を中止しました。', 'AbortError');
function checkAborted(signal) { if (signal?.aborted) throw abortError(); }

async function readyZipWorker(signal) {
  checkAborted(signal);
  if (typeof globalThis.Worker !== 'function') return null;
  let worker;
  try { worker = new Worker(new URL('./zip-worker.js', import.meta.url), { type: 'module', name: 'pocket-html-zip' }); }
  catch { return null; }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (ready, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      if (!ready) worker.terminate();
      error ? reject(error) : resolve(ready ? worker : null);
    };
    const onAbort = () => finish(false, abortError());
    const timeout = setTimeout(() => finish(false), 10000);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = event => { if (event.data?.type === 'ready') finish(true); };
    worker.onerror = event => { event.preventDefault(); finish(false); };
    worker.onmessageerror = () => finish(false);
    if (signal?.aborted) onAbort();
  });
}

/** Expand an archive using the same limits for the Viewer and ZIP file browser. */
export async function extractArchive(bytes, largeFiles = false, { signal } = {}) {
  checkAborted(signal);
  const limits = getImportLimits(largeFiles);
  if (limits === IMPORT_LIMITS) {
    const records = readZip(bytes, limits);
    checkAborted(signal);
    return records;
  }
  // Check the size and directory before starting a worker or allocating outputs.
  inspectZip(bytes, limits);
  const worker = await readyZipWorker(signal);
  if (signal?.aborted) {
    worker?.terminate();
    throw abortError();
  }
  if (!worker) {
    throw new Error('大容量ZIPの展開機能を起動できませんでした。ページを再読み込みするか、ZIPを32MB以下にして大容量モードをオフにしてください。');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, records) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      error ? reject(error) : resolve(records);
    };
    const onAbort = () => finish(abortError());
    const timeout = setTimeout(() => finish(new Error('ZIPの展開に時間がかかりすぎました。ファイルを小さくして開き直してください。')), 120000);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = event => {
      if (event.data?.type === 'result') finish(null, event.data.records);
      else if (event.data?.type === 'error') finish(new Error(event.data.message || 'ZIPを展開できませんでした。'));
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(new Error('ZIPの展開を続けられませんでした。ほかのアプリを閉じるか、ファイルを小さくして開き直してください。'));
    };
    worker.onmessageerror = () => finish(new Error('ZIPの展開結果を読み取れませんでした。'));
    if (signal?.aborted) { onAbort(); return; }
    try {
      // Transfer ownership instead of making a second copy of a large archive.
      worker.postMessage({ bytes, largeFiles: true }, [bytes.buffer]);
    } catch {
      finish(new Error('ZIPを展開するためのデータを渡せませんでした。開き直してください。'));
    }
  });
}

/** Read a ZIP without requiring an HTML entry. Check its size before allocation. */
export async function readZipFile(file, { largeFiles = false, signal } = {}) {
  checkAborted(signal);
  const limits = getImportLimits(largeFiles);
  if (file.size > limits.bytes) {
    const largerImportHint = limits === IMPORT_LIMITS ? ' 大きなファイルは「大容量モード」をオンにして開いてください。' : '';
    throw new Error(`ZIPは${limits.bytes / (1024 * 1024)}MB以下にしてください。${largerImportHint}`);
  }
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch (error) {
    checkAborted(signal);
    if (['AbortError', 'NotReadableError', 'NotFoundError'].includes(error?.name)) {
      throw new Error('ZIPの読み込みが中断されました。「ファイル」アプリでZIPを端末にダウンロードしてから、もう一度選んでください。');
    }
    throw error;
  }
  checkAborted(signal);
  return extractArchive(new Uint8Array(buffer), largeFiles, { signal });
}
