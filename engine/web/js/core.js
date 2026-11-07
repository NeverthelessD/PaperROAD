// PaperROAD 화면 — 공통 (엔진 요청 · 상태 · 파일 넣기 · 썸네일 · 알림)
// made by. Nevertheless_D
'use strict';

const PR = (window.PR = window.PR || {});
const T = new URLSearchParams(location.search).get('t') || '';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

// 맥 앱 껍데기(Swift)가 있으면 파일 고르기 · 폴더 고르기 창을 맥 방식으로 열어요
const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.paperroad;
PR.native = PR.native || null;
if (bridge || /PaperROADShell/.test(navigator.userAgent)) document.body.classList.add('native');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------- 엔진 요청

async function api(path, body, opts = {}) {
  const init = { method: body === undefined ? 'GET' : 'POST', headers: { 'x-token': T } };
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  }
  let res;
  for (let i = 0; i < 2; i++) {
    try { res = await fetch(path, init); break; } catch (e) {
      if (i === 1 || opts.noRetry) throw new Error('앱 엔진과 연결이 끊겼어요. 잠시 뒤 다시 시도해 주세요');
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  let data = {};
  try { data = await res.json(); } catch (e) { /* 내용 없음 */ }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || '문제가 생겼어요. 다시 시도해 주세요');
    err.status = res.status;
    throw err;
  }
  return data;
}

// 화면에서 생긴 오류는 엔진 기록(진단 정보)에 남겨요
const clientErrs = [];
function logClient(msg) {
  clientErrs.push(String(msg).slice(0, 500));
  clearTimeout(logClient.t);
  logClient.t = setTimeout(() => { const items = clientErrs.splice(0); api('/api/clientlog', { items }).catch(() => {}); }, 800);
}
window.addEventListener('error', (e) => logClient(`${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logClient('promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));

// ---------------------------------------------------------------- 상태

const S = (PR.S = {
  screen: 'home',
  files: {},           // id → 넣은 파일
  settings: { appearance: 'system', saveTo: 'beside', autoUpdate: true },
  update: null,
  recent: [],
});

const FILE_COLORS = ['#2C4BDB', '#E0A100', '#0F7A6F', '#B5179E', '#E8590C', '#5F3DC4', '#1971C2', '#2B8A3E'];
function fileColor(id) {
  const ids = Object.keys(S.files);
  const i = ids.indexOf(id);
  return FILE_COLORS[(i < 0 ? 0 : i) % FILE_COLORS.length];
}

function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  const mb = n / 1024 / 1024;
  return (mb < 10 ? mb.toFixed(1) : Math.round(mb)) + ' MB';
}

function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  if (s < 86400 * 7) return Math.floor(s / 86400) + '일 전';
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

// ---------------------------------------------------------------- 아이콘

const ICON = {
  merge: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h8l3 3v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"></path><path d="M5 7v12a2 2 0 0 0 2 2h9"></path></svg>',
  split: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"></path></svg>',
  rotate: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"></path><path d="M20 4v5h-5"></path></svg>',
  compress: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"></path></svg>',
  image: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><circle cx="9" cy="10" r="1.6"></circle><path d="M21 16l-5-5-8 8"></path></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"></path></svg>',
  plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>',
  save: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"></path></svg>',
  rot16: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"></path><path d="M20 4v5h-5"></path></svg>',
  trash16: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg>',
  grip: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"></circle><circle cx="15" cy="6" r="1.6"></circle><circle cx="9" cy="12" r="1.6"></circle><circle cx="15" cy="12" r="1.6"></circle><circle cx="9" cy="18" r="1.6"></circle><circle cx="15" cy="18" r="1.6"></circle></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"></path></svg>',
  chev: '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg>',
  upload: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"></path><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path></svg>',
  pdfdoc: '<svg width="30" height="36" viewBox="0 0 30 36" aria-hidden="true"><path d="M3 1h17l9 9v23a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" fill="var(--surface)" stroke="var(--faint)" stroke-width="1.5"></path><path d="M20 1v9h9" fill="none" stroke="var(--faint)" stroke-width="1.5"></path><rect x="0" y="20" width="22" height="11" rx="2.5" fill="var(--pdf)"></rect><text x="11" y="28.5" text-anchor="middle" font-size="7.5" font-weight="700" fill="#FFFFFF" font-family="IBM Plex Sans KR, sans-serif">PDF</text></svg>',
  folder: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2h8.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"></path></svg>',
  file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"></path><path d="M15 2v5h5"></path></svg>',
};
PR.ICON = ICON;

const fmt = {
  pdf: '<span class="fmt pdf">PDF</span>',
  jpg: '<span class="fmt img">JPG</span>',
  png: '<span class="fmt img">PNG</span>',
  heic: '<span class="fmt img">HEIC</span>',
};

// ---------------------------------------------------------------- 알림

function toast(msg, opts = {}) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (opts.error ? ' err' : '');
  el.innerHTML = `<div class="t">${esc(msg)}${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}</div>`;
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = opts.action.label;
    b.onclick = () => { opts.action.run(); el.remove(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), opts.ms || (opts.error ? 7000 : 6000));
  return el;
}
function toastErr(e) { toast(e && e.message ? e.message : String(e), { error: true }); }

// 오래 걸리는 일 (저장 · 변환) 동안 보여 주는 창
function busy(title) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<div class="progress" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="ph"><div class="spinner"></div><span class="tt">${esc(title)}</span></div><div class="bar"><i></i></div><div class="spacer"></div></div>`;
  document.body.appendChild(ov);
  const bar = $('.bar', ov);
  bar.hidden = true;
  return {
    set(text, frac) {
      $('.tt', ov).textContent = text;
      if (frac !== undefined) { bar.hidden = false; $('i', bar).style.width = Math.round(frac * 100) + '%'; }
    },
    cancelable(fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn sm'; b.textContent = '그만하기';
      b.onclick = () => { b.disabled = true; fn(); };
      $('.spacer', ov).replaceWith(b);
    },
    done() { ov.remove(); },
  };
}

function modal(html, opts = {}) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = html;
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey, true); opts.onClose && opts.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(ov);
  const first = ov.querySelector('button, input, select');
  first && first.focus();
  return { el: ov, close };
}

