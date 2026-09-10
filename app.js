/* ═══════════ 媽媽Play 影片小幫手 — 主程式 ═══════════ */

/* ---------- 儲存（localStorage 不可用時退回記憶體） ---------- */
const store = (() => {
  let ok = false, mem = {};
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); ok = true; } catch (e) {}
  return {
    get(k, d) {
      try { const v = ok ? localStorage.getItem(k) : mem[k]; return v == null ? d : JSON.parse(v); }
      catch (e) { return d; }
    },
    set(k, v) {
      const s = JSON.stringify(v);
      if (ok) { try { localStorage.setItem(k, s); } catch (e) {} }
      mem[k] = s;
    }
  };
})();

const DEFAULT_CATS = ['親子烘焙', '小廚師烘焙夏令營', '小廚師烘焙寒令營', '生日包場烘焙派對'];
const DEFAULT_TAGS = '#{活動名稱} #媽媽Play #台北親子烘焙 #3歲至15歲親子協作或8歲以上獨立製作 #專業親子烘焙老師帶領 #輕鬆逐步完成';
const DEFAULT_PILLS = {
  '親子烘焙': ['和孩子一起輕鬆玩親子烘焙', '大手小手一起做點心', '和孩子的甜甜約會', '做點心，也做回憶', '親子同樂的烘焙時光'],
  '生日包場烘焙派對': ['賓主盡歡的歡樂派對', '專屬你們的烘焙派對', '生日就要這樣慶祝', '自己的蛋糕自己做', '歡樂滿屋的包場派對'],
  '小廚師烘焙夏令營': ['小廚師烘焙手作夏令營'],
  '小廚師烘焙寒令營': ['小廚師烘焙手作寒令營'],
};
const DEFAULT_LOGO = '__LOGO_B64__';

/* ---------- 全域狀態 ---------- */
const S = {
  file: null, url: null, dur: 0, vw: 1080, vh: 1920, fps: 30,
  segments: [],           // {in, out, speed}
  curSeg: -1,
  colorOn: true,
  blurs: [],              // {id, keys:[{t,x,y,w,h}], from, to}  座標為 0..1 相對值
  selBlur: -1,
  category: store.get('mp_cats', DEFAULT_CATS)[0] || '',
  content: '', title: '', pill: '', titlePos: 'top',
  date: '', serial: '01',
  outBlob: null, outName: '',
  previewing: false,
};

const $ = id => document.getElementById(id);
const vid = $('vid');
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); };
const fmtT = s => (Math.round(s * 10) / 10).toFixed(1) + 's';

/* ---------- 畫面切換 ---------- */
function gotoStep(name) {
  document.querySelectorAll('.step').forEach(b => b.classList.toggle('on', b.dataset.s === name));
  document.querySelectorAll('.screen').forEach(sc => sc.classList.toggle('on', sc.id === 'sc-' + name));
  if (name === 'title') { renderTitleUI(); updateTitleOverlay(); }
  if (name === 'out') { updateFilename(); }
  window.scrollTo(0, 0);
}
document.querySelectorAll('.step').forEach(b => b.onclick = () => { if (!b.disabled) gotoStep(b.dataset.s); });

/* ---------- 選擇影片 ---------- */
$('btnPick').onclick = () => $('filePick').click();
$('btnRepick').onclick = () => $('filePick').click();
$('filePick').onchange = e => { const f = e.target.files[0]; if (f) loadVideo(f); };

async function loadVideo(file) {
  S.file = file;
  if (S.url) URL.revokeObjectURL(S.url);
  S.url = URL.createObjectURL(file);
  vid.src = S.url;
  await new Promise((res, rej) => {
    vid.onloadedmetadata = res; vid.onerror = () => rej(new Error('影片無法讀取'));
  });
  S.dur = vid.duration;
  S.vw = vid.videoWidth; S.vh = vid.videoHeight;
  S.segments = [{ in: 0, out: Math.min(S.dur, 30), speed: 1, zoom: { s: 1, cx: 0.5, cy: 0.5 } }];
  S.curSeg = 0; S.blurs = []; S.selBlur = -1;
  // 預設日期＝檔案修改日（近似拍攝日）
  const d = new Date(file.lastModified);
  S.date = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  $('emptyStage').style.display = 'none';
  ['tlCard', 'segCard', 'fxCard', 'nextCutCard'].forEach(id => $(id).style.display = '');
  $('pickCard').style.display = 'none';
  $('scrub').max = S.dur;
  document.querySelectorAll('.step').forEach(b => b.disabled = false);
  renderSegs(); renderBlurBoxes();
  await buildThumbs();
}

/* ---------- 縮圖時間軸 ---------- */
async function buildThumbs() {
  const N = 8, el = $('thumbs'); el.innerHTML = '';
  const c = document.createElement('canvas');
  const ratio = S.vw / S.vh;
  c.height = 88; c.width = Math.round(88 * ratio);
  const cx = c.getContext('2d');
  const seekTo = t => new Promise(res => {
    if (Math.abs(vid.currentTime - t) < 0.001) return res();
    const h = () => { vid.removeEventListener('seeked', h); res(); };
    vid.addEventListener('seeked', h); vid.currentTime = t; });
  for (let i = 0; i < N; i++) {
    await seekTo((i + 0.5) / N * S.dur);
    cx.drawImage(vid, 0, 0, c.width, c.height);
    const img = new Image(); img.src = c.toDataURL('image/jpeg', 0.6);
    el.appendChild(img);
  }
  vid.currentTime = 0;
}

/* ---------- 播放頭 / 播放 ---------- */
$('scrub').oninput = e => { stopPreview(); vid.currentTime = +e.target.value; };
vid.addEventListener('timeupdate', () => {
  $('scrub').value = vid.currentTime;
  $('tcur').textContent = fmtT(vid.currentTime);
  updateBlurPositions();
  applyStageTransform();
  if (S.previewing) previewTick();
});
$('btnPlay').onclick = () => {
  stopPreview();
  if (vid.paused) { vid.play(); $('btnPlay').textContent = '⏸ 暫停'; }
  else { vid.pause(); $('btnPlay').textContent = '▶ 播放'; }
};
vid.addEventListener('pause', () => { if (!S.previewing) $('btnPlay').textContent = '▶ 播放'; });

