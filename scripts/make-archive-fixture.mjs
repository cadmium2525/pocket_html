import { mkdir, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from '../js/vendor/fflate.js';

await mkdir('tests/artifacts', { recursive: true });
const files = {
  '資料/説明.txt': strToU8('ZIP取り出しテスト\n日本語の内容をそのまま保存。\n'),
  'data/sample.bin': new Uint8Array([0, 255, 10, 0, 127, 64]),
  'one/same.txt': strToU8('first folder'),
  'two/same.txt': strToU8('second folder'),
  'empty.txt': new Uint8Array(),
};
await writeFile('tests/artifacts/archive-files.ZIP', zipSync(files));
await writeFile('tests/artifacts/archive-empty.zip', zipSync({}));
await writeFile('tests/artifacts/archive-invalid.zip', 'not a ZIP');
console.log('Archive file-browser fixtures prepared in tests/artifacts/');
