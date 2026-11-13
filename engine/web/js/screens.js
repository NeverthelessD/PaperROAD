// PaperROAD 화면 — 첫 화면 · 합치기 · 분할 · 압축/변환 · 이미지→PDF · 설정
// 확정 시안(Design 캔버스 'PaperROAD 디자인 시안')을 그대로 옮겼어요.
// made by. Nevertheless_D
'use strict';

const view = $('#view');

// ---------------------------------------------------------------- 공통 조각

const TASKS = {
  merge: { title: '합치기 · 순서 바꾸기', icon: ICON.merge, desc: '여러 PDF를 하나로 묶고, 페이지 순서를 끌어서 정해요.', flow: `<span class="fl"><span class="fmt pdf">PDF</span>+<span class="fmt pdf">PDF</span>→<span class="fmt pdf">PDF</span></span>` },
  split: { title: '분할 · 페이지 추출', icon: ICON.split, desc: '필요한 페이지만 골라 새 PDF나 JPG로 저장해요.', flow: `<span class="fl"><span class="fmt pdf">PDF</span>→<span class="fmt pdf">PDF</span><span class="fmt img">JPG</span></span>` },
  organize: { title: '회전 · 삭제', icon: ICON.rotate, desc: '누운 페이지는 세우고, 필요 없는 페이지는 지워요.', flow: `<span class="fl"><span class="fmt pdf">PDF</span>→<span class="fmt pdf">PDF</span></span>` },
  convert: { title: '압축 · PDF → 이미지', icon: ICON.compress, desc: '용량을 줄이거나, PDF를 JPG · PNG 이미지로 바꿔요.', flow: `<span class="fl"><span class="fmt pdf">PDF</span>→<span class="fmt img">JPG</span><span class="fmt img">PNG</span></span>` },
  img2pdf: { title: '이미지 → PDF', icon: ICON.image, desc: '사진과 스캔 이미지를 모아 PDF 한 파일로 만들어요.', flow: `<span class="fl"><span class="fmt img">JPG</span><span class="fmt img">PNG</span>→<span class="fmt pdf">PDF</span></span>` },
};
const TASK_ORDER = ['merge', 'split', 'organize', 'convert', 'img2pdf'];
const RECENT_LABEL = { merge: '합치기', organize: '회전 · 삭제', split: '분할', jpg: 'JPG 저장', compress: '압축', toimg: 'PDF → 이미지', img2pdf: '이미지 → PDF' };

function toolbar(title, flow, right = '') {
  return `<div class="toolbar">
    <button type="button" class="back" data-act="home" title="처음으로 (⌫)">${ICON.back}처음으로</button>
    <h1>${esc(title)}</h1>
    ${flow ? `<span class="flow">${flow}</span>` : ''}
    <span class="spacer"></span>
    ${right}
  </div>`;
}

function footer(left) {
  return `<footer class="footer"><span>${esc(left)}</span><span>made by. Nevertheless_D</span></footer>`;
}

function emptyDrop(kind, title, sub) {
  return `<div class="emptydrop" data-drop="here">
    <span style="color: var(--muted)">${kind === 'image' ? ICON.image : ICON.pdfdoc}</span>
    <h2>${esc(title)}</h2>
    <p>${esc(sub)}</p>
    <button type="button" class="btn primary" data-act="pick">${ICON.plus}${kind === 'image' ? '사진 고르기' : 'PDF 고르기'}</button>
  </div>`;
}

let keyCounter = 0;
const newKey = () => 'k' + (++keyCounter);

// ---------------------------------------------------------------- 상태 (화면마다)

const M = { mode: 'merge', files: [], pages: [], sel: new Set(), anchor: null, undo: [] };
const SP = { id: null, sel: new Set(), mode: 'pick', scope: 'picked', every: 2, ranges: '', dpi: 150 };
const CV = { tab: 'compress', id: null, level: 'mid', est: null, ext: 'jpg', dpi: 150, pages: '' };
const IP = { items: [], sel: null, paper: 'photo', orient: 'auto', margin: 'none', name: '사진모음' };

// ---------------------------------------------------------------- 화면 바꾸기

function go(screen, items) {
  if (screen !== S.screen) for (const el of $$('#toasts .toast[data-kind="undo"]')) el.remove(); // 다른 화면의 '되돌리기'는 치워요
  S.screen = screen;
  if (screen === 'merge' || screen === 'organize') {
    if (M.mode !== screen) { M.files = []; M.pages = []; M.sel.clear(); M.undo = []; }
    M.mode = screen;
    S.screen = 'merge';
    if (items) mergeAdd(items, false);
  } else if (screen === 'split' && items) {
    setSplitFile(items);
  } else if (screen === 'convert' && items) {
    setConvertFile(items);
  } else if (screen === 'img2pdf' && items) {
    imgAdd(items, false);
  }
  render();
  view.scrollTop = 0;
}
PR.go = go;

function render() {
  const r = { home: renderHome, merge: renderMerge, split: renderSplit, convert: renderConvert, img2pdf: renderImg }[S.screen] || renderHome;
  view.innerHTML = r();
  observeThumbs(view);
}
PR.render = render;

// ---------------------------------------------------------------- 첫 화면

function heroArt() {
  return `<svg class="art" width="380" height="210" viewBox="0 0 380 210" aria-hidden="true">
    <rect class="bg" x="0" y="0" width="380" height="210" rx="16"></rect>
    <rect class="page" x="58" y="26" width="104" height="136" rx="8"></rect>
    <rect class="page" x="44" y="40" width="104" height="136" rx="8"></rect>
    <rect class="t" x="58" y="56" width="56" height="6" rx="3"></rect>
    <rect class="blk" x="58" y="70" width="76" height="34" rx="4"></rect>
    <rect class="ln" x="58" y="112" width="76" height="4" rx="2"></rect>
    <rect class="ln" x="58" y="122" width="62" height="4" rx="2"></rect>
    <rect class="ln" x="58" y="132" width="70" height="4" rx="2"></rect>
    <rect class="pdf" x="56" y="150" width="38" height="18" rx="4"></rect>
    <text x="75" y="163" text-anchor="middle" font-size="11" font-weight="700" fill="#FFFFFF" font-family="IBM Plex Sans KR, sans-serif">PDF</text>
    <path class="arrow" d="M170 105h44" stroke-width="3" stroke-linecap="round"></path>
    <path class="arrow" d="M206 96l10 9-10 9" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
    <circle class="sun" cx="192" cy="80" r="12"></circle>
    <path class="plus" d="M186 80h12M192 74v12" stroke-width="2" stroke-linecap="round"></path>
    <rect class="page" x="232" y="40" width="104" height="136" rx="8"></rect>
    <rect class="ph" x="244" y="54" width="80" height="80" rx="4"></rect>
    <circle class="sun" cx="264" cy="76" r="8"></circle>
    <path class="hill" d="M244 134l28-30 18 18 14-12 20 24z"></path>
    <rect class="img" x="244" y="150" width="38" height="18" rx="4"></rect>
    <text x="263" y="163" text-anchor="middle" font-size="11" font-weight="700" fill="#FFFFFF" font-family="IBM Plex Sans KR, sans-serif">JPG</text>
  </svg>`;
}

