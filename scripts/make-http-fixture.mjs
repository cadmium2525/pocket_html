import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { zipSync } from '../js/vendor/fflate.js';

// (module (func (export "add") (param i32 i32) (result i32)
//   local.get 0 local.get 1 i32.add))
const wasm = Uint8Array.from([
  0, 97, 115, 109, 1, 0, 0, 0,
  1, 7, 1, 96, 2, 127, 127, 1, 127,
  3, 2, 1, 0,
  7, 7, 1, 3, 97, 100, 100, 0, 0,
  10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11,
]);
const instance = await WebAssembly.instantiate(wasm);
if (instance.instance.exports.add(20, 22) !== 42) throw new Error('Invalid fixture WASM');

const base = resolve('tests/fixtures/http-bundle');
await writeFile(resolve(base, 'assets/add.wasm'), wasm);
const files = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files['dist/' + relative(base, path).replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}
await collect(base);
await mkdir('tests/artifacts', { recursive: true });
await writeFile('tests/artifacts/http-bundle.zip', zipSync(files));
console.log(`Created tests/artifacts/http-bundle.zip (${Object.keys(files).length} files)`);
