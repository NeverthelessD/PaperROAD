// PaperROAD 화면 — 누르기 · 끌기 · 단축키 · 시작
// made by. Nevertheless_D
'use strict';

// ---------------------------------------------------------------- 파일을 떨어뜨렸을 때

PR.onDrop = (items, target) => {
  const where = target && target.dataset.drop;
  if (S.screen === 'home') {
    if (where && PR.TASKS[where]) return PR.go(where, items);
    const pdfs = items.filter((i) => i.kind === 'pdf');
    if (!pdfs.length) return PR.go('img2pdf', items); // 사진만 → 바로 이미지 → PDF
    return PR.chooseTask(items);
  }
  addToScreen(items);
};

function addToScreen(items) {
  switch (S.screen) {
    case 'merge': PR.mergeAdd(items); break;
    case 'split': PR.setSplitFile(items); PR.render(); break;
    case 'convert': PR.setConvertFile(items); PR.render(); break;
    case 'img2pdf': PR.imgAdd(items); break;
    default: PR.chooseTask(items);
  }
}

async function pickForScreen() {
  const kind = S.screen === 'img2pdf' ? 'image' : 'pdf';
  const multiple = S.screen === 'merge' || S.screen === 'img2pdf';
  const items = await PR.pickFiles(kind, multiple);
  if (items.length) addToScreen(items);
}

PR.onMenu = (action) => {
  if (action === 'open') {
    if (S.screen === 'home') PR.pickFiles('any', true).then((items) => items.length && PR.onDrop(items, null));
    else pickForScreen();
  } else if (action === 'settings') PR.openSettings();
  else if (action === 'home') PR.go('home');
};

// ---------------------------------------------------------------- 누르기
// (view 는 screens.js 에 있어요)

view.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act;
  const M = PR.M, SP = PR.SP, CV = PR.CV, IP = PR.IP;
  switch (act) {
    case 'home': PR.go('home'); PR.loadRecent(); break;
    case 'task': PR.go(b.dataset.task); break;
    case 'pick': pickForScreen(); break;
    case 'pick-any': {
      const items = await PR.pickFiles('any', true);
      if (items.length) PR.onDrop(items, null);
      break;
    }
    case 'reveal': PR.reveal(b.dataset.path); break;
    case 'restart': PR.restartApp(); break;
    case 'install': PR.installUpdate(); break;

    // 합치기
    case 'sel-page': {
      const k = b.dataset.k;
      if (e.metaKey || e.ctrlKey) {
        M.sel.has(k) ? M.sel.delete(k) : M.sel.add(k);
      } else if (e.shiftKey && M.anchor) {
        const ks = M.pages.map((p) => p.k);
        const [a, z] = [ks.indexOf(M.anchor), ks.indexOf(k)].sort((x, y) => x - y);
        if (a >= 0) for (let i = a; i <= z; i++) M.sel.add(ks[i]);
      } else if (M.sel.size === 1 && M.sel.has(k)) {
        M.sel.clear();
      } else {
        M.sel = new Set([k]);
      }
      M.anchor = M.sel.has(k) ? k : null;
      PR.render();
      break;
    }
    case 'sel-none': M.sel.clear(); PR.render(); break;
    case 'rotate': PR.mergeRotate([...M.sel]); break;
    case 'delete': PR.mergeDelete([...M.sel]); break;
    case 'remove-file': PR.mergeRemoveFile(b.dataset.id); break;
    case 'clear-all': PR.clearAll(); break;
    case 'unload': PR.unloadCurrent(); break;
    case 'save': PR.mergeSave(); break;

    // 분할
    case 'toggle-page': {
      const p = +b.dataset.p;
      if (SP.mode === 'jpg' && SP.scope === 'all') { SP.scope = 'picked'; SP.sel = new Set([p]); }
      else {
        SP.sel.has(p) ? SP.sel.delete(p) : SP.sel.add(p);
        if (SP.mode === 'every' || SP.mode === 'range') SP.mode = 'pick';
      }
      PR.render();
      break;
    }
    case 'sel-all': {
      const it = S.files[SP.id];
      SP.sel = new Set(Array.from({ length: it.pages }, (_, i) => i + 1));
      if (SP.mode === 'every' || SP.mode === 'range') SP.mode = 'pick';
      if (SP.mode === 'jpg') SP.scope = 'picked';
      PR.render();
      break;
    }
    case 'sel-clear': SP.sel.clear(); if (SP.mode === 'jpg') SP.scope = 'picked'; PR.render(); break;
    case 'split-mode': SP.mode = b.dataset.mode; PR.render(); break;
    case 'split-scope': SP.scope = b.dataset.scope; PR.render(); break;
    case 'split-save': PR.splitSave(); break;

    // 압축 · 변환
    case 'cv-tab': CV.tab = b.dataset.tab; PR.render(); break;
    case 'cv-level': CV.level = b.dataset.level; PR.render(); break;
    case 'cv-compress': PR.compressSave(); break;
    case 'cv-toimg': PR.toImages(); break;

    // 이미지 → PDF
    case 'sel-photo': IP.sel = IP.sel === b.dataset.k ? null : b.dataset.k; PR.render(); break;
    case 'photo-rotate': {
      const x = IP.items.find((i) => i.k === b.dataset.k);
      if (x) { x.r = (x.r + 90) % 360; PR.render(); }
      break;
    }
    case 'photo-remove': PR.imgRemove([b.dataset.k]); break;
    case 'ip-opt': IP[b.dataset.key] = b.dataset.val; PR.render(); break;
    case 'ip-save': PR.imgSave(); break;
  }
});