// 저장 결과 알림 + Finder 에서 보기
function savedToast(r) {
  $('#toasts').replaceChildren(); // 앞선 알림은 치우고 결과를 잘 보이게
  const what = r.folder ? `${r.name} 폴더에 ${r.count}개` : r.name;
  toast('저장했어요 · ' + what, {
    sub: r.dir ? `${r.dir} 폴더` : '',
    action: { label: 'Finder에서 보기', run: () => reveal(r.path) },
    ms: 9000,
  });
  PR.loadRecent && PR.loadRecent();
}

async function reveal(path) {
  try { await api('/api/reveal', { path }); } catch (e) { toastErr(e); }
}

// ---------------------------------------------------------------- 파일 넣기

function addItems(res) {
  for (const it of res.items || []) S.files[it.id] = it;
  if (res.errors && res.errors.length) {
    const e = res.errors[0];
    toast(`${e.name}: ${e.error}`, { error: true, sub: res.errors.length > 1 ? `외 ${res.errors.length - 1}개 파일도 넣지 못했어요` : '' });
  }
  return res.items || [];
}

async function openPaths(paths) {
  if (!paths || !paths.length) return [];
  try { return addItems(await api('/api/open', { paths })); } catch (e) { toastErr(e); return []; }
}

async function uploadFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return [];
  const fd = new FormData();
  for (const f of list) fd.append('files', f, f.name);
  const b = list.length > 1 || list[0].size > 5e6 ? busy('파일을 넣는 중…') : null;
  try { return addItems(await api('/api/upload', fd)); } catch (e) { toastErr(e); return []; } finally { b && b.done(); }
}

// kind: pdf | image | any
async function pickFiles(kind = 'any', multiple = true) {
  if (bridge) {
    try {
      const r = await bridge.postMessage({ type: 'pickFiles', kind, multiple });
      return openPaths(r && r.paths);
    } catch (e) { toastErr(e); return []; }
  }
  try {
    const r = await api('/api/pick', { kind, multiple }, { noRetry: true });
    return addItems(r);
  } catch (e) {
    if (e.status !== 501) { toastErr(e); return []; }
  }
  // 브라우저에서 시험할 때: 파일 올리기
  return new Promise((resolve) => {
    const inp = $('#fileInput');
    inp.value = '';
    inp.multiple = multiple;
    inp.accept = kind === 'pdf' ? 'application/pdf,.pdf' : kind === 'image' ? 'image/*,.heic,.heif' : 'application/pdf,.pdf,image/*,.heic,.heif';
    inp.onchange = async () => resolve(await uploadFiles(inp.files));
    inp.click();
  });
}

