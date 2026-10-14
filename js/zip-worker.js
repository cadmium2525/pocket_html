import { readZip, getImportLimits } from './zip.js';

// One extraction per worker. The caller terminates it on success or failure.
self.onmessage = event => {
  try {
    const records = readZip(event.data.bytes, getImportLimits(event.data.largeFiles));
    self.postMessage({ type: 'result', records }, records.map(record => record.bytes.buffer));
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'ZIPを展開できませんでした。' });
  }
};
self.postMessage({ type: 'ready' });
