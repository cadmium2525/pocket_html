import { prepareDocument } from './viewer-engine.js';
import { listRecent, saveRecent, readRecent, removeRecent } from './db.js';

const $ = selector => document.querySelector(selector);
const home = $('#home');
const player = $('#player');
const frameContainer = $('#frame-container');
const fileInput = $('#file-input');
const remember = $('#remember-files');
let activeSession = null;
let currentFiles = [];
let operation = 0;
let toastTimer;
let expanded = false;
let nativeFullscreen = false;
let diagnosticsCount = 0;
let errorCount = 0;
let sessionSaved = false;

try { remember.checked = localStorage.getItem('pocket-html-remember') !== 'false'; } catch { /* Storage is optional. */ }

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.toggle('is-error', isError);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, isError ? 7500 : 4500);
}

function setBusy(value, text = 'ファイルを準備中…') {
  $('#busy-text').textContent = text;
  $('#busy').hidden = !value;
}

function formatBytes(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const day = date.toDateString() === now.toDateString() ? '今日' : `${date.getMonth() + 1}/${date.getDate()}`;
  return `${day} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function addDiagnostic(message, type = 'info') {
  if (diagnosticsCount >= 40) return;
  const li = document.createElement('li');
  li.className = type;
  li.textContent = String(message).slice(0, 1600);
  $('#diagnostics').append(li);
  diagnosticsCount++;
  if (type === 'error' || type === 'warning') {
    errorCount++;
    $('#error-badge').hidden = false;
    $('#player-info').setAttribute('aria-label', `表示情報（通知${errorCount}件）`);
  }
}

function eventMessage(event) {
  return event.message || event.error || event.text || 'ページ内でエラーが発生しました。';
}

function onViewerEvent(session, event) {
  if (session !== activeSession) return;
  if (event.type === 'ready') {
    $('#player-meta').textContent = `${session.fileCount || 1}ファイル · 表示中`;
  } else if (event.type === 'error') {
    addDiagnostic(eventMessage(event), 'error');
  } else if (event.type === 'storage-warning' || event.type === 'warning') {
    addDiagnostic(eventMessage(event), 'warning');
  } else if (event.type === 'navigate') {
    void openFiles(currentFiles, { entryPath: event.entryPath, hash: event.hash, save: remember.checked && sessionSaved });
  }
}

async function refreshRecent() {
  try {
    const records = await listRecent();
    $('#recent-count').textContent = String(records.length);
    const list = $('#recent-list');
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-recent';
      empty.textContent = 'まだファイルがありません。開いたファイルはここから再開できます。';
      list.append(empty);
      return;
    }
    for (const record of records) {
      const card = document.createElement('div');
      card.className = 'recent-card';
      const open = document.createElement('button');
      open.className = 'recent-open';
      open.setAttribute('aria-label', `${record.name}を開く`);
      const fileIcon = document.createElement('span');
      fileIcon.className = 'recent-file-icon';
      fileIcon.append(icon('code'));
      const copy = document.createElement('span');
      copy.className = 'recent-copy';
      const title = document.createElement('span');
      title.className = 'recent-title';
      title.textContent = record.name;
      const meta = document.createElement('span');
      meta.className = 'recent-meta';
      meta.textContent = `${formatBytes(record.bytes)} · ${formatDate(record.openedAt)}`;
      copy.append(title, meta);
      open.append(fileIcon, copy);
      open.addEventListener('click', async () => {
        setBusy(true, '保存したファイルを開いています…');
        try {
          const saved = await readRecent(record.id);
          await openFiles(saved.files, { entryPath: saved.entryPath, save: remember.checked });
        } catch (error) { setBusy(false); showToast(error.message, true); }
      });
      const remove = document.createElement('button');
      remove.className = 'recent-remove';
      remove.setAttribute('aria-label', `${record.name}の履歴を削除`);
      remove.title = '保存したファイルを削除';
      remove.append(icon('trash'));
      remove.addEventListener('click', async () => {
        try { await removeRecent(record.id); await refreshRecent(); showToast('保存したファイルを削除しました。'); }
        catch { showToast('履歴を削除できませんでした。', true); }
      });
      card.append(open, remove);
      list.append(card);
    }
  } catch {
    $('#recent-list').replaceChildren();
    const note = document.createElement('p');
    note.className = 'empty-recent';
    note.textContent = 'このブラウザでは履歴を保存できません。ファイルを選んで開く機能は使えます。';
    $('#recent-list').append(note);
  }
}

async function openFiles(inputFiles, { entryPath, hash, save = remember.checked } = {}) {
  const files = Array.from(inputFiles);
  if (!files.length) { setBusy(false); return; }
  const ticket = ++operation;
  let nextSession;
  setBusy(true);
  try {
    nextSession = await prepareDocument(files, { entryPath, hash });
    if (ticket !== operation) { nextSession.dispose(); return; }
    const previousSession = activeSession;
    const wasSaved = sessionSaved && previousSession?.documentKey === nextSession.documentKey;
    activeSession = nextSession;
    currentFiles = files;
    sessionSaved = wasSaved;
    diagnosticsCount = 0;
    errorCount = 0;
    $('#diagnostics').replaceChildren();
    $('#error-badge').hidden = true;
    $('#player-info').setAttribute('aria-label', '表示情報');
    toggleDetails(false);
    $('#player-name').textContent = nextSession.name || files[0].name;
    $('#player-meta').textContent = `${nextSession.fileCount || files.length}ファイル · 読み込み中…`;
    $('#choose-entry').hidden = !nextSession.entries || nextSession.entries.length < 2;
    for (const warning of nextSession.warnings || []) addDiagnostic(typeof warning === 'string' ? warning : warning.message, 'warning');
    const iframe = document.createElement('iframe');
    iframe.title = nextSession.title || nextSession.name || 'HTMLファイルの表示';
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-modals allow-pointer-lock allow-downloads');
    iframe.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    nextSession.attach(iframe, event => onViewerEvent(nextSession, event));
    iframe.addEventListener('load', () => {
      if (activeSession === nextSession) $('#player-meta').textContent = `${nextSession.fileCount || 1}ファイル · 表示中`;
    });
    home.hidden = true;
    player.hidden = false;
    document.body.style.overflow = 'hidden';
    // Size the visible stage before the imported page measures its Canvas.
    frameContainer.replaceChildren(iframe);
    iframe.getBoundingClientRect();
    iframe.srcdoc = nextSession.html;
    previousSession?.dispose();
    document.title = `${nextSession.title || nextSession.name} — Pocket HTML`;
    setBusy(false);
    $('#close-player').focus({ preventScroll: true });
    if (save) {
      try {
        const saved = await saveRecent(files, nextSession);
        if (ticket === operation && activeSession === nextSession) {
          sessionSaved = saved;
          if (!saved) addDiagnostic('履歴には保存できませんでした。表示は引き続き利用できます。', 'warning');
        }
      } catch {
        if (ticket === operation && activeSession === nextSession) addDiagnostic('履歴に保存できませんでした。空き容量やブラウザの設定をご確認ください。', 'warning');
      }
      await refreshRecent();
    }
  } catch (error) {
    if (ticket !== operation) return;
    nextSession?.dispose();
    showToast(error.message || 'ファイルを開けませんでした。HTMLまたはZIPを選択してください。', true);
    setBusy(false);
  }
}

function toggleDetails(show = $('#player-details').hidden) {
  $('#player-details').hidden = !show;
  $('#player-info').setAttribute('aria-expanded', String(show));
}

function setExpanded(value) {
  expanded = value;
  document.body.classList.toggle('is-expanded', value);
  $('#exit-expanded').hidden = !value;
  if (value) $('#exit-expanded').focus({ preventScroll: true });
  else $('#expand-player').focus({ preventScroll: true });
}

async function expandPlayer() {
  setExpanded(true);
  // On phones, use the predictable page layout; native fullscreen varies by iOS.
  const desktop = matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)').matches;
  if (desktop && player.requestFullscreen && document.fullscreenEnabled) {
    try { await player.requestFullscreen(); nativeFullscreen = Boolean(document.fullscreenElement); }
    catch { /* The viewport-filling layout works when native fullscreen is unavailable. */ }
  }
}

async function exitExpanded() {
  nativeFullscreen = false;
  setExpanded(false);
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch { /* Keep the usable fallback UI. */ }
  }
}

async function closePlayer() {
  operation++;
  if (expanded) await exitExpanded();
  frameContainer.replaceChildren();
  activeSession?.dispose();
  activeSession = null;
  currentFiles = [];
  player.hidden = true;
  home.hidden = false;
  document.body.style.overflow = '';
  document.title = 'Pocket HTML — ファイルから、すぐに。';
  $('#open-file').focus({ preventScroll: true });
  await refreshRecent();
}

function chooseEntry() {
  if (!activeSession) return;
  const list = $('#entry-list');
  list.replaceChildren();
  for (const entry of activeSession.entries) {
    const button = document.createElement('button');
    button.className = 'entry-button';
    button.append(icon('file'), document.createTextNode(entry.path));
    button.setAttribute('aria-current', String(entry.path === activeSession.entryPath));
    button.addEventListener('click', () => {
      $('#entry-dialog').close();
      void openFiles(currentFiles, { entryPath: entry.path, save: remember.checked && sessionSaved });
    });
    list.append(button);
  }
  $('#entry-dialog').showModal();
}

$('#open-file').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) void openFiles(fileInput.files);
  fileInput.value = '';
});
$('#open-demo').addEventListener('click', async () => {
  setBusy(true, 'サンプルゲームを準備中…');
  try {
    const response = await fetch('./examples/orbit-catch.html');
    if (!response.ok) throw new Error('サンプルを読み込めませんでした。ネット接続をご確認ください。');
    const demo = new File([await response.blob()], 'orbit-catch.html', { type: 'text/html' });
    await openFiles([demo], { save: false });
  } catch (error) { setBusy(false); showToast(error.message, true); }
});
$('#close-player').addEventListener('click', () => void closePlayer());
$('#reload-player').addEventListener('click', () => {
  if (activeSession) void openFiles(currentFiles, { entryPath: activeSession.entryPath, save: false });
});
$('#expand-player').addEventListener('click', () => void expandPlayer());
$('#exit-expanded').addEventListener('click', () => void exitExpanded());
$('#choose-entry').addEventListener('click', chooseEntry);
$('#player-info').addEventListener('click', () => toggleDetails());
$('#close-details').addEventListener('click', () => toggleDetails(false));
document.addEventListener('fullscreenchange', () => {
  if (nativeFullscreen && !document.fullscreenElement) { nativeFullscreen = false; setExpanded(false); }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && expanded) void exitExpanded();
});
for (const button of document.querySelectorAll('[data-open-help]')) button.addEventListener('click', () => $('#help-dialog').showModal());
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
remember.addEventListener('change', () => {
  try { localStorage.setItem('pocket-html-remember', String(remember.checked)); } catch { /* Do not block file viewing. */ }
});

let dragDepth = 0;
const dropZone = $('#drop-zone');
dropZone.addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; dropZone.classList.add('is-dragging'); });
dropZone.addEventListener('dragover', event => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; });
dropZone.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropZone.classList.remove('is-dragging'); });
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('is-dragging');
  if (event.dataTransfer?.files.length) void openFiles(event.dataTransfer.files);
});
// Keep dropped files from navigating away when dropped just outside the target.
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => event.preventDefault());

void refreshRecent();