function updateBanner() {
  const u = S.update;
  if (!u) return '';
  if (u.status === 'ready' && u.installed) {
    return `<div class="banner"><span class="t">새 버전 <b>v${esc(u.installed)}</b>을 받았어요. 다시 시작하면 바뀌어요.</span><button type="button" class="btn primary sm" data-act="restart">지금 다시 시작</button></div>`;
  }
  if (u.status === 'available' && u.latest && !u.autoUpdate) {
    return `<div class="banner"><span class="t">새 버전 <b>v${esc(u.latest.version)}</b>이 나왔어요.</span><button type="button" class="btn primary sm" data-act="install">받기</button></div>`;
  }
  return '';
}

function renderHome() {
  const cards = TASK_ORDER.map((k) => {
    const t = TASKS[k];
    return `<button type="button" class="card" data-act="task" data-task="${k}" data-drop="${k}">
      <span class="ic">${t.icon}</span>
      <span class="body">
        <span class="head"><b>${esc(t.title)}</b>${t.flow}</span>
        <span class="desc">${esc(t.desc)}</span>
      </span>
      ${ICON.chev}
    </button>`;
  }).join('');
  const rec = S.recent.slice(0, 6);
  const recent = rec.length
    ? `<div class="recent-list">${rec.map((r) => `<button type="button" class="recent-item${r.exists ? '' : ' gone'}" data-act="reveal" data-path="${esc(r.path)}" title="${r.exists ? 'Finder에서 보기' : '파일이 없어졌어요'}">
        <span style="color: var(--muted)">${r.folder ? ICON.folder : ICON.file}</span>
        <span class="nm"><b>${esc(r.name)}</b><span>${esc(RECENT_LABEL[r.task] || '')}${r.folder ? ` · ${r.count}개` : ''} · ${esc(r.dir)} · ${ago(r.time)}</span></span>
      </button>`).join('')}</div>`
    : `<p class="empty">아직 작업한 파일이 없어요. 저장한 결과물이 여기에 쌓이고, 누르면 Finder에서 바로 보여 줘요.</p>`;
  return `<div class="scroll"><div class="home">
    ${updateBanner()}
    <section class="hero">
      <div class="txt">
        <span class="chip">PDF 페이지 정리 · 변환</span>
        <h1>무엇을 할까요?</h1>
        <p>작업을 고르고 PDF를 넣으면 바로 시작해요.<br>카드 위로 파일을 끌어다 놓아도 돼요.</p>
        <div class="formats">다룰 수 있는 형식 ${fmt.pdf} ${fmt.jpg} ${fmt.png} ${S.settings.heic === false ? '' : fmt.heic}</div>
      </div>
      ${heroArt()}
    </section>
    <div class="cards">
      ${cards}
      <div class="dropcard" data-drop="any">
        ${ICON.pdfdoc}
        <span class="msg">여기에 파일을 놓으면<br>어떤 작업을 할지 물어봐요</span>
        <button type="button" class="btn" data-act="pick-any">파일 고르기</button>
      </div>
    </div>
    <section class="recent">
      <h2>최근 작업</h2>
      ${recent}
    </section>
  </div></div>
  ${footer('v' + (S.settings.build || '') + ' · 모든 작업은 이 맥 안에서만 처리돼요')}`;
}

async function loadRecent() {
  try {
    S.recent = (await api('/api/recent')).items || [];
    if (S.screen === 'home') render();
  } catch (e) { /* 조용히 */ }
}
PR.loadRecent = loadRecent;

// 파일을 어떤 작업으로 넣을지 물어봐요 (첫 화면에 떨어뜨렸을 때)
function chooseTask(items) {
  const pdfs = items.filter((i) => i.kind === 'pdf');
  const imgs = items.filter((i) => i.kind === 'image');
  const opts = [];
  if (pdfs.length) opts.push(...['merge', 'split', 'organize', 'convert']);
  if (imgs.length) opts.push('img2pdf');
  const what = pdfs.length && imgs.length ? `PDF ${pdfs.length}개 · 사진 ${imgs.length}장` : pdfs.length ? `PDF ${pdfs.length}개` : `사진 ${imgs.length}장`;
  const m = modal(`<div class="choose" role="dialog" aria-modal="true" aria-label="어떤 작업을 할까요?">
    <h2>어떤 작업을 할까요?</h2>
    <p>${esc(what)}를 넣었어요.</p>
    <div class="cards">${opts.map((k) => `<button type="button" class="card" data-task="${k}"><span class="ic">${TASKS[k].icon}</span><span class="body"><span class="head"><b>${esc(TASKS[k].title)}</b>${TASKS[k].flow}</span></span>${ICON.chev}</button>`).join('')}</div>
    <div class="right"><button type="button" class="btn ghost" data-close>닫기</button></div>
  </div>`);
  m.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return m.close();
    const b = e.target.closest('[data-task]');
    if (!b) return;
    m.close();
    const k = b.dataset.task;
    go(k, k === 'img2pdf' ? imgs : pdfs);
    if (k !== 'img2pdf' && imgs.length) toast(`사진 ${imgs.length}장은 넣지 않았어요`, { sub: "사진은 '이미지 → PDF'에서 PDF로 만들 수 있어요" });
  });
}

// ---------------------------------------------------------------- 합치기 · 순서 바꾸기 · 회전 · 삭제

function onlyPDFs(items, where) {
  const pdfs = items.filter((i) => i.kind === 'pdf');
  const n = items.length - pdfs.length;
  if (n) toast(`사진 ${n}장은 ${where}에 넣을 수 없어요`, { sub: "사진은 '이미지 → PDF'에서 PDF로 만들 수 있어요" });
  return pdfs;
}

function mergeSnapshot() {
  M.undo.push({ files: M.files.slice(), pages: M.pages.map((p) => ({ ...p })) });
  if (M.undo.length > 50) M.undo.shift();
}

function mergeAdd(items, doRender = true) {
  const pdfs = onlyPDFs(items, M.mode === 'merge' ? '합치기' : '회전 · 삭제');
  if (!pdfs.length) return;
  mergeSnapshot();
  for (const it of pdfs) {
    if (!M.files.includes(it.id)) M.files.push(it.id);
    for (let p = 1; p <= it.pages; p++) M.pages.push({ k: newKey(), id: it.id, p, r: 0 });
  }
  if (doRender) render();
}

function mergeUndo() {
  const s = M.undo.pop();
  if (!s) return toast('되돌릴 작업이 없어요');
  M.files = s.files; M.pages = s.pages; M.sel.clear();
  render();
}

function mergeRotate(keys) {
  if (!keys.length) return;
  mergeSnapshot();
  for (const pg of M.pages) if (keys.includes(pg.k)) pg.r = (pg.r + 90) % 360;
  render();
}