// 글자 · 선택 칸은 다시 그리지 않고 상태만 바꿔요 (입력 중 커서가 튀지 않게)
view.addEventListener('input', (e) => {
  const f = e.target.dataset.field;
  if (!f) return;
  const v = e.target.value;
  if (f === 'every') { PR.SP.every = v; PR.refreshSplitSummary(); }
  else if (f === 'ranges') { PR.SP.ranges = v; PR.refreshSplitSummary(); }
  else if (f === 'cv-pages') PR.CV.pages = v;
  else if (f === 'ip-name') PR.IP.name = v;
});
view.addEventListener('change', (e) => {
  const f = e.target.dataset.field;
  if (f === 'dpi') PR.SP.dpi = +e.target.value;
  else if (f === 'cv-ext') PR.CV.ext = e.target.value;
  else if (f === 'cv-dpi') PR.CV.dpi = +e.target.value;
});

$('#settingsBtn').addEventListener('click', () => PR.openSettings());

// ---------------------------------------------------------------- 단축키

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.overlay')) return;
  const typing = e.target.closest && e.target.closest('input, select, textarea');
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.key === ',') { e.preventDefault(); PR.openSettings(); return; }
  if (cmd && (e.key === 'o' || e.key === 'O')) { e.preventDefault(); PR.onMenu('open'); return; }
  if (typing) return;
  // ⌫ = 뒤로 가기 (ROAD 앱 공통). 고른 것이 있으면 ⌫ 는 원래대로 '지우기'가 먼저예요.
  if (e.key === 'Backspace' && !cmd && !e.altKey && !e.isComposing && S.screen !== 'home' && !(S.screen === 'merge' && PR.M.sel.size) && !(S.screen === 'img2pdf' && PR.IP.sel)) {
    e.preventDefault(); PR.go('home'); PR.loadRecent(); return;
  }
  if (cmd && e.key === '[') { e.preventDefault(); if (S.screen !== 'home') { PR.go('home'); PR.loadRecent(); } return; }
  if (S.screen === 'merge') {
    const M = PR.M;
    if (cmd && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); PR.mergeUndo(); }
    else if (cmd && e.key === 'a') { e.preventDefault(); M.sel = new Set(M.pages.map((p) => p.k)); M.anchor = null; PR.render(); }
    else if ((e.key === 'Backspace' || e.key === 'Delete') && M.sel.size) { e.preventDefault(); PR.mergeDelete([...M.sel]); }
    else if ((e.key === 'r' || e.key === 'R') && !cmd && M.sel.size) { e.preventDefault(); PR.mergeRotate([...M.sel]); }
    else if (e.key === 'Escape' && M.sel.size) { M.sel.clear(); PR.render(); }
  } else if (S.screen === 'split') {
    if (cmd && e.key === 'a') { e.preventDefault(); view.querySelector('[data-act="sel-all"]')?.click(); }
    else if (e.key === 'Escape') view.querySelector('[data-act="sel-clear"]')?.click();
  } else if (S.screen === 'img2pdf') {
    const IP = PR.IP;
    if ((e.key === 'Backspace' || e.key === 'Delete') && IP.sel) { e.preventDefault(); PR.imgRemove([IP.sel]); }
    else if ((e.key === 'r' || e.key === 'R') && !cmd && IP.sel) { const x = IP.items.find((i) => i.k === IP.sel); if (x) { x.r = (x.r + 90) % 360; PR.render(); } }
  }
});

// ---------------------------------------------------------------- 끌어서 순서 바꾸기 (페이지 · 사진 · 파일)

