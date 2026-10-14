import { value } from './modules/value.js';
import { value as aliased } from 'pkg/tools/value.js';
report('Static module', value === 42 ? 'PASS' : 'FAIL');
report('Directory import alias', aliased === 42 ? 'PASS' : 'FAIL');
const dynamic = await import('./modules/dynamic.js');
report('Dynamic module', dynamic.value === 43 ? 'PASS' : 'FAIL');
const data = await (await fetch(new URL('./assets/data.json', import.meta.url))).json();
report('fetch JSON', data.hello === '日本語' ? 'PASS' : 'FAIL');
const relative = await (await fetch('./assets/data.json')).json();
report('Relative fetch', relative.hello === '日本語' ? 'PASS' : 'FAIL');
const xhr = new XMLHttpRequest();
xhr.open('GET', './assets/data.json');
xhr.onload = () => report('XHR JSON', JSON.parse(xhr.responseText).hello === '日本語' ? 'PASS' : 'FAIL');
xhr.send();
const image = new Image();
image.onload = () => {
  report('Dynamic image', image.naturalWidth === 1 ? 'PASS' : 'FAIL');
  const gl = document.querySelector('#texture').getContext('webgl');
  if (!gl) { report('WebGL texture', 'UNAVAILABLE'); return; }
  try {
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    const error = gl.getError();
    report('WebGL texture', error === gl.NO_ERROR ? 'PASS' : `FAIL (${error})`);
  } catch (error) { report('WebGL texture', error.message); }
};
image.src = './assets/pixel.png';