function mergeDelete(keys) {
  if (!keys.length) return;
  if (keys.length >= M.pages.length) return toast('모든 페이지를 지울 수는 없어요', { error: true });
  mergeSnapshot();
  M.pages = M.pages.filter((p) => !keys.includes(p.k));
  M.sel.clear();
  render();
  toast(`${keys.length}쪽을 지웠어요`, { action: { label: '되돌리기', run: mergeUndo } });
}

// 빼기 알림은 마지막 것 하나만 (되돌리기가 엉뚱한 것을 되돌리지 않게)
function removedToast(text, undo) {
  for (const el of $$('#toasts .toast[data-kind="undo"]')) el.remove();
  const el = toast(text, { sub: '원본 파일은 그대로예요', action: { label: '되돌리기', run: undo } });
  el.dataset.kind = 'undo';
}

function mergeRemoveFile(id) {
  const it = S.files[id];
  mergeSnapshot();
  M.files = M.files.filter((f) => f !== id);
  M.pages = M.pages.filter((p) => p.id !== id);
  M.sel.clear();
  render();
  removedToast(`${it ? it.name : '파일'} · 목록에서 뺐어요`, mergeUndo);
}

function mergeClear() {
  if (!M.files.length) return;
  const n = M.files.length;
  mergeSnapshot();
  M.files = []; M.pages = []; M.sel.clear();
  render();
  removedToast(`파일 ${n}개를 모두 목록에서 뺐어요`, mergeUndo);
}

// 파일 순서를 바꾸면 그 파일의 페이지 묶음도 따라 움직여요 (파일 안의 순서는 그대로)
function mergeMoveFile(id, beforeId) {
  mergeSnapshot();
  const files = M.files.filter((f) => f !== id);
  const at = beforeId ? files.indexOf(beforeId) : files.length;
  files.splice(at < 0 ? files.length : at, 0, id);
  M.files = files;
  const pages = [];
  for (const f of files) for (const p of M.pages) if (p.id === f) pages.push(p);
  M.pages = pages;
  render();
}

function mergeMovePages(keys, beforeKey) {
  mergeSnapshot();
  const moving = M.pages.filter((p) => keys.includes(p.k));
  const rest = M.pages.filter((p) => !keys.includes(p.k));
  let at = beforeKey ? rest.findIndex((p) => p.k === beforeKey) : rest.length;
  if (at < 0) at = rest.length;
  rest.splice(at, 0, ...moving);
  M.pages = rest;
  render();
}

async function mergeSave() {
  if (!M.pages.length) return;
  const first = S.files[M.pages[0].id];
  const dir = await askDir(first);
  if (dir === null) return;
  const b = busy('PDF를 저장하는 중…');
  try {
    const r = await api('/api/build', { task: M.mode, pages: M.pages.map(({ id, p, r }) => ({ id, p, r })), dir });
    savedToast(r);
  } catch (e) { toastErr(e); } finally { b.done(); }
}

function renderMerge() {
  const t = TASKS[M.mode];
  const nFiles = M.files.length;
  const flow = M.mode === 'merge'
    ? `<span class="fmt pdf">PDF</span>×${nFiles || 0} → <span class="fmt pdf">PDF</span>×1`
    : `<span class="fmt pdf">PDF</span> → <span class="fmt pdf">PDF</span>`;
  const right = `<button type="button" class="btn" data-act="pick">${ICON.plus}파일 추가</button>
    <button type="button" class="btn primary" data-act="save" ${M.pages.length ? '' : 'disabled'}>${ICON.save}${nFiles > 1 ? '하나의 PDF로 저장' : 'PDF로 저장'}</button>`;
  if (!M.pages.length && !nFiles) {
    return `${toolbar(t.title, flow, right)}
      <div class="scroll"><div class="center" style="max-width: 760px">${emptyDrop('pdf', M.mode === 'merge' ? '합칠 PDF를 넣어 주세요' : '정리할 PDF를 넣어 주세요', '여기에 PDF를 끌어다 놓거나, 아래 버튼으로 골라요. 여러 개를 한꺼번에 넣어도 돼요.')}</div></div>
      ${footer('원본은 그대로 두고 새 파일로 저장해요')}`;
  }
  const counts = {};
  for (const p of M.pages) counts[p.id] = (counts[p.id] || 0) + 1;
  const files = M.files.map((id) => {
    const it = S.files[id];
    const left = counts[id] || 0;
    return `<div class="filecard" draggable="true" data-file="${esc(id)}">
      <span class="grip" aria-hidden="true">${ICON.grip}</span>
      <span class="fdot" style="background: ${fileColor(id)}" aria-hidden="true"></span>
      <span class="nm"><b title="${esc(it.name)}">${esc(it.name)}</b><span>${left === it.pages ? `${it.pages}쪽` : `${it.pages}쪽 중 ${left}쪽`}</span></span>
      <button type="button" class="x" data-act="remove-file" data-id="${esc(id)}" aria-label="${esc(it.name)} 목록에서 빼기" title="목록에서 빼기 (원본 파일은 그대로예요)">${ICON.x}</button>
    </div>`;
  }).join('');
  const selKeys = [...M.sel];
  const tiles = M.pages.map((pg, i) => {
    const it = S.files[pg.id];
    const sel = M.sel.has(pg.k);
    const showActs = sel && (M.anchor === pg.k || M.sel.size === 1);
    return `<div class="tile" data-pg="${pg.k}">
      <button type="button" class="thumb${sel ? ' sel' : ''}" draggable="true" data-act="sel-page" data-k="${pg.k}" aria-pressed="${sel}" aria-label="${esc(it.name)} ${pg.p}쪽, 전체 ${i + 1}번째${pg.r ? `, ${pg.r}도 돌림` : ''}" title="${esc(it.name)} · ${pg.p}쪽">
        ${thumbImg(pg.id, pg.p, pg.r)}
        <span class="dot" style="background: ${fileColor(pg.id)}" aria-hidden="true"></span>
        <span class="tag" aria-hidden="true">PDF</span>
      </button>
      ${showActs
        ? `<div class="acts"><button type="button" data-act="rotate" aria-label="${M.sel.size > 1 ? `고른 ${M.sel.size}쪽` : '이 페이지'} 회전" title="시계 방향으로 돌리기 (R)">${ICON.rot16}</button><button type="button" class="del" data-act="delete" aria-label="${M.sel.size > 1 ? `고른 ${M.sel.size}쪽` : '이 페이지'} 삭제" title="지우기 (⌫)">${ICON.trash16}</button></div>`
        : `<span class="cap">${i + 1}쪽</span>`}
    </div>`;
  }).join('');
  const selBar = M.sel.size > 1
    ? `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px"><span style="font-size: 14px; font-weight: 600">${M.sel.size}쪽을 골랐어요</span>
        <button type="button" class="btn sm" data-act="rotate">${ICON.rot16}회전</button>
        <button type="button" class="btn sm" data-act="delete" style="color: var(--danger)">${ICON.trash16}삭제</button>
        <button type="button" class="btn sm ghost" data-act="sel-none">선택 해제</button></div>`
    : `<p style="margin: 0; font-size: 14px; color: var(--muted)">페이지를 끌어서 순서를 바꾸고, 누르면 회전 · 삭제 버튼이 나와요. ⌘ 키를 누른 채 누르면 여러 쪽을 고를 수 있어요.</p>`;
  return `${toolbar(t.title, flow, right)}
    <div class="workarea">
      <aside class="panel left" data-drop="here">
        <div style="display: flex; flex-direction: column; gap: 2px"><div style="display: flex; align-items: center; gap: 8px; margin: -6px 0"><h2 style="flex: 1; font-size: 14px">넣은 파일 ${nFiles}개</h2><button type="button" class="btn ghost sm" data-act="clear-all" title="넣은 파일을 모두 목록에서 빼요 (원본 파일은 그대로예요)" style="height: 32px; padding: 0 8px; margin-right: -8px">모두 빼기</button></div><span style="font-size: 12px; color: var(--muted)">${nFiles > 1 ? '끌어서 파일 순서를 바꿔요' : '파일을 더 넣으면 뒤에 이어 붙여요'}</span></div>
        ${files}
        <p class="hint">색 점은 어느 파일의 페이지인지 알려 줘요. ✕를 누르면 그 파일을 목록에서 빼요. 원본 파일은 그대로예요.</p>
      </aside>
      <section class="main-pane" data-drop="here">
        ${selBar}
        <div class="grid" id="pageGrid">${tiles}</div>
      </section>
    </div>
    ${footer(`총 ${M.pages.length}쪽 · ⌘Z 되돌리기`)}`;
}

