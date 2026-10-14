import { mkdir, writeFile } from 'node:fs/promises';
import { zipSync, strToU8 } from '../js/vendor/fflate.js';

// Generate on demand; binaries stay outside Git and the published site.
const bytes = new Uint8Array(33 * 1024 * 1024).fill(90);
bytes[0] = 49;
bytes[bytes.length - 1] = 121;
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Large File Check</title>
<style>body{background:#101418;color:#ceef84;font:16px sans-serif;padding:20px}button,a{display:block;margin:18px 0;padding:12px;font:inherit;color:inherit}button{background:#253022;border:1px solid #ceef84}canvas{max-width:100%;background:#253022}</style>
<h1>Large File Check</h1><p>33 MiB asset + HTML</p><canvas id="stage" width="280" height="100"></canvas>
<button id="play">タップしてスコアを増やす</button><p id="score">SCORE: 0</p>
<button id="check">33 MiBファイルを確認</button><p id="result">未確認</p><a href="next.html">次のページ</a>
<script>const ctx=document.querySelector('canvas').getContext('2d');let score=0;function draw(){ctx.fillStyle='#253022';ctx.fillRect(0,0,280,100);ctx.fillStyle='#ceef84';ctx.fillRect(20,25,Math.min(240,40+score*20),50)}draw();document.querySelector('#play').onclick=()=>{score++;document.querySelector('#score').textContent='SCORE: '+score;draw()};document.querySelector('#check').onclick=async()=>{try{const response=await fetch('./assets/payload.bin');const data=new Uint8Array(await response.arrayBuffer());document.querySelector('#result').textContent=data.length===34603008&&data[0]===49&&data[data.length-1]===121?'PAYLOAD PASS: 33 MiB':'PAYLOAD FAIL'}catch(error){document.querySelector('#result').textContent='ERROR: '+error.message}};<\/script>`;
const entries = {
  'index.html': strToU8(html),
  'next.html': strToU8('<!doctype html><meta charset="utf-8"><title>Large next page</title><h1>PAGE TWO PASS</h1><a href="index.html">最初のページへ</a>'),
  'assets/payload.bin': bytes,
};
await mkdir('tests/artifacts', { recursive: true });
for (const [name, level] of [['large-compressed.zip', 1], ['large-stored.zip', 0]]) {
  const zip = zipSync(entries, { level });
  await writeFile(`tests/artifacts/${name}`, zip);
  console.log(`${name}: ${zip.length} bytes; expanded > 33 MiB`);
}