// 저장 위치가 '매번 물어보기'면 폴더를 먼저 물어봐요. 취소하면 null
async function askDir(item) {
  if (S.settings.saveTo !== 'ask') return '';
  let path = '';
  if (bridge) {
    try {
      const r = await bridge.postMessage({ type: 'chooseFolder', start: item && item.dir || '' });
      path = r && r.path;
    } catch (e) { toastErr(e); return null; }
  } else {
    try { path = (await api('/api/choose-folder', {})).path; } catch (e) { toastErr(e); return null; }
  }
  return path || null;
}

// 끌어 놓기: 맥 앱은 껍데기가 경로를 알려 주고(PR.native('drop')), 브라우저에서는 파일을 올려요
let dropHoverEl = null;
function setDropHover(el) {
  if (dropHoverEl === el) return;
  dropHoverEl && dropHoverEl.classList.remove('drop-hover');
  dropHoverEl = el;
  el && el.classList.add('drop-hover');
}
function dropTargetAt(x, y) {
  if (x === undefined) return null;
  const el = document.elementFromPoint(x, y);
  return el && el.closest('[data-drop]');
}

PR.native = (name, data) => {
  if (name === 'dragOver') {
    $('#dropveil').classList.toggle('on', !!data.on);
    setDropHover(data.on ? dropTargetAt(data.x, data.y) : null);
  } else if (name === 'drop') {
    const target = dropTargetAt(data.x, data.y);
    setDropHover(null);
    $('#dropveil').classList.remove('on');
    openPaths(data.paths).then((items) => items.length && PR.onDrop(items, target));
  } else if (name === 'menu') {
    PR.onMenu && PR.onMenu(data.action);
  }
};

let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; $('#dropveil').classList.add('on'); });
document.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; $('#dropveil').classList.remove('on'); setDropHover(null); } });
document.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  setDropHover(dropTargetAt(e.clientX, e.clientY));
});
document.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropveil').classList.remove('on');
  const target = dropTargetAt(e.clientX, e.clientY);
  setDropHover(null);
  const items = await uploadFiles(e.dataTransfer.files);
  if (items.length) PR.onDrop(items, target);
});

// ---------------------------------------------------------------- 썸네일 (pdf.js 로 그려서 그림으로 기억)

let pdfjsP = null;
function pdfjs() {
  pdfjsP ||= import('/vendor/pdfjs/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    return m;
  });
  return pdfjsP;
}
const docCache = new Map();
function pdfDoc(id) {
  if (!docCache.has(id)) {
    const url = `/api/file?id=${encodeURIComponent(id)}&t=${encodeURIComponent(T)}`;
    docCache.set(id, pdfjs().then((m) => m.getDocument({ url, cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', isEvalSupported: false }).promise));
  }
  return docCache.get(id);
}

const thumbCache = new Map(); // key → objectURL
const thumbQueue = [];
const queued = new Set();
let thumbRunning = 0;

function thumbKey(id, p, r) { return `${id}:${p}:${r || 0}`; }

// 썸네일이 있으면 주소를, 없으면 null 을 주고 만들기 시작해요 (다 되면 data-th 가 같은 <img> 를 채워요)
function thumb(id, p = 1, r = 0) {
  const key = thumbKey(id, p, r);
  if (thumbCache.has(key)) return thumbCache.get(key);
  if (!queued.has(key)) {
    queued.add(key);
    thumbQueue.push({ key, id, p, r });
    pumpThumbs();
  }
  return null;
}

// 화면에 보일 때만 썸네일을 만들어요 (쪽이 많은 PDF 도 가볍게)
function thumbImg(id, p, r, alt = '') {
  const key = thumbKey(id, p, r);
  const url = thumbCache.get(key);
  return `<img data-th="${esc(key)}" data-id="${esc(id)}" data-p="${p}" data-r="${r || 0}" alt="${esc(alt)}" draggable="false"${url ? ` src="${url}"` : ' hidden'}>${url ? '' : '<i class="ph" aria-hidden="true"></i>'}`;
}

// 숨겨 둔 <img> 는 화면에 '보이지' 않아서, 그 그림을 담은 칸(부모)이 보이는지를 지켜봐요
const thumbObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    thumbObserver.unobserve(en.target);
    for (const img of $$('img[data-th][hidden]', en.target)) {
      const d = img.dataset;
      thumb(d.id, +d.p, +d.r);
    }
  }
}, { rootMargin: '400px 0px' });

function observeThumbs(root = document) {
  for (const img of $$('img[data-th][hidden]', root)) img.parentElement && thumbObserver.observe(img.parentElement);
}

function pumpThumbs() {
  while (thumbRunning < 2 && thumbQueue.length) {
    const job = thumbQueue.shift();
    thumbRunning++;
    makeThumb(job).then((url) => {
      thumbCache.set(job.key, url);
      for (const img of $$(`img[data-th="${CSS.escape(job.key)}"]`)) {
        img.src = url;
        img.hidden = false;
        const ph = img.nextElementSibling;
        if (ph && ph.classList.contains('ph')) ph.remove();
      }
    }).catch((e) => {
      logClient('thumb ' + job.key + ': ' + (e && e.message));
    }).finally(() => {
      thumbRunning--;
      queued.delete(job.key);
      pumpThumbs();
    });
  }
}

const THUMB_PX = 360;

async function makeThumb({ id, p, r }) {
  const it = S.files[id];
  if (!it) throw new Error('no file');
  let canvas;
  if (it.kind === 'pdf') {
    const doc = await pdfDoc(id);
    const page = await doc.getPage(p);
    const rot = ((page.rotate || 0) + (r || 0)) % 360;
    const vp1 = page.getViewport({ scale: 1, rotation: rot });
    const scale = THUMB_PX / Math.max(vp1.width, vp1.height);
    const vp = page.getViewport({ scale, rotation: rot });
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } else {
    const img = await loadImage(`/api/file?id=${encodeURIComponent(id)}&t=${encodeURIComponent(T)}`);
    canvas = drawRotated(img, r, 480);
  }
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.86));
  return URL.createObjectURL(blob);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('그림을 읽지 못했어요'));
    img.src = src;
  });
}