// ---------------------------------------------------------------- 분할 · 페이지 추출 · JPG

function setSplitFile(items) {
  const pdfs = onlyPDFs(items, '분할');
  if (!pdfs.length) return;
  if (pdfs.length > 1) toast(`${pdfs[0].name} 하나만 넣었어요`, { sub: '분할은 한 번에 PDF 하나씩 할 수 있어요' });
  SP.id = pdfs[0].id;
  SP.sel = new Set();
  SP.ranges = '';
}

function splitSummary() {
  const it = S.files[SP.id];
  const n = SP.sel.size;
  const all = SP.mode === 'jpg' && SP.scope === 'all';
  if (SP.mode === 'pick') return { summary: n ? `${n}쪽을 골랐어요` : '새 PDF에 넣을 페이지를 골라 주세요', cta: n ? `고른 ${n}쪽을 새 PDF로 저장` : '페이지를 골라 주세요', ok: n > 0 };
  if (SP.mode === 'jpg') {
    const k = all ? it.pages : n;
    return { summary: all ? `전체 ${it.pages}쪽 → JPG ${it.pages}장` : n ? `고른 ${n}쪽 → JPG ${n}장` : 'JPG로 바꿀 페이지를 골라 주세요', cta: k ? `JPG ${k}장으로 저장` : '페이지를 골라 주세요', ok: k > 0 };
  }
  if (SP.mode === 'every') {
    const e = Math.max(1, parseInt(SP.every, 10) || 0);
    const files = Math.ceil(it.pages / e);
    return { summary: `${it.pages}쪽을 ${e}쪽씩 → PDF ${files}개`, cta: '나눠서 저장', ok: parseInt(SP.every, 10) >= 1 };
  }
  const parts = SP.ranges.split(/[,，]/).map((s) => s.trim()).filter(Boolean).length;
  return { summary: parts ? `범위마다 PDF가 하나씩, 모두 ${parts}개 만들어져요` : '범위마다 PDF가 하나씩 만들어져요', cta: '범위대로 저장', ok: parts > 0 };
}

function renderSplit() {
  const t = TASKS.split;
  if (!SP.id || !S.files[SP.id]) {
    return `${toolbar(t.title, '<span class="fmt pdf">PDF</span>→<span class="fmt pdf">PDF</span><span class="fmt img">JPG</span>')}
      <div class="scroll"><div class="center" style="max-width: 760px">${emptyDrop('pdf', '나눌 PDF를 넣어 주세요', '여기에 PDF를 끌어다 놓거나, 아래 버튼으로 골라요.')}</div></div>
      ${footer('원본은 그대로 두고 새 파일로 저장해요')}`;
  }
  const it = S.files[SP.id];
  const usesPick = SP.mode === 'pick' || (SP.mode === 'jpg' && SP.scope === 'picked');
  const allJpg = SP.mode === 'jpg' && SP.scope === 'all';
  const flow = `<span class="fmt pdf">PDF</span>→<span class="fmt ${SP.mode === 'jpg' ? 'off' : 'pdf'}">PDF</span><span class="fmt ${SP.mode === 'jpg' ? 'img' : 'off'}">JPG</span>`;
  const right = `<span style="font-size: 14px; color: var(--muted)">${esc(it.name)} · ${it.pages}쪽</span><button type="button" class="btn sm" data-act="pick">다른 파일</button><button type="button" class="btn sm" data-act="unload" title="목록에서 빼기 (원본 파일은 그대로예요)">${ICON.x}빼기</button>`;
  const tiles = [];
  for (let p = 1; p <= it.pages; p++) {
    const on = allJpg || SP.sel.has(p);
    tiles.push(`<div class="tile">
      <button type="button" class="thumb${on && (usesPick || allJpg) ? ' sel' : ''}${usesPick || allJpg ? '' : ' dim'}" data-act="toggle-page" data-p="${p}" aria-pressed="${on}" aria-label="${p}쪽 ${on ? '선택됨' : '선택 안 됨'}">
        ${thumbImg(it.id, p, 0)}
        <span class="check" aria-hidden="true">${on ? ICON.check : ''}</span>
        <span class="tag left" aria-hidden="true">PDF</span>
      </button>
      <span class="cap">${p}쪽</span>
    </div>`);
  }
  const hint = { pick: '새 PDF에 넣을 페이지를 눌러서 고르세요.', every: '모든 페이지가 정한 쪽수대로 나뉘어요.', range: '오른쪽에 페이지 범위를 적어 주세요.', jpg: allJpg ? '모든 페이지를 JPG로 바꿔요.' : 'JPG로 바꿀 페이지를 눌러서 고르세요.' }[SP.mode];
  const modes = [
    { id: 'pick', title: '고른 페이지만 새 PDF로', desc: '누른 페이지만 모아 한 파일로 만들어요.', badge: 'pdf' },
    { id: 'jpg', title: '이미지로 저장', desc: '전체 또는 고른 페이지를 한 쪽씩 JPG 파일로 바꿔요.', badge: 'img' },
    { id: 'every', title: '몇 쪽씩 나누기', desc: '정한 쪽수마다 잘라 여러 파일로 저장해요.', badge: 'pdf' },
    { id: 'range', title: '페이지 범위로 나누기', desc: '쉼표로 구분한 범위마다 파일을 하나씩 만들어요.', badge: 'pdf' },
  ].map((m) => `<button type="button" class="option" role="radio" aria-checked="${SP.mode === m.id}" data-act="split-mode" data-mode="${m.id}">
      <span class="radio" aria-hidden="true"></span>
      <span class="ot"><b>${esc(m.title)}<span class="fmt ${m.badge}" style="padding: 1px 6px; font-size: 10px">${m.badge === 'pdf' ? 'PDF' : 'JPG'}</span></b><span>${esc(m.desc)}</span></span>
    </button>`).join('');
  let sub = '';
  if (SP.mode === 'every') sub = `<label class="inline-field" style="justify-content: flex-start; font-size: 14px; color: var(--ink)">몇 쪽씩<input class="input" type="number" min="1" max="${it.pages}" value="${esc(SP.every)}" data-field="every" style="width: 80px; height: 40px"></label>`;
  if (SP.mode === 'range') sub = `<label class="field">페이지 범위<input class="input" type="text" placeholder="예: 1-3, 6, 8-" value="${esc(SP.ranges)}" data-field="ranges" spellcheck="false" autocomplete="off"></label><p class="hint">'8-'처럼 쓰면 8쪽부터 끝까지예요.</p>`;
  if (SP.mode === 'jpg') sub = `<div class="subbox">
      <div class="seg solid" role="radiogroup" aria-label="바꿀 페이지">
        <button type="button" role="radio" aria-checked="${SP.scope === 'all'}" data-act="split-scope" data-scope="all">전체 페이지</button>
        <button type="button" role="radio" aria-checked="${SP.scope === 'picked'}" data-act="split-scope" data-scope="picked">고른 페이지만</button>
      </div>
      <label class="inline-field">화질<select class="select" data-field="dpi" style="height: 40px"><option value="150"${SP.dpi == 150 ? ' selected' : ''}>보통 (화면용)</option><option value="300"${SP.dpi == 300 ? ' selected' : ''}>선명 (인쇄용)</option></select></label>
      <span style="font-size: 12px; color: var(--muted)">파일 이름: ${esc(it.base)}_1쪽.jpg, ${esc(it.base)}_2쪽.jpg …</span>
    </div>`;
  const s = splitSummary();
  return `${toolbar(t.title, flow, right)}
    <div class="workarea">
      <section class="main-pane" data-drop="here">
        <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">
          <p style="margin: 0; flex: 1; font-size: 14px; color: var(--muted)" id="splitHint">${esc(hint)}</p>
          <button type="button" class="btn sm" data-act="sel-all">모두 고르기</button>
          <button type="button" class="btn sm" data-act="sel-clear">선택 해제</button>
        </div>
        <div class="grid">${tiles.join('')}</div>
      </section>
      <aside class="panel">
        <h2 style="margin-bottom: 4px">어떻게 저장할까요?</h2>
        <div role="radiogroup" aria-label="저장 방법" style="display: flex; flex-direction: column; gap: 12px">${modes}</div>
        ${sub}
        <div class="cta">
          <p id="splitSummary">${esc(s.summary)}</p>
          <button type="button" class="btn primary big" data-act="split-save" id="splitCta" ${s.ok ? '' : 'disabled'}>${esc(s.cta)}</button>
        </div>
      </aside>
    </div>
    ${footer('원본은 그대로 두고 새 파일로 저장해요')}`;
}