/* 只播保留片段（依速度） */
$('btnPrevSeg').onclick = () => {
  const segs = sortedSegs(); if (!segs.length) return toast('尚未設定片段');
  S.previewing = true; S._pi = 0;
  vid.currentTime = segs[0].in; vid.playbackRate = segs[0].speed; vid.play();
};
function previewTick() {
  const segs = sortedSegs(); const sg = segs[S._pi];
  if (!sg) return stopPreview();
  if (vid.currentTime >= sg.out - 0.03) {
    S._pi++;
    if (S._pi >= segs.length) { stopPreview(); vid.pause(); return; }
    vid.currentTime = segs[S._pi].in; vid.playbackRate = segs[S._pi].speed;
  }
}
function stopPreview() { S.previewing = false; vid.playbackRate = 1; }

/* ---------- 片段管理 ---------- */
const sortedSegs = () => [...S.segments].sort((a, b) => a.in - b.in);
function renderSegs() {
  const el = $('segList'); el.innerHTML = '';
  S.segments.forEach((sg, i) => {
    if (!sg.zoom) sg.zoom = { s: 1, cx: 0.5, cy: 0.5 };
    const row = document.createElement('div');
    row.className = 'segRow' + (i === S.curSeg ? ' cur' : '');
    const zoomLine = i === S.curSeg ? `
      <span class="row" style="width:100%;gap:4px;margin-top:4px">
        <span style="font-size:12.5px;font-weight:700">🔍 聚焦</span>
        ${[1, 1.3, 1.5, 2].map(z =>
          `<button class="chip${sg.zoom.s === z ? ' on' : ''}" data-z="${z}" style="padding:5px 9px;font-size:12.5px">${z === 1 ? '關' : z + 'x'}</button>`).join('')}
        <span class="hint" style="margin:0">${sg.zoom.s > 1 ? '拖曳畫面調整聚焦位置' : ''}</span>
      </span>` : '';
    row.innerHTML = `<span class="tm">${fmtT(sg.in)} → ${fmtT(sg.out)}</span>
      <span class="spd">${[1, 1.5, 2, 3].map(x =>
        `<button class="chip${sg.speed === x ? ' on' : ''}" data-x="${x}">${x}x</button>`).join('')}</span>
      <button class="x" title="刪除">✕</button>${zoomLine}`;
    row.onclick = e => {
      S.curSeg = i;
      if (e.target.dataset.x) { sg.speed = +e.target.dataset.x; }
      if (e.target.dataset.z) {
        sg.zoom.s = +e.target.dataset.z;
        // 進入聚焦時跳到片段內，方便即時預覽
        if (vid.currentTime < sg.in || vid.currentTime > sg.out) vid.currentTime = sg.in;
      }
      if (e.target.classList.contains('x')) {
        S.segments.splice(i, 1); if (S.curSeg >= S.segments.length) S.curSeg = S.segments.length - 1;
      }
      renderSegs(); applyStageTransform();
    };
    el.appendChild(row);
  });
  drawSegBar();
}
function drawSegBar() {
  const bar = $('segBar'); bar.innerHTML = '';
  S.segments.forEach((sg, i) => {
    const sp = document.createElement('div');
    sp.className = 'segSpan' + (i === S.curSeg ? ' cur' : '');
    sp.style.left = (sg.in / S.dur * 100) + '%';
    sp.style.width = ((sg.out - sg.in) / S.dur * 100) + '%';
    bar.appendChild(sp);
  });
}
$('btnAddSeg').onclick = () => {
  const t = vid.currentTime;
  S.segments.push({ in: t, out: Math.min(S.dur, t + 5), speed: 1, zoom: { s: 1, cx: 0.5, cy: 0.5 } });
  S.curSeg = S.segments.length - 1; renderSegs();
  toast('已新增片段，請調整起訖點');
};