function drawRotated(img, r, maxPx) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const sc = Math.min(1, maxPx / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
  const side = r === 90 || r === 270;
  const c = document.createElement('canvas');
  c.width = side ? h : w;
  c.height = side ? w : h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(((r || 0) * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

// PDF 한 쪽을 그림 파일로 (JPG · PNG) — dpi 150 = 보통, 300 = 선명
async function renderPage(id, p, dpi, type) {
  const doc = await pdfDoc(id);
  const page = await doc.getPage(p);
  const rot = (page.rotate || 0) % 360;
  let scale = dpi / 72;
  const vp1 = page.getViewport({ scale, rotation: rot });
  const MAXSIDE = 6000;
  if (Math.max(vp1.width, vp1.height) > MAXSIDE) scale *= MAXSIDE / Math.max(vp1.width, vp1.height);
  const vp = page.getViewport({ scale, rotation: rot });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const blob = await new Promise((res) => canvas.toBlob(res, type === 'png' ? 'image/png' : 'image/jpeg', 0.92));
  canvas.width = canvas.height = 0; // 메모리 바로 돌려주기
  page.cleanup();
  return blob;
}

// 페이지를 그림으로 바꿔 저장 (분할 화면의 JPG · 변환 화면의 PDF → 이미지)
async function exportImages(item, pages, { ext = 'jpg', dpi = 150, task = 'toimg' } = {}) {
  const dir = await askDir(item);
  if (dir === null) return;
  const b = busy(`${pages.length}쪽을 ${ext.toUpperCase()}로 바꾸는 중…`);
  let job = null, canceled = false;
  b.cancelable(() => { canceled = true; });
  try {
    job = (await api('/api/images/begin', { id: item.id, ext, count: pages.length, task, dir })).job;
    for (let i = 0; i < pages.length; i++) {
      if (canceled) break;
      b.set(`${pages[i]}쪽을 바꾸는 중… (${i + 1}/${pages.length})`, i / pages.length);
      const blob = await renderPage(item.id, pages[i], dpi, ext);
      await api(`/api/images/put?job=${job}&p=${pages[i]}`, blob);
    }
    if (canceled) {
      await api('/api/images/end', { job, cancel: true });
      toast('그만했어요. 만들던 그림은 지웠어요');
      return;
    }
    b.set('마무리하는 중…', 1);
    savedToast(await api('/api/images/end', { job }));
  } catch (e) {
    if (job) api('/api/images/end', { job, cancel: true }).catch(() => {});
    toastErr(e);
  } finally {
    b.done();
  }
}

Object.assign(PR, { api, esc, $, $$, toast, toastErr, busy, modal, savedToast, reveal, pickFiles, openPaths, uploadFiles, askDir,
  thumb, thumbImg, observeThumbs, pdfDoc, exportImages, fmtSize, ago, fileColor, fmt, logClient, bridge });
