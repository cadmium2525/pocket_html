import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// GitHub Pages only needs these public files. No compilation or dependencies.
const root = resolve(process.cwd());
const destination = resolve(root, 'dist');
await mkdir(destination, { recursive: true });
for (const name of ['index.html', 'styles.css', 'icon.svg', 'manifest.webmanifest', 'http-sw.js', '.nojekyll', 'THIRD_PARTY_LICENSES.txt', 'js', 'examples']) {
  await cp(resolve(root, name), resolve(destination, name), { recursive: true });
}
console.log('GitHub Pages files prepared in dist/');