/* ---------- 畫面縮放（片段聚焦＋模糊微調共用） ---------- */
S.stageZ = 1; S.blurZoom = false;
function currentSegAt(t) {
  return sortedSegs().find(sg => t >= sg.in - 0.02 && t <= sg.out + 0.02);
}
function applyStageTransform() {
  const zw = $('zoomWrap');
  let s = 1, cx = 0.5, cy = 0.5;
  if (S.blurZoom && S.selBlur >= 0) {
    s = 2.2;
    if (!S.blurZoomC) {
      const b = S.blurs[S.selBlur];
      const r = blurRectAt(b, vid.currentTime) || b.keys[0];
      S.blurZoomC = { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
    }
    cx = S.blurZoomC.cx; cy = S.blurZoomC.cy;
  } else {
    const sg = currentSegAt(vid.currentTime);
    if (sg && sg.zoom && sg.zoom.s > 1) { s = sg.zoom.s; cx = sg.zoom.cx; cy = sg.zoom.cy; }
  }
  cx = Math.min(Math.max(cx, 0.5 / s), 1 - 0.5 / s);
  cy = Math.min(Math.max(cy, 0.5 / s), 1 - 0.5 / s);
  S.stageZ = s;
  zw.style.transform = s === 1 ? '' :
    `translate(${(0.5 - s * cx) * 100}%, ${(0.5 - s * cy) * 100}%) scale(${s})`;
}
/* 拖曳畫面移動視野：聚焦模式移動聚焦位置；區域放大模式移動檢視範圍 */
(() => {
  const zw = $('zoomWrap');
  let mode = null, sx = 0, sy = 0, c0 = null, sg0 = null;
  zw.addEventListener('pointerdown', e => {
    if (e.target.closest('.blurBox')) return;
    if (S.blurZoom && S.selBlur >= 0) {
      if (!S.blurZoomC) applyStageTransform();
      mode = 'blur'; c0 = { ...S.blurZoomC };
    } else {
      const sg = currentSegAt(vid.currentTime) || (S.curSeg >= 0 ? S.segments[S.curSeg] : null);
      if (!sg || !sg.zoom || sg.zoom.s <= 1) return;
      mode = 'seg'; sg0 = sg; c0 = { cx: sg.zoom.cx, cy: sg.zoom.cy };
    }
    sx = e.clientX; sy = e.clientY;
    zw.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  zw.addEventListener('pointermove', e => {
    if (!mode) return;
    const st = $('stage').getBoundingClientRect();
    if (mode === 'blur') {
      const s = 2.2;
      S.blurZoomC = {
        cx: Math.min(Math.max(c0.cx - (e.clientX - sx) / st.width / s, 0.5 / s), 1 - 0.5 / s),
        cy: Math.min(Math.max(c0.cy - (e.clientY - sy) / st.height / s, 0.5 / s), 1 - 0.5 / s),
      };
    } else {
      const s = sg0.zoom.s;
      sg0.zoom.cx = Math.min(Math.max(c0.cx - (e.clientX - sx) / st.width / s, 0.5 / s), 1 - 0.5 / s);
      sg0.zoom.cy = Math.min(Math.max(c0.cy - (e.clientY - sy) / st.height / s, 0.5 / s), 1 - 0.5 / s);
    }
    applyStageTransform();
  });
  const end = () => { mode = null; };
  zw.addEventListener('pointerup', end); zw.addEventListener('pointercancel', end);
})();
$('btnSetIn').onclick = () => {
  if (S.curSeg < 0) return toast('請先選一個片段');
  const sg = S.segments[S.curSeg]; sg.in = vid.currentTime;
  if (sg.out <= sg.in) sg.out = Math.min(S.dur, sg.in + 3);
  renderSegs();
};
$('btnSetOut').onclick = () => {
  if (S.curSeg < 0) return toast('請先選一個片段');
  const sg = S.segments[S.curSeg]; sg.out = vid.currentTime;
  if (sg.out <= sg.in) sg.in = Math.max(0, sg.out - 3);
  renderSegs();
};

/* ---------- 色彩預設 ---------- */
const COLOR_FILTER = 'brightness(1.07) saturate(1.08) sepia(0.12)';
$('chipColor').onclick = () => {
  S.colorOn = !S.colorOn;
  $('chipColor').classList.toggle('on', S.colorOn);
  applyPreviewFilter();
};
function applyPreviewFilter() { vid.style.filter = S.colorOn ? COLOR_FILTER : ''; }
applyPreviewFilter();

/* ---------- 模糊框 ---------- */
let blurSeq = 0;
$('btnAddBlur').onclick = () => {
  if (!S.file) return toast('請先選擇影片');
  vid.pause(); stopPreview();
  const t = vid.currentTime;
  S.blurs.push({ id: ++blurSeq, keys: [{ t, x: 0.35, y: 0.42, w: 0.3, h: 0.12 }], from: t, to: S.dur });
  S.selBlur = S.blurs.length - 1;
  renderBlurBoxes(); syncBlurBtns();
  toast('拖曳模糊框蓋住姓名，右下圓點調大小');
};
$('btnDelBlur').onclick = () => {
  if (S.selBlur < 0) return;
  S.blurs.splice(S.selBlur, 1); S.selBlur = -1;
  renderBlurBoxes(); syncBlurBtns();
};
$('btnBlurFrom').onclick = () => { if (S.selBlur >= 0) { S.blurs[S.selBlur].from = vid.currentTime; toast('此框從 ' + fmtT(vid.currentTime) + ' 開始'); } };
$('btnBlurTo').onclick = () => { if (S.selBlur >= 0) { S.blurs[S.selBlur].to = vid.currentTime; toast('此框到 ' + fmtT(vid.currentTime) + ' 結束'); } };
function syncBlurBtns() {
  const on = S.selBlur >= 0;
  ['btnBlurFrom', 'btnBlurTo', 'btnDelBlur'].forEach(id => $(id).disabled = !on);
  $('fineRow').hidden = !on;
  if (!on) { S.blurZoom = false; S.blurZoomC = null; $('btnZoomEdit').classList.remove('on', 'pri'); }
  applyStageTransform();
}
/* 區域放大：以選取的模糊框為中心放大 2.2 倍，方便手指微調 */
$('btnZoomEdit').onclick = () => {
  S.blurZoom = !S.blurZoom;
  S.blurZoomC = null;   // 重新以選取的模糊框為中心
  $('btnZoomEdit').classList.toggle('on', S.blurZoom);
  $('btnZoomEdit').classList.toggle('pri', S.blurZoom);
  applyStageTransform();
  if (S.blurZoom) toast('拖曳空白處可移動放大範圍');
};
/* 微調鈕：箭頭移動、＋－調大小（以目前時間記錄追蹤點） */
document.querySelectorAll('.nud').forEach(btn => {
  const act = () => {
    if (S.selBlur < 0) return;
    const b = S.blurs[S.selBlur];
    const r = { ...(blurRectAt(b, vid.currentTime) || b.keys[0]) };
    const st = 0.008, sz = 0.012, n = btn.dataset.n;
    if (n === 'l') r.x -= st; if (n === 'r') r.x += st;
    if (n === 'u') r.y -= st; if (n === 'd') r.y += st;
    if (n === 'big') { r.w += sz; r.h += sz * 0.6; r.x -= sz / 2; r.y -= sz * 0.3; }
    if (n === 'small') { r.w = Math.max(0.04, r.w - sz); r.h = Math.max(0.02, r.h - sz * 0.6); r.x += sz / 2; r.y += sz * 0.3; }
    r.x = Math.min(Math.max(r.x, 0), 1 - r.w); r.y = Math.min(Math.max(r.y, 0), 1 - r.h);
    setBlurKey(b, vid.currentTime, { x: r.x, y: r.y, w: r.w, h: r.h });
    updateBlurPositions();
  };
  btn.onclick = act;
});

/* 關鍵影格內插 */
function blurRectAt(b, t) {
  if (t < b.from - 0.05 || t > b.to + 0.05) return null;
  const ks = b.keys;
  if (t <= ks[0].t) return ks[0];
  if (t >= ks[ks.length - 1].t) return ks[ks.length - 1];
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], c = ks[i + 1];
    if (t >= a.t && t <= c.t) {
      const f = (t - a.t) / (c.t - a.t || 1);
      return { x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f,
               w: a.w + (c.w - a.w) * f, h: a.h + (c.h - a.h) * f };
    }
  }
  return ks[0];
}
function setBlurKey(b, t, rect) {
  const k = { t, ...rect };
  const i = b.keys.findIndex(o => Math.abs(o.t - t) < 0.15);
  if (i >= 0) b.keys[i] = k; else { b.keys.push(k); b.keys.sort((a, c) => a.t - c.t); }
}

/* 模糊框 DOM 與拖曳 */
function renderBlurBoxes() {
  const layer = $('blurLayer'); layer.innerHTML = '';
  S.blurs.forEach((b, i) => {
    const el = document.createElement('div');
    el.className = 'blurBox' + (i === S.selBlur ? ' sel' : '');
    el.dataset.i = i;
    el.innerHTML = `<span class="tag">模糊 ${i + 1}</span><div class="hd"></div>`;
    layer.appendChild(el);
    attachDrag(el, b);
  });
  updateBlurPositions();
}
function updateBlurPositions() {
  const st = $('stage').getBoundingClientRect();
  document.querySelectorAll('.blurBox').forEach(el => {
    const b = S.blurs[+el.dataset.i];
    if (!b) return;
    const r = blurRectAt(b, vid.currentTime);
    if (!r) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.left = (r.x * st.width) + 'px'; el.style.top = (r.y * st.height) + 'px';
    el.style.width = (r.w * st.width) + 'px'; el.style.height = (r.h * st.height) + 'px';
  });
}
function attachDrag(el, b) {
  const stage = $('stage');
  let mode = null, sx = 0, sy = 0, r0 = null;
  const down = (e, m) => {
    e.preventDefault(); e.stopPropagation();
    vid.pause(); stopPreview();
    S.selBlur = S.blurs.indexOf(b);
    document.querySelectorAll('.blurBox').forEach(x => x.classList.remove('sel'));
    el.classList.add('sel'); syncBlurBtns();
    mode = m; sx = e.clientX; sy = e.clientY;
    r0 = { ...(blurRectAt(b, vid.currentTime) || b.keys[0]) };
    el.setPointerCapture(e.pointerId);
  };
  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('hd')) down(e, 'size'); else down(e, 'move');
  });
  el.addEventListener('pointermove', e => {
    if (!mode) return;
    const st = stage.getBoundingClientRect();
    const dx = (e.clientX - sx) / st.width / S.stageZ, dy = (e.clientY - sy) / st.height / S.stageZ;
    let r;
    if (mode === 'move') r = { ...r0, x: Math.min(Math.max(r0.x + dx, 0), 1 - r0.w), y: Math.min(Math.max(r0.y + dy, 0), 1 - r0.h) };
    else r = { ...r0, w: Math.min(Math.max(r0.w + dx, 0.05), 1 - r0.x), h: Math.min(Math.max(r0.h + dy, 0.03), 1 - r0.y) };
    setBlurKey(b, vid.currentTime, { x: r.x, y: r.y, w: r.w, h: r.h });
    updateBlurPositions();
  });
  const up = () => { mode = null; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

/* ---------- 標題系統 ---------- */
function getCats() { return store.get('mp_cats', DEFAULT_CATS); }
function getPills() { return store.get('mp_pills', DEFAULT_PILLS); }
function pillsFor(cat) { return (getPills()[cat] || []).filter(x => x.trim()); }
function renderTitleUI() {
  // 分類
  const cats = getCats();
  if (!cats.includes(S.category)) S.category = cats[0] || '';
  const cc = $('catChips'); cc.innerHTML = '';
  cats.forEach(c => {
    const b = document.createElement('button');
    b.className = 'chip' + (c === S.category ? ' on' : ''); b.textContent = c;
    b.onclick = () => { S.category = c; S.pill = pillsFor(c)[0] || c; renderTitleUI(); autoTitle(); };
    cc.appendChild(b);
  });
  // 分類標語
  if (!S.pill) S.pill = pillsFor(S.category)[0] || S.category;
  const pc = $('pillChips'); pc.innerHTML = '';
  pillsFor(S.category).forEach(t => {
    const b = document.createElement('button');
    b.className = 'chip' + (t === S.pill ? ' on' : '');
    b.style.fontSize = '12.5px';
    b.textContent = t.length > 15 ? t.slice(0, 15) + '…' : t;
    b.title = t;
    b.onclick = () => { S.pill = t; $('inpPill').value = t; renderTitleUI(); updateTitleOverlay(); };
    pc.appendChild(b);
  });
  $('inpPill').value = S.pill;
  // 記憶
  renderRecent('mp_recentContents', 'recentContents', v => { S.content = v; $('inpContent').value = v; autoTitle(); });
  renderRecent('mp_recentTitles', 'recentTitles', v => { S.title = v; $('inpTitle').value = v; titleTouched = true; updateTitleOverlay(); });
}
$('inpPill').oninput = e => { S.pill = e.target.value; updateTitleOverlay(); };
function renderRecent(key, elId, onPick) {
  const arr = store.get(key, []); const el = $(elId); el.innerHTML = '';
  arr.forEach(v => {
    const b = document.createElement('button');
    b.className = 'chip'; b.style.fontSize = '12.5px';
    b.textContent = v.length > 14 ? v.slice(0, 14) + '…' : v;
    b.title = v; b.onclick = () => onPick(v);
    el.appendChild(b);
  });
}
function pushRecent(key, v) {
  if (!v) return;
  let arr = store.get(key, []).filter(x => x !== v);
  arr.unshift(v); store.set(key, arr.slice(0, 3));
}
let titleTouched = false;
$('inpContent').oninput = e => { S.content = e.target.value.trim(); autoTitle(); };
$('inpTitle').oninput = e => { S.title = e.target.value; titleTouched = true; updateTitleOverlay(); };
function autoTitle() {
  if (titleTouched && $('inpTitle').value.trim()) return;   // 已手動改過就不覆蓋
  S.title = S.content || '';
  $('inpTitle').value = S.title;
  updateTitleOverlay();
}
document.querySelectorAll('[data-pos]').forEach(b => b.onclick = () => {
  S.titlePos = b.dataset.pos;
  document.querySelectorAll('[data-pos]').forEach(x => x.classList.toggle('on', x === b));
  updateTitleOverlay();
});

/* 標題畫成 canvas（輸出與預覽共用，確保一致）
   結構：橘色主標題框（1–2 行）＋下方藍綠色分類標語小框 */
function renderTitleCanvas(scale) {   // scale: 相對 1080 寬的倍率
  const text = (S.title || '').trim();
  const pill = (S.pill || '').trim();
  if (!text && !pill) return null;
  const lines = text ? text.split('\n').filter(l => l.trim() !== '').slice(0, 2) : [];
  const W = 1080 * scale;
  const FONT = f => `900 ${f}px "Noto Sans TC", system-ui, sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');

  // 主標題框
  let font = 66 * scale;
  const padX = 44 * scale, padY = 26 * scale, lh = 1.38, maxW = W * 0.86 - padX * 2;
  let boxW = 0, boxH = 0;
  if (lines.length) {
    meas.font = FONT(font);
    let wMax = Math.max(...lines.map(l => meas.measureText(l).width));
    while (wMax > maxW && font > 30 * scale) { font -= 2 * scale; meas.font = FONT(font);
      wMax = Math.max(...lines.map(l => meas.measureText(l).width)); }
    boxW = Math.min(W * 0.86, wMax + padX * 2);
    boxH = lines.length * font * lh + padY * 2;
  }

  // 分類標語小框（藥丸形，兩端 100% 圓弧，疊放 50% 在主標題框上）
  let pFont = 46 * scale, pPadX = 32 * scale, pPadY = 15 * scale, pillW = 0, pillH = 0;
  if (pill) {
    meas.font = FONT(pFont);
    let pw = meas.measureText(pill).width;
    while (pw > W * 0.84 - pPadX * 2 && pFont > 24 * scale) { pFont -= 2 * scale; meas.font = FONT(pFont); pw = meas.measureText(pill).width; }
    pillW = pw + pPadX * 2;
    pillH = pFont + pPadY * 2;
  }

  // 橘框向下延伸：讓疊上來的藍色小框與最後一行文字保持舒適間隔
  if (pill && lines.length) boxH += pillH * 0.5 + 8 * scale;
  const overlap = (pill && lines.length) ? pillH * 0.5 : 0;   // 疊放 50%
  const totW = Math.ceil(Math.max(boxW, pillW));
  const totH = Math.ceil(boxH + pillH - overlap);
  const c = document.createElement('canvas');
  c.width = Math.max(totW, 2); c.height = Math.max(totH, 2);
  const g = c.getContext('2d');

  if (lines.length) {
    g.fillStyle = 'rgba(238,143,48,0.80)';
    g.beginPath(); g.roundRect((totW - boxW) / 2, 0, boxW, boxH, 18 * scale); g.fill();
    g.font = FONT(font);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 4 * scale; g.shadowOffsetY = 1 * scale;
    lines.forEach((l, i) => g.fillText(l, totW / 2, padY + font * lh * (i + 0.5)));
    g.shadowColor = 'transparent';
  }
  if (pill) {
    const py = boxH - overlap;
    g.fillStyle = 'rgba(106,178,188,0.92)';
    g.beginPath(); g.roundRect((totW - pillW) / 2, py, pillW, pillH, pillH / 2); g.fill();
    g.font = FONT(pFont);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.15)'; g.shadowBlur = 3 * scale; g.shadowOffsetY = 1 * scale;
    g.fillText(pill, totW / 2, py + pillH / 2 + 1 * scale);
  }
  return c;
}
const POS_Y = { top: 0.20, mid: 0.50, bot: 0.78 };
function updateTitleOverlay() {
  const c = renderTitleCanvas(0.5);
  const ov = $('titleOverlay');
  if (!c) { ov.style.display = 'none'; return; }
  ov.style.display = '';
  $('titleImg').src = c.toDataURL();
  const st = $('stage').getBoundingClientRect();
  ov.style.width = (c.width / (1080 * 0.5) * st.width) + 'px';
  ov.style.top = (POS_Y[S.titlePos] * 100) + '%';
}

/* ---------- Logo ---------- */
function loadLogoUI() {
  const d = store.get('mp_logo', DEFAULT_LOGO);
  if (d) {
    $('logoPrev').src = d; $('logoPrev').style.display = ''; $('btnLogoDel').style.display = '';
    $('logoOverlay').src = d; $('logoOverlay').style.display = '';
  } else {
    $('logoPrev').style.display = 'none'; $('btnLogoDel').style.display = 'none';
    $('logoOverlay').style.display = 'none';
  }
}
$('btnLogoPick').onclick = () => $('logoPick').click();
$('logoPick').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => { store.set('mp_logo', rd.result); loadLogoUI(); toast('Logo 已設定'); };
  rd.readAsDataURL(f);
};
$('btnLogoDel').onclick = () => { store.set('mp_logo', DEFAULT_LOGO); loadLogoUI(); toast('已還原為內建 Logo'); };

/* ---------- 設定 ---------- */
$('btnSettings').onclick = () => { renderSettings(); $('mSettings').classList.add('show'); };
$('btnCloseSettings').onclick = () => {
  store.set('mp_tags', $('inpTags').value);
  store.set('mp_drive', $('inpDrive').value.trim());
  // 儲存各分類標語清單
  const pills = {};
  document.querySelectorAll('#pillManage textarea').forEach(ta => {
    pills[ta.dataset.cat] = ta.value.split('\n').map(x => x.trim()).filter(Boolean);
  });
  if (Object.keys(pills).length) store.set('mp_pills', pills);
  S.pill = '';
  $('mSettings').classList.remove('show');
  renderTitleUI(); updateTitleOverlay();
};
function renderSettings() {
  $('inpTags').value = store.get('mp_tags', DEFAULT_TAGS);
  $('inpDrive').value = store.get('mp_drive', '');
  // 標語清單
  const pm = $('pillManage'); pm.innerHTML = '';
  const pills = getPills();
  getCats().forEach(cat => {
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:13px;font-weight:700;margin:8px 0 4px';
    lbl.textContent = cat;
    const ta = document.createElement('textarea');
    ta.rows = Math.max(2, (pills[cat] || []).length);
    ta.dataset.cat = cat;
    ta.value = (pills[cat] || []).join('\n');
    pm.appendChild(lbl); pm.appendChild(ta);
  });
  const el = $('catManage'); el.innerHTML = '';
  getCats().forEach((c, i) => {
    const row = document.createElement('div'); row.className = 'mgRow';
    row.innerHTML = `<span>${c}</span><button class="btn sm warn">刪除</button>`;
    row.querySelector('button').onclick = () => {
      const arr = getCats(); arr.splice(i, 1); store.set('mp_cats', arr); renderSettings();
    };
    el.appendChild(row);
  });
  loadLogoUI();
}
$('btnAddCat').onclick = () => {
  const v = $('inpNewCat').value.trim(); if (!v) return;
  const arr = getCats(); if (!arr.includes(v)) arr.push(v);
  store.set('mp_cats', arr); $('inpNewCat').value = ''; renderSettings();
};

/* ---------- 檔名 ---------- */
$('btnToTitle').onclick = () => {
  if (!S.segments.length) return toast('請至少保留一個片段');
  gotoStep('title');
};
$('btnToOut').onclick = () => {
  if (!S.title.trim()) return toast('請輸入標題文字');
  pushRecent('mp_recentContents', S.content);
  pushRecent('mp_recentTitles', S.title);
  gotoStep('out');
};
function nameBase() {
  return `${S.category}+${S.content || '活動'}_${S.date}_${S.serial}`;
}
function updateFilename() {
  // 流水號：同活動同日自動遞增
  const key = S.category + '|' + S.content + '|' + S.date;
  const map = store.get('mp_serial', {});
  if (!S._serialTouched) S.serial = String((map[key] || 0) + 1).padStart(2, '0');
  $('inpDate').value = S.date; $('inpSerial').value = S.serial;
  $('fnPreview').textContent = `後製檔：${nameBase()}_後製.mp4　／　原始檔請命名：${nameBase()}_原始.mp4`;
}
$('inpDate').oninput = e => { S.date = e.target.value.trim(); updateFilename(); };
$('inpSerial').oninput = e => { S.serial = e.target.value.trim().padStart(2, '0'); S._serialTouched = true;
  $('fnPreview').textContent = `後製檔：${nameBase()}_後製.mp4　／　原始檔請命名：${nameBase()}_原始.mp4`; };

/* ---------- 文案 ---------- */
function buildCopyText() {
  const tags = store.get('mp_tags', DEFAULT_TAGS).replace(/\{活動名稱\}/g, S.content || S.category);
  const head = [S.title, S.pill].filter(Boolean).join('\n');
  return head + '\n\n' + tags;
}

/* ═══════════ 輸出引擎 ═══════════ */
const OUT_W = 1080, OUT_H = 1920, OUT_FPS = 30;

function buildPlan() {
  const segs = sortedSegs();
  let cum = 0;
  const plan = segs.map(sg => {
    const dOut = (sg.out - sg.in) / sg.speed;
    const p = { ...sg, start: cum, end: cum + dOut };
    cum += dOut; return p;
  });
  return { plan, total: cum };
}
function segOfPlan(plan, tOut) {
  for (const p of plan) if (tOut < p.end + 1e-6) return p;
  return plan[plan.length - 1];
}
function srcTimeAt(plan, tOut) {
  const p = segOfPlan(plan, tOut);
  return Math.min(p.in + Math.max(0, tOut - p.start) * p.speed, p.out - 0.001);
}

async function exportVideo(progressCb) {
  const { plan, total } = buildPlan();
  if (!plan.length || total < 0.5) throw new Error('片段太短或未設定');
  const totalFrames = Math.max(1, Math.round(total * OUT_FPS));

  /* — 編碼器支援偵測 — */
  if (!('VideoEncoder' in window)) throw new Error('此瀏覽器不支援影片編碼（請用新版 Chrome）');
  let vCodec = 'avc1.640028', vCodecId = 'avc';
  let vc = await VideoEncoder.isConfigSupported({ codec: vCodec, width: OUT_W, height: OUT_H, framerate: OUT_FPS });
  if (!vc.supported) {
    vCodec = 'vp09.00.40.08'; vCodecId = 'vp9';
    vc = await VideoEncoder.isConfigSupported({ codec: vCodec, width: OUT_W, height: OUT_H, framerate: OUT_FPS });
    if (!vc.supported) throw new Error('找不到可用的影片編碼器');
  }

  /* — 音訊解碼（整段） — */
  let audioBuf = null;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    const ab = await S.file.arrayBuffer();
    audioBuf = await ac.decodeAudioData(ab);
    ac.close();
  } catch (e) { console.warn('音訊解碼失敗，輸出將無聲音', e); }

  let aCodec = null, aCodecId = null, aRate = 48000, aCh = 1;
  if (audioBuf && 'AudioEncoder' in window) {
    aRate = audioBuf.sampleRate; aCh = Math.min(audioBuf.numberOfChannels, 2);
    for (const [codec, id] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      try {
        const r = aCodecId === null && await AudioEncoder.isConfigSupported({
          codec, sampleRate: id === 'opus' ? 48000 : aRate, numberOfChannels: aCh, bitrate: 128000 });
        if (r && r.supported) { aCodec = codec; aCodecId = id; break; }
      } catch (e) {}
    }
    if (aCodecId === 'opus') aRate = 48000;
  }

  /* — Muxer — */
  const muxOpts = {
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: vCodecId, width: OUT_W, height: OUT_H },
    fastStart: 'in-memory',
  };
  if (aCodecId) muxOpts.audio = { codec: aCodecId, numberOfChannels: aCh, sampleRate: aRate };
  const muxer = new Mp4Muxer.Muxer(muxOpts);

  let encErr = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encErr = e; },
  });
  venc.configure({ codec: vCodec, width: OUT_W, height: OUT_H, framerate: OUT_FPS,
    bitrate: 8_000_000, latencyMode: 'quality' });

  /* — 疊圖素材 — */
  const titleC = renderTitleCanvas(1);
  const titleY = POS_Y[S.titlePos] * OUT_H;
  let logoImg = null;
  const logoData = store.get('mp_logo', DEFAULT_LOGO);
  if (logoData) {
    logoImg = new Image();
    await new Promise(res => { logoImg.onload = res; logoImg.onerror = () => { logoImg = null; res(); }; logoImg.src = logoData; });
  }

  /* — 畫布 — */
  const main = document.createElement('canvas'); main.width = OUT_W; main.height = OUT_H;
  const mx = main.getContext('2d', { willReadFrequently: false });
  const blurC = document.createElement('canvas'); const bx = blurC.getContext('2d');

  /* — 直接使用畫面上已載入的預覽影片抽格（另建元件在部分手機環境會載入失敗） — */
  const v = vid;
  v.pause(); stopPreview();
  const seek = t => new Promise(res => {
    const target = Math.min(Math.max(t, 0), S.dur - 0.001);
    if (Math.abs(v.currentTime - target) < 0.0005) return res();
    const to = setTimeout(() => { v.removeEventListener('seeked', h); res(); }, 2000); // 防呆：卡住就用當前畫面
    const h = () => { clearTimeout(to); v.removeEventListener('seeked', h); res(); };
    v.addEventListener('seeked', h);
    v.currentTime = target;
  });

  // 來源畫面 cover 縮放參數
  const sRatio = S.vw / S.vh, dRatio = OUT_W / OUT_H;
  let sw, sh, sx0, sy0;
  if (sRatio > dRatio) { sh = S.vh; sw = S.vh * dRatio; sx0 = (S.vw - sw) / 2; sy0 = 0; }
  else { sw = S.vw; sh = S.vw / dRatio; sx0 = 0; sy0 = (S.vh - sh) / 2; }

  /* — 逐格處理 — */
  for (let n = 0; n < totalFrames; n++) {
    if (encErr) throw encErr;
    const tOut = n / OUT_FPS;
    const p = segOfPlan(plan, tOut);
    const tSrc = Math.min(p.in + Math.max(0, tOut - p.start) * p.speed, p.out - 0.001);
    await seek(tSrc);

    // 片段聚焦（放大裁切）
    let winX = 0, winY = 0, winS = 1;
    if (p.zoom && p.zoom.s > 1) {
      winS = p.zoom.s;
      const half = 0.5 / winS;
      winX = Math.min(Math.max(p.zoom.cx, half), 1 - half) - half;
      winY = Math.min(Math.max(p.zoom.cy, half), 1 - half) - half;
    }
    mx.filter = S.colorOn ? COLOR_FILTER : 'none';
    mx.drawImage(v, sx0 + winX * sw, sy0 + winY * sh, sw / winS, sh / winS, 0, 0, OUT_W, OUT_H);
    mx.filter = 'none';

    // 模糊框（座標依聚焦轉換，並外擴 12% 容錯）
    for (const b of S.blurs) {
      let r = blurRectAt(b, tSrc);
      if (!r) continue;
      const mgx = r.w * 0.12, mgy = r.h * 0.12;
      let nx = (r.x - mgx - winX) * winS, ny = (r.y - mgy - winY) * winS;
      let nw = (r.w + mgx * 2) * winS, nh = (r.h + mgy * 2) * winS;
      // 裁到畫面內
      if (nx < 0) { nw += nx; nx = 0; }
      if (ny < 0) { nh += ny; ny = 0; }
      nw = Math.min(nw, 1 - nx); nh = Math.min(nh, 1 - ny);
      if (nw <= 0.005 || nh <= 0.005) continue;
      const rx = nx * OUT_W, ry = ny * OUT_H, rw = nw * OUT_W, rh = nh * OUT_H;
      blurC.width = Math.max(2, Math.round(rw)); blurC.height = Math.max(2, Math.round(rh));
      bx.filter = 'blur(4px)';
      // 先縮小再放大 + blur，強化遮蔽
      bx.drawImage(main, rx, ry, rw, rh, 0, 0, blurC.width / 6, blurC.height / 6);
      bx.drawImage(blurC, 0, 0, blurC.width / 6, blurC.height / 6, 0, 0, blurC.width, blurC.height);
      bx.filter = 'none';
      mx.drawImage(blurC, rx, ry, rw, rh);
    }

    // 標題
    if (titleC) mx.drawImage(titleC, (OUT_W - titleC.width) / 2, titleY - titleC.height / 2);
    // Logo（右下角，寬 19%，往內縮 logo 尺寸的 50%）
    if (logoImg) {
      const lw = OUT_W * 0.19, lh2 = lw * logoImg.height / logoImg.width;
      mx.drawImage(logoImg, OUT_W - lw - OUT_W * 0.015 - lw * 0.5, OUT_H - lh2 - OUT_H * 0.012 - lh2 * 0.5, lw, lh2);
    }

    const frame = new VideoFrame(main, { timestamp: Math.round(n / OUT_FPS * 1e6), duration: Math.round(1e6 / OUT_FPS) });
    venc.encode(frame, { keyFrame: n % 90 === 0 });
    frame.close();
    if (venc.encodeQueueSize > 6) await new Promise(res => setTimeout(res, 30));
    if (n % 5 === 0) progressCb(n / totalFrames * (aCodecId ? 0.9 : 0.98), `處理畫面 ${n}/${totalFrames}`);
  }
  await venc.flush(); venc.close();
  if (encErr) throw encErr;

  /* — 音訊組裝與編碼 — */
  if (audioBuf && aCodecId) {
    progressCb(0.92, '處理聲音…');
    const srcRate = audioBuf.sampleRate;
    const outSamples = Math.round(total * aRate);
    const chans = [];
    for (let c = 0; c < aCh; c++) chans.push(audioBuf.getChannelData(Math.min(c, audioBuf.numberOfChannels - 1)));
    const out = new Float32Array(outSamples * aCh);   // interleaved
    for (let m = 0; m < outSamples; m++) {
      const tOut = m / aRate;
      const tSrc = srcTimeAt(plan, tOut);
      const pos = tSrc * srcRate;
      const i0 = Math.floor(pos), f = pos - i0;
      for (let c = 0; c < aCh; c++) {
        const d = chans[c];
        const s0 = d[Math.min(i0, d.length - 1)] || 0, s1 = d[Math.min(i0 + 1, d.length - 1)] || 0;
        out[m * aCh + c] = s0 + (s1 - s0) * f;
      }
    }
    let aErr = null;
    const aenc = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: e => { aErr = e; },
    });
    aenc.configure({ codec: aCodec, sampleRate: aRate, numberOfChannels: aCh, bitrate: 128000 });
    const CH = 1024 * 24;
    for (let off = 0; off < outSamples; off += CH) {
      const len = Math.min(CH, outSamples - off);
      const ad = new AudioData({
        format: 'f32', sampleRate: aRate, numberOfFrames: len, numberOfChannels: aCh,
        timestamp: Math.round(off / aRate * 1e6),
        data: out.subarray(off * aCh, (off + len) * aCh),
      });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
    if (aErr) console.warn('音訊編碼錯誤，改為無聲輸出', aErr);
  }

  progressCb(0.99, '寫入檔案…');
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  return { blob, hasAudio: !!aCodecId, vCodecId };
}

/* ---------- 輸出流程 ---------- */
$('btnExport').onclick = async () => {
  const btn = $('btnExport');
  btn.disabled = true;
  ['btnPlay', 'btnPrevSeg', 'scrub', 'btnRepick'].forEach(id => $(id).disabled = true);
  $('prog').style.display = ''; $('doneCard').style.display = 'none';
  vid.pause(); stopPreview();
  try {
    const t0 = performance.now();
    const { blob, vCodecId } = await exportVideo((p, msg) => {
      $('progIn').style.width = Math.round(p * 100) + '%';
      $('progTxt').textContent = msg;
    });
    S.outBlob = blob;
    S.outName = `${nameBase()}_後製.mp4`;
    // 記住流水號
    const key = S.category + '|' + S.content + '|' + S.date;
    const map = store.get('mp_serial', {});
    map[key] = Math.max(map[key] || 0, parseInt(S.serial, 10) || 0);
    store.set('mp_serial', map);
    $('progIn').style.width = '100%';
    $('progTxt').textContent = `完成！耗時 ${((performance.now() - t0) / 1000).toFixed(0)} 秒，檔案 ${(blob.size / 1048576).toFixed(1)} MB` +
      (vCodecId !== 'avc' ? '（注意：此瀏覽器不支援 H.264，輸出為 VP9 測試格式）' : '');
    $('copyBox').textContent = buildCopyText();
    $('doneCard').style.display = 'block';
    $('doneCard').scrollIntoView({ behavior: 'smooth' });
    const dl = store.get('mp_drive', ''); if (dl) $('lnkDrive').href = dl;
  } catch (e) {
    console.error(e);
    $('progTxt').textContent = '輸出失敗：' + (e && e.message ? e.message : e);
  }
  btn.disabled = false;
  ['btnPlay', 'btnPrevSeg', 'scrub', 'btnRepick'].forEach(id => $(id).disabled = false);
};

/* 下載影片：一定由使用者親手點擊觸發，避免瀏覽器擋自動下載 */
$('btnSaveVid').onclick = () => {
  if (!S.outBlob) return toast('請先輸出影片');
  const url = URL.createObjectURL(S.outBlob);
  const a = document.createElement('a');
  a.href = url; a.download = S.outName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  toast('已開始下載：' + S.outName);
};

$('btnCopy').onclick = async () => {
  try { await navigator.clipboard.writeText(buildCopyText()); toast('文案已複製'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = buildCopyText();
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    toast('文案已複製');
  }
};
$('btnShare').onclick = async () => {
  if (!S.outBlob) return;
  const f = new File([S.outBlob], S.outName, { type: 'video/mp4' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f], text: buildCopyText() }); } catch (e) {}
  } else toast('此瀏覽器不支援直接分享，請用已下載的檔案');
};
$('btnAgain').onclick = () => {
  S.segments = []; S.blurs = []; S.selBlur = -1; S.curSeg = -1;
  S.content = ''; S.title = ''; titleTouched = false; S._serialTouched = false;
  S.outBlob = null;
  $('inpContent').value = ''; $('inpTitle').value = '';
  $('doneCard').style.display = 'none'; $('prog').style.display = 'none'; $('progTxt').textContent = '';
  updateTitleOverlay();
  gotoStep('cut');
  $('filePick').value = ''; $('filePick').click();
};

/* ---------- 視窗尺寸變動時重算 overlay ---------- */
window.addEventListener('resize', () => { updateBlurPositions(); updateTitleOverlay(); });

/* ---------- 初始化 ---------- */
loadLogoUI();
renderTitleUI();

/* ---------- 測試掛勾（自動化驗證用，不影響一般使用） ---------- */
window.__test = {
  S, loadVideo, exportVideo, buildPlan, renderTitleCanvas, store,
  async run(file, opts = {}) {
    await loadVideo(file);
    Object.assign(S, opts.state || {});
    if (opts.segments) S.segments = opts.segments;
    if (opts.blurs) S.blurs = opts.blurs;
    const r = await exportVideo((p, m) => { window.__test.progress = { p, m }; });
    window.__test.result = { size: r.blob.size, hasAudio: r.hasAudio, vCodecId: r.vCodecId };
    window.__test.blob = r.blob;
    return window.__test.result;
  },
};
