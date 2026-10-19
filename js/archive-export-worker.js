import { createSelectedZip } from './archive-files.js';

self.onmessage = event => {
  try {
    const bytes = createSelectedZip(event.data.records, event.data.paths);
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error?.message || '保存用ZIPを作成できませんでした。' });
  }
};