function refreshSplitSummary() {
  const s = splitSummary();
  const p = $('#splitSummary'), b = $('#splitCta');
  if (p) p.textContent = s.summary;
  if (b) { b.textContent = s.cta; b.disabled = !s.ok; }
}

async function splitSave() {
  const it = S.files[SP.id];
  if (!it) return;
  if (SP.mode === 'jpg') {
    const pages = SP.scope === 'all' ? Array.from({ length: it.pages }, (_, i) => i + 1) : [...SP.sel].sort((a, b) => a - b);
    if (!pages.length) return toast('JPG로 바꿀 페이지를 골라 주세요', { error: true });
    return exportImages(it, pages, { ext: 'jpg', dpi: +SP.dpi, task: 'jpg' });
  }
  const dir = await askDir(it);
  if (dir === null) return;
  const b = busy('PDF를 나누는 중…');
  try {
    const r = await api('/api/split', { id: it.id, mode: SP.mode, pages: [...SP.sel], every: parseInt(SP.every, 10) || 0, ranges: SP.ranges, dir });
    savedToast(r);
  } catch (e) { toastErr(e); } finally { b.done(); }
}

// ---------------------------------------------------------------- 압축 · PDF → 이미지

function setConvertFile(items) {
  const pdfs = onlyPDFs(items, '압축 · 변환');
  if (!pdfs.length) return;
  if (pdfs.length > 1) toast(`${pdfs[0].name} 하나만 넣었어요`, { sub: '한 번에 PDF 하나씩 할 수 있어요' });
  CV.id = pdfs[0].id;
  CV.est = null;
  CV.pages = '';
  loadEstimate();
}

async function loadEstimate() {
  const id = CV.id;
  CV.est = { loading: true };
  try {
    const r = await api('/api/compress/estimate', { id });
    if (CV.id === id) CV.est = r;
  } catch (e) {
    if (CV.id === id) CV.est = { error: e.message };
  }
  if (S.screen === 'convert' && CV.id === id) render();
}