let drag = null; // { type: 'page'|'photo'|'file', keys: [...] }

function clearMarks() {
  for (const el of $$('.drop-before, .drop-after', view)) el.classList.remove('drop-before', 'drop-after');
}

view.addEventListener('dragstart', (e) => {
  const page = e.target.closest('[data-act="sel-page"]');
  const photo = e.target.closest('[data-act="sel-photo"]');
  const file = e.target.closest('[data-file]');
  if (page) {
    const k = page.dataset.k;
    const keys = PR.M.sel.has(k) ? PR.M.pages.filter((p) => PR.M.sel.has(p.k)).map((p) => p.k) : [k];
    drag = { type: 'page', keys };
  } else if (photo) {
    drag = { type: 'photo', keys: [photo.dataset.k] };
  } else if (file) {
    drag = { type: 'file', keys: [file.dataset.file] };
  } else return;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-paperroad', drag.type);
  requestAnimationFrame(() => {
    for (const k of drag ? drag.keys : []) {
      const t = drag.type === 'page' ? view.querySelector(`[data-pg="${k}"]`) : drag.type === 'photo' ? view.querySelector(`[data-ph="${k}"]`) : null;
      t && t.classList.add('dragging');
    }
  });
});

function dropSpot(e) {
  if (!drag) return null;
  if (drag.type === 'file') {
    const card = e.target.closest('[data-file]');
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { el: card, after: e.clientY > r.top + r.height / 2, key: card.dataset.file };
  }
  const attr = drag.type === 'page' ? 'data-pg' : 'data-ph';
  let tile = e.target.closest(`[${attr}]`);
  if (!tile) {
    // 타일 사이 빈 곳: 가장 가까운 타일
    const tiles = $$(`[${attr}]`, view);
    let best = null, bd = Infinity;
    for (const t of tiles) {
      const r = t.getBoundingClientRect();
      const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      if (d < bd) { bd = d; best = t; }
    }
    if (!best || bd > 260) return null;
    tile = best;
  }
  const r = tile.getBoundingClientRect();
  return { el: tile, after: e.clientX > r.left + r.width / 2, key: tile.getAttribute(attr) };
}

view.addEventListener('dragover', (e) => {
  if (!drag) return;
  const s = dropSpot(e);
  if (!s) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearMarks();
  s.el.classList.add(s.after ? 'drop-after' : 'drop-before');
});

view.addEventListener('drop', (e) => {
  if (!drag) return;
  const s = dropSpot(e);
  e.preventDefault();
  e.stopPropagation();
  clearMarks();
  const d = drag;
  drag = null;
  if (!s) return PR.render();
  if (d.type === 'file') {
    if (s.key === d.keys[0]) return PR.render();
    const files = PR.M.files.filter((f) => f !== d.keys[0]);
    const i = files.indexOf(s.key);
    const before = s.after ? files[i + 1] : s.key;
    return PR.mergeMoveFile(d.keys[0], before || null);
  }
  const list = d.type === 'page' ? PR.M.pages : PR.IP.items;
  const rest = list.filter((x) => !d.keys.includes(x.k));
  let before;
  if (d.keys.includes(s.key)) return PR.render();
  const i = rest.findIndex((x) => x.k === s.key);
  before = s.after ? (rest[i + 1] && rest[i + 1].k) : s.key;
  if (d.type === 'page') PR.mergeMovePages(d.keys, before || null);
  else PR.imgMove(d.keys, before || null);
}, true);

view.addEventListener('dragend', () => {
  clearMarks();
  if (drag) { drag = null; PR.render(); }
  for (const el of $$('.dragging', view)) el.classList.remove('dragging');
});

// ---------------------------------------------------------------- 시작

(async function start() {
  try {
    Object.assign(S.settings, await PR.api('/api/settings'));
  } catch (e) { PR.toastErr(e); }
  PR.applyTheme();
  PR.go('home');
  // 맥 빌드 서버의 시험용: settings.json 의 ui.smoke = {screen, paths} 면 그 화면을 파일과 함께 열어요 (사용자는 쓰지 않아요)
  const smoke = S.settings.ui && S.settings.ui.smoke;
  if (smoke && smoke.screen && Array.isArray(smoke.paths)) {
    const items = await PR.openPaths(smoke.paths);
    PR.go(smoke.screen, items);
  }
  PR.loadRecent();
  PR.pollUpdate();
  setInterval(PR.pollUpdate, 60 * 1000);
  window.addEventListener('focus', () => { PR.pollUpdate(); if (S.screen === 'home') PR.loadRecent(); });
})();
