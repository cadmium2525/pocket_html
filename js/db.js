const DB_NAME = 'pocket-html-files';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_HISTORY = 5;
let connection;

function openDatabase() {
  if (!globalThis.indexedDB) return Promise.reject(new Error('このブラウザではファイルの保存が利用できません。'));
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('保存データを開けません。ほかのタブを閉じてください。')); };
  });
  return connection;
}

async function transaction(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('ファイルの保存に失敗しました。'));
    const request = action(tx.objectStore('files'));
    if (request) request.onsuccess = () => { value = request.result; };
  });
}

export async function listRecent() {
  const records = await transaction('readonly', store => store.getAll());
  return records.sort((a, b) => b.openedAt - a.openedAt);
}

export async function saveRecent(files, session) {
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (bytes > MAX_BYTES) return false;
  const record = {
    id: session.documentKey, name: files.length === 1 ? files[0].name : session.name,
    title: session.title, bytes, openedAt: Date.now(), entryPath: session.entryPath,
    files: files.map(file => ({ name: file.webkitRelativePath || file.name, blob: file, type: file.type, lastModified: file.lastModified })),
  };
  await transaction('readwrite', store => store.put(record));
  const records = await listRecent();
  const stale = records.slice(MAX_HISTORY);
  if (stale.length) await transaction('readwrite', store => { stale.forEach(item => store.delete(item.id)); });
  return true;
}

export async function readRecent(id) {
  const record = await transaction('readonly', store => store.get(id));
  if (!record) throw new Error('保存済みのファイルが見つかりません。もう一度ファイルを選択してください。');
  const files = record.files.map(item => new File([item.blob], item.name, { type: item.type, lastModified: item.lastModified }));
  return { files, entryPath: record.entryPath };
}

export async function removeRecent(id) {
  await transaction('readwrite', store => store.delete(id));
}