function parsePageList(text, total) {
  const t = String(text || '').trim();
  if (!t) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set();
  for (let part of t.split(/[,，]/)) {
    part = part.trim().replace(/쪽/g, '');
    if (!part) continue;
    const m = part.match(/^(\d*)\s*[-~–]\s*(\d*)$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; } else if (/^\d+$/.test(part)) { a = b = +part; } else throw new Error(`'${part}' 을(를) 이해하지 못했어요. 예: 1-3, 6, 8`);
    if (a < 1 || b > total || a > b) throw new Error(`'${part}' 은(는) 1~${total}쪽 안에서 적어 주세요`);
    for (let p = a; p <= b; p++) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

function renderConvert() {
  const t = TASKS.convert;
  const tabs = `<div class="seg" role="tablist" aria-label="작업 종류">
    <button type="button" role="tab" aria-selected="${CV.tab === 'compress'}" data-act="cv-tab" data-tab="compress">용량 줄이기</button>
    <button type="button" role="tab" aria-selected="${CV.tab === 'toimg'}" data-act="cv-tab" data-tab="toimg">PDF → 이미지</button>
  </div>`;
  if (!CV.id || !S.files[CV.id]) {
    return `${toolbar(t.title, '', tabs)}
      <div class="scroll"><div class="center" style="max-width: 760px">${emptyDrop('pdf', CV.tab === 'compress' ? '용량을 줄일 PDF를 넣어 주세요' : '이미지로 바꿀 PDF를 넣어 주세요', '여기에 PDF를 끌어다 놓거나, 아래 버튼으로 골라요.')}</div></div>
      ${footer('원본은 그대로 두고 새 파일로 저장해요')}`;
  }
  const it = S.files[CV.id];
  const filebar = `<div class="filebar">
    <span class="doc">${thumbImg(it.id, 1, 0)}</span>
    <span class="nm"><b>${esc(it.name)}</b><span>${it.pages}쪽 · 지금 크기 ${fmtSize(it.size)}</span></span>
    <button type="button" class="btn sm" data-act="pick">다른 파일</button>
    <button type="button" class="btn sm" data-act="unload" title="목록에서 빼기 (원본 파일은 그대로예요)">${ICON.x}빼기</button>
  </div>`;
  let body = '';
  if (CV.tab === 'compress') {
    const est = CV.est || {};
    const lv = [
      { id: 'low', title: '가볍게', desc: '화질은 거의 그대로, 조금만 줄여요.' },
      { id: 'mid', title: '보통', desc: '화면으로 보기엔 차이가 없을 만큼 줄여요.', rec: true },
      { id: 'high', title: '강하게', desc: '메일 첨부용. 사진이 조금 흐려질 수 있어요.' },
    ].map((l) => {
      let estText = '<span class="spinner" style="width: 14px; height: 14px"></span>크기를 계산하는 중…';
      let disabled = false;
      if (est.error) { estText = '계산하지 못했어요'; disabled = true; }
      else if (est.sizes) {
        const sz = est.sizes[l.id];
        if (sz >= est.original) { estText = '더 줄일 수 없어요'; disabled = true; }
        else estText = `약 ${fmtSize(sz)} · ${Math.max(1, Math.round((1 - sz / est.original) * 100))}% 줄어요`;
      }
      return `<button type="button" class="level" role="radio" aria-checked="${CV.level === l.id}" data-act="cv-level" data-level="${l.id}" ${disabled ? 'disabled' : ''}>
        <b>${esc(l.title)}${l.rec ? '<span class="rec">추천</span>' : ''}</b>
        <span>${esc(l.desc)}</span>
        <span class="est">${estText}</span>
      </button>`;
    }).join('');
    const can = est.sizes && est.sizes[CV.level] < est.original;
    const allBig = est.sizes && ['low', 'mid', 'high'].every((k) => est.sizes[k] >= est.original);
    body = `${filebar}
      <h2 style="margin: 0; font-size: 15px; font-weight: 600">얼마나 줄일까요?</h2>
      <div class="levels" role="radiogroup" aria-label="줄이는 정도">${lv}</div>
      ${est.error ? `<p class="hint" style="color: var(--danger)">${esc(est.error)}</p>` : ''}
      ${allBig ? '<p class="hint">이 PDF는 사진이 적거나 이미 충분히 작아서 더 줄일 수 없어요.</p>' : ''}
      <div class="right"><button type="button" class="btn primary big" data-act="cv-compress" ${can ? '' : 'disabled'}>압축해서 저장</button></div>`;
  } else {
    body = `${filebar}
      <div class="card-box">
        <p style="margin: 0; font-size: 14px; color: var(--muted)">${esc(it.name)} · ${it.pages}쪽을 한 쪽씩 이미지 파일로 저장해요.</p>
        <div class="row3">
          <label class="field">이미지 형식<select class="select" data-field="cv-ext"><option value="png"${CV.ext === 'png' ? ' selected' : ''}>PNG (선명하게)</option><option value="jpg"${CV.ext === 'jpg' ? ' selected' : ''}>JPG (가볍게)</option></select></label>
          <label class="field">화질<select class="select" data-field="cv-dpi"><option value="150"${CV.dpi == 150 ? ' selected' : ''}>보통 (화면용)</option><option value="300"${CV.dpi == 300 ? ' selected' : ''}>선명 (인쇄용)</option></select></label>
          <label class="field">페이지<input class="input" type="text" placeholder="비워 두면 전체" value="${esc(CV.pages)}" data-field="cv-pages" spellcheck="false" autocomplete="off"></label>
        </div>
        <div class="right"><button type="button" class="btn primary big" data-act="cv-toimg">이미지로 저장</button></div>
      </div>`;
  }
  return `${toolbar(t.title, '', tabs)}
    <div class="scroll" data-drop="here"><div class="center">${body}</div></div>
    ${footer('원본은 그대로 두고 새 파일로 저장해요')}`;
}

async function compressSave() {
  const it = S.files[CV.id];
  const dir = await askDir(it);
  if (dir === null) return;
  const b = busy('줄인 PDF를 저장하는 중…');
  try {
    const r = await api('/api/compress/save', { id: it.id, level: CV.level, dir });
    savedToast({ ...r, name: `${r.name} (${fmtSize(r.size)}, ${r.saved} 줄임)` });
  } catch (e) { toastErr(e); } finally { b.done(); }
}

async function toImages() {
  const it = S.files[CV.id];
  let pages;
  try { pages = parsePageList(CV.pages, it.pages); } catch (e) { return toastErr(e); }
  return exportImages(it, pages, { ext: CV.ext, dpi: +CV.dpi, task: 'toimg' });
}

// ---------------------------------------------------------------- 이미지 → PDF

function imgAdd(items, doRender = true) {
  const imgs = items.filter((i) => i.kind === 'image');
  const n = items.length - imgs.length;
  if (n) toast(`PDF ${n}개는 넣지 않았어요`, { sub: "PDF를 합치려면 '합치기 · 순서 바꾸기'를 써 주세요" });
  for (const it of imgs) IP.items.push({ k: newKey(), id: it.id, r: 0 });
  if (imgs.length && (!IP.name || IP.name === '사진모음') && IP.items.length === imgs.length && imgs.length === 1) IP.name = imgs[0].base;
  if (doRender) render();
}

function imgMove(keys, beforeKey) {
  const moving = IP.items.filter((x) => keys.includes(x.k));
  const rest = IP.items.filter((x) => !keys.includes(x.k));
  let at = beforeKey ? rest.findIndex((x) => x.k === beforeKey) : rest.length;
  if (at < 0) at = rest.length;
  rest.splice(at, 0, ...moving);
  IP.items = rest;
  render();
}

function renderImg() {
  const t = TASKS.img2pdf;
  const flow = `<span class="fmt img">JPG</span><span class="fmt img">PNG</span>${S.settings.heic === false ? '' : '<span class="fmt img">HEIC</span>'}→<span class="fmt pdf">PDF</span>`;
  const right = `${IP.items.length ? '<button type="button" class="btn ghost" data-act="clear-all" title="넣은 사진을 모두 목록에서 빼요 (원본 사진은 그대로예요)">모두 빼기</button>' : ''}<button type="button" class="btn" data-act="pick">${ICON.plus}사진 추가</button>`;
  if (!IP.items.length) {
    return `${toolbar(t.title, flow, right)}
      <div class="scroll"><div class="center" style="max-width: 760px">${emptyDrop('image', 'PDF로 만들 사진을 넣어 주세요', '여기에 사진을 끌어다 놓거나, 아래 버튼으로 골라요. 넣은 순서대로 페이지가 돼요.')}</div></div>
      ${footer('원본 사진은 그대로 두고 새 PDF로 저장해요')}`;
  }
  const tiles = IP.items.map((x, i) => {
    const it = S.files[x.id];
    const on = IP.sel === x.k;
    return `<div class="tile photo-tile" data-ph="${x.k}">
      <button type="button" class="thumb${on ? ' sel' : ''}" draggable="true" data-act="sel-photo" data-k="${x.k}" aria-pressed="${on}" aria-label="${i + 1}번째 사진 ${esc(it.name)}" title="${esc(it.name)}">
        ${thumbImg(x.id, 1, x.r)}
        <span class="order" aria-hidden="true">${i + 1}</span>
        <span class="tag img" aria-hidden="true">${esc(it.ext.toUpperCase().replace('JPEG', 'JPG'))}</span>
      </button>
      <button type="button" class="tile-x" data-act="photo-remove" data-k="${x.k}" aria-label="${esc(it.name)} 목록에서 빼기" title="목록에서 빼기 (원본 사진은 그대로예요)">${ICON.x}</button>
      ${on
        ? `<div class="acts"><button type="button" data-act="photo-rotate" data-k="${x.k}" aria-label="이 사진 회전" title="시계 방향으로 돌리기">${ICON.rot16}</button><button type="button" class="del" data-act="photo-remove" data-k="${x.k}" aria-label="이 사진 빼기" title="빼기">${ICON.trash16}</button></div>`
        : `<span class="cap" style="font-size: 13px; color: var(--ink)">${esc(it.name)}</span>`}
    </div>`;
  }).join('');
  const groups = [
    { label: '용지 크기', key: 'paper', opts: [['photo', '사진 크기'], ['a4', 'A4'], ['letter', '레터']] },
    { label: '방향', key: 'orient', opts: [['auto', '자동'], ['portrait', '세로'], ['landscape', '가로']] },
    { label: '여백', key: 'margin', opts: [['none', '없음'], ['narrow', '좁게'], ['normal', '보통']] },
  ].map((g) => `<div style="display: flex; flex-direction: column; gap: 8px">
      <span style="font-size: 13px; color: var(--muted)">${g.label}</span>
      <div class="seg" role="radiogroup" aria-label="${g.label}">${g.opts.map(([v, l]) => `<button type="button" role="radio" aria-checked="${IP[g.key] === v}" data-act="ip-opt" data-key="${g.key}" data-val="${v}">${l}</button>`).join('')}</div>
    </div>`).join('');
  return `${toolbar(t.title, flow, right)}
    <div class="workarea">
      <section class="main-pane" data-drop="here">
        <p style="margin: 0; font-size: 14px; color: var(--muted)">사진을 끌어서 순서를 정하세요. 이 순서대로 PDF 페이지가 만들어져요. ✕를 누르면 목록에서 빼요.</p>
        <div class="grid" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">${tiles}
          <div class="tile"><button type="button" class="addphoto" data-act="pick">${ICON.plus}사진 더 넣기</button></div>
        </div>
      </section>
      <aside class="panel" style="gap: 18px">
        <h2>PDF 모양 정하기</h2>
        ${groups}
        <label class="field">파일 이름<input class="input" type="text" value="${esc(IP.name)}" data-field="ip-name" spellcheck="false" autocomplete="off"></label>
        <div class="cta">
          <p>사진 ${IP.items.length}장 → PDF 1개 (${IP.items.length}쪽)</p>
          <button type="button" class="btn primary big" data-act="ip-save">PDF로 만들기</button>
        </div>
      </aside>
    </div>
    ${footer('원본 사진은 그대로 두고 새 PDF로 저장해요')}`;
}

async function imgSave() {
  if (!IP.items.length) return;
  const first = S.files[IP.items[0].id];
  const dir = await askDir(first);
  if (dir === null) return;
  const b = busy('PDF를 만드는 중…');
  try {
    const r = await api('/api/img2pdf', { items: IP.items.map(({ id, r }) => ({ id, r })), paper: IP.paper, orient: IP.orient, margin: IP.margin, name: IP.name, dir });
    savedToast(r);
  } catch (e) { toastErr(e); } finally { b.done(); }
}

// ---------------------------------------------------------------- 설정

function updateText(u) {
  if (!u) return '';
  switch (u.status) {
    case 'checking': return '새 버전을 확인하는 중…';
    case 'uptodate': return '지금 최신 버전이에요';
    case 'available': return `새 버전 v${u.latest && u.latest.version}이 있어요`;
    case 'downloading': return `새 버전을 받는 중… ${Math.round((u.progress || 0) * 100)}%`;
    case 'installing': return '새 버전을 설치하는 중…';
    case 'ready': return `새 버전 v${u.installed}을 받았어요 · 다시 시작하면 바뀌어요`;
    case 'error': return u.error || '업데이트를 확인하지 못했어요';
    default: return u.lastCheck ? `마지막 확인: ${ago(u.lastCheck)}` : '';
  }
}

let settingsModal = null;
function openSettings() {
  if (settingsModal) return;
  settingsModal = modal('<div class="sheet" role="dialog" aria-modal="true" aria-label="설정"></div>', { onClose: () => { settingsModal = null; } });
  drawSettings();
  settingsModal.el.addEventListener('click', onSettingsClick);
  settingsModal.el.addEventListener('change', onSettingsChange);
}
PR.openSettings = openSettings;

function drawSettings() {
  if (!settingsModal) return;
  const s = S.settings, u = S.update || {};
  const busyUpd = u.status === 'checking' || u.status === 'downloading' || u.status === 'installing';
  const themes = [['system', '맥 설정 따름'], ['light', '라이트'], ['dark', '다크']];
  $('.sheet', settingsModal.el).innerHTML = `
    <div class="sh"><h2>설정</h2><button type="button" class="btn ghost sm" data-close style="color: var(--accent)">닫기</button></div>
    <div class="sb">
      <section class="about">
        <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true"><rect width="56" height="56" rx="13" fill="#2C4BDB"></rect><path d="M18 12h15l9 9v21a3 3 0 0 1-3 3H18a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3z" fill="#FFFFFF"></path><path d="M33 12v9h9z" fill="#F2B807"></path><path d="M20 29h16M20 35h10" stroke="#2C4BDB" stroke-width="2.6" stroke-linecap="round"></path></svg>
        <div class="v"><b>PaperROAD</b><span>버전 ${esc(s.build || '')}${updateText(u) ? ` · ${esc(updateText(u))}` : ''}</span></div>
        ${u.status === 'ready'
          ? '<button type="button" class="btn primary" data-act="restart">다시 시작</button>'
          : u.status === 'available'
            ? '<button type="button" class="btn primary" data-act="install">새 버전 받기</button>'
            : `<button type="button" class="btn" data-act="check" ${busyUpd ? 'disabled' : ''}>업데이트 확인</button>`}
      </section>
      <section class="box">
        <div class="r">
          <span class="lbl"><b>새 버전 자동으로 받기</b><span>새 버전이 나오면 앱이 알아서 받아요</span></span>
          <button type="button" class="switch" role="switch" aria-checked="${!!s.autoUpdate}" aria-label="새 버전 자동으로 받기" data-act="auto"><span></span></button>
        </div>
        <div class="r">
          <span class="lbl"><b>화면 모드</b></span>
          <div class="seg" role="radiogroup" aria-label="화면 모드">${themes.map(([v, l]) => `<button type="button" role="radio" aria-checked="${s.appearance === v}" data-act="theme" data-val="${v}">${l}</button>`).join('')}</div>
        </div>
        <div class="r">
          <span class="lbl"><b>저장 위치</b><span>결과 파일 이름 끝에 _합침 · _압축 같은 말이 붙어요</span></span>
          <select class="select" aria-label="저장 위치" data-field="saveTo" style="height: 40px">
            <option value="beside"${s.saveTo === 'beside' ? ' selected' : ''}>원본 파일 옆에</option>
            <option value="downloads"${s.saveTo === 'downloads' ? ' selected' : ''}>다운로드 폴더에</option>
            <option value="ask"${s.saveTo === 'ask' ? ' selected' : ''}>매번 물어보기</option>
          </select>
        </div>
      </section>
      <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; padding: 4px 4px 0">
        <span style="display: flex; gap: 16px">
          <a href="/diag" target="_blank" style="font-size: 13px">진단 정보 보기</a>
          ${u.canRollback ? `<a href="#" data-act="rollback" style="font-size: 13px">이전 버전(v${esc(u.backupVersion)})으로 되돌리기</a>` : ''}
        </span>
        <span style="font-size: 12px; color: var(--muted)">made by. Nevertheless_D</span>
      </div>
    </div>`;
}

async function saveSetting(patch) {
  try {
    Object.assign(S.settings, await api('/api/settings', patch));
    applyTheme();
    drawSettings();
  } catch (e) { toastErr(e); }
}

async function onSettingsClick(e) {
  const b = e.target.closest('[data-act], [data-close]');
  if (!b) return;
  if (b.hasAttribute('data-close')) return settingsModal.close();
  const act = b.dataset.act;
  if (act === 'auto') saveSetting({ autoUpdate: !S.settings.autoUpdate });
  else if (act === 'theme') saveSetting({ appearance: b.dataset.val });
  else if (act === 'check') { S.update = { ...(S.update || {}), status: 'checking' }; drawSettings(); try { S.update = await api('/api/update/check', {}); } catch (err) { toastErr(err); } drawSettings(); updateDot(); }
  else if (act === 'install') installUpdate();
  else if (act === 'restart') restartApp();
  else if (act === 'rollback') {
    e.preventDefault();
    if (!confirm(`이전 버전(v${S.update.backupVersion})으로 되돌릴까요? 되돌린 뒤에는 자동 업데이트가 꺼져요.`)) return;
    try { await api('/api/update/rollback', {}); await pollUpdate(); drawSettings(); toast('되돌렸어요. 다시 시작하면 이전 버전으로 열려요', { action: { label: '다시 시작', run: restartApp } }); } catch (err) { toastErr(err); }
  }
}

function onSettingsChange(e) {
  if (e.target.dataset.field === 'saveTo') saveSetting({ saveTo: e.target.value });
}

async function installUpdate() {
  try {
    await api('/api/update/install', {});
    S.update = { ...(S.update || {}), status: 'downloading', progress: 0 };
    drawSettings();
    watchUpdate();
  } catch (e) { toastErr(e); }
}

function watchUpdate() {
  clearTimeout(watchUpdate.t);
  watchUpdate.t = setTimeout(async () => {
    await pollUpdate();
    if (S.update && (S.update.status === 'downloading' || S.update.status === 'installing')) watchUpdate();
  }, 700);
}

async function restartApp() {
  try {
    await api('/api/update/restart', {});
    if (!PR.bridge) toast('다시 시작하는 중이에요…');
  } catch (e) { toastErr(e); }
}

function applyTheme() {
  const a = S.settings.appearance;
  if (a === 'light' || a === 'dark') document.documentElement.dataset.theme = a;
  else delete document.documentElement.dataset.theme;
}
PR.applyTheme = applyTheme;

function updateDot() {
  const u = S.update;
  $('#updDot').hidden = !(u && (u.status === 'ready' || (u.status === 'available' && !u.autoUpdate)));
}

async function pollUpdate() {
  try {
    const r = await api('/api/poll', undefined, { noRetry: true });
    const before = S.update && S.update.status;
    S.update = r.update;
    updateDot();
    drawSettings();
    if (S.screen === 'home' && before !== S.update.status && (S.update.status === 'ready' || S.update.status === 'available')) render();
  } catch (e) { /* 조용히 */ }
}
PR.pollUpdate = pollUpdate;

// 지금 화면에 넣은 PDF 를 목록에서 빼요 (분할 · 압축/변환) — 원본 파일은 그대로
function unloadCurrent() {
  if (S.screen === 'split' && SP.id) {
    const prev = { id: SP.id, sel: new Set(SP.sel), ranges: SP.ranges };
    const name = S.files[SP.id] ? S.files[SP.id].name : '파일';
    SP.id = null; SP.sel = new Set(); SP.ranges = '';
    render();
    removedToast(`${name} · 목록에서 뺐어요`, () => { if (S.screen === 'split' && !SP.id) { Object.assign(SP, prev); render(); } });
  } else if (S.screen === 'convert' && CV.id) {
    const prev = { id: CV.id, est: CV.est, pages: CV.pages };
    const name = S.files[CV.id] ? S.files[CV.id].name : '파일';
    CV.id = null; CV.est = null; CV.pages = '';
    render();
    removedToast(`${name} · 목록에서 뺐어요`, () => { if (S.screen === 'convert' && !CV.id) { Object.assign(CV, prev); render(); } });
  }
}

function imgRemove(keys) {
  const before = IP.items.slice();
  const gone = IP.items.filter((x) => keys.includes(x.k));
  if (!gone.length) return;
  IP.items = IP.items.filter((x) => !keys.includes(x.k));
  IP.sel = null;
  render();
  const what = gone.length === 1 ? `${(S.files[gone[0].id] || {}).name || '사진'} · 목록에서 뺐어요` : `사진 ${gone.length}장을 모두 목록에서 뺐어요`;
  removedToast(what, () => { if (S.screen === 'img2pdf') { IP.items = before; render(); } });
}

function clearAll() {
  if (S.screen === 'merge') mergeClear();
  else if (S.screen === 'img2pdf') imgRemove(IP.items.map((x) => x.k));
}

Object.assign(PR, { unloadCurrent, imgRemove, clearAll, M, SP, CV, IP, mergeAdd, mergeUndo, mergeRotate, mergeDelete, mergeRemoveFile, mergeMoveFile, mergeMovePages, mergeSave,
  splitSave, refreshSplitSummary, setSplitFile, setConvertFile, compressSave, toImages, imgAdd, imgMove, imgSave, chooseTask, TASKS, loadEstimate, installUpdate, restartApp });
