const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SIZES = {
  a4: [210, 297], a3: [297, 420], a5: [148, 210], b5: [176, 250],
  letter: [215.9, 279.4], legal: [215.9, 355.6], long: [215.9, 330.2],
  exec: [184.2, 266.7], tabloid: [279.4, 431.8]
};
const HINTS = {
  1: 'Add the photos you want in your PDF.',
  2: 'Drag a photo to move it, even onto another page. Pull the handles to resize. Double-click to crop or edit.',
  3: 'Extract text from the photos you choose if you need it, then download.'
};

const S = { size: 'a4', orient: 'auto', margin: 0, q: 0.85, dim: 2000, nums: false, per: 1, lang: 'eng' };
let items = [], sel = null, uid = 0, dragFrom = null, tmr, step = 1, busy = false;

const cur = () => items.find(i => i.id === sel);
/* ---- Pages are real containers: every photo knows its page (it.pg). Any page can hold any number of photos. ---- */
const chunks = () => { const o = []; items.forEach(it => (o[it.pg] || (o[it.pg] = [])).push(it)); return o; };
/* keep photos grouped by page, drop empty pages, number pages 0,1,2… */
function normalize() {
  items = items.map((it, i) => [it, i]).sort((a, b) => (a[0].pg - b[0].pg) || (a[1] - b[1])).map(x => x[0]);
  let last = null, n = -1;
  items.forEach(it => { if (it.pg !== last) { n++; last = it.pg; } it.pg = n; });
}
const newPageId = () => items.length ? Math.max(...items.map(i => i.pg)) + 1 : 0;
/* "Photos per page" = start every page with N photos */
function regroup() { items.forEach((it, i) => { it.pg = Math.floor(i / S.per); it.pos = null; }); }
/* put a freshly added photo on the last page if it has room, otherwise on a new page */
function assignPage(it, forceNew) {
  const others = items.filter(i => i !== it);
  if (!others.length) { it.pg = 0; return; }
  const last = Math.max(...others.map(i => i.pg)), cnt = others.filter(i => i.pg === last).length;
  it.pg = (!forceNew && cnt < S.per) ? last : last + 1;
}
/* move a photo to another page (-1 = a brand-new page) */
function movePhoto(it, pageIdx) {
  const target = pageIdx === -1 ? newPageId() : pageIdx;
  if (target === it.pg) return;
  it.pg = target; it.pos = null;
  items = items.filter(x => x !== it);
  let at = -1; items.forEach((x, i) => { if (x.pg === target) at = i; });
  if (at === -1) items.push(it); else items.splice(at + 1, 0, it);
  normalize(); sel = it.id; render();
  toast('Moved to page ' + (chunks().findIndex(p => p.includes(it)) + 1));
}
const tick = () => new Promise(r => setTimeout(r, 40));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(tmr);
  tmr = setTimeout(() => t.classList.remove('show'), 3200);
}

/* =========================================================
   Image processing
   ========================================================= */

/* Pixel filters: gray / enhance (auto-levels) / bw (Otsu), plus brightness & contrast */
function applyFilter(c, it) {
  const f = it.filter, b = it.bright || 0, k = it.contrast || 0;
  if (f === 'none' && !b && !k) return;
  const x = c.getContext('2d');
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data, n = p.length;
  const gray = f !== 'none';
  let lo = 0, hi = 255, thr = 128;

  if (f === 'enhance' || f === 'bw') {
    const h = new Uint32Array(256), tot = n / 4;
    for (let i = 0; i < n; i += 4) h[(p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0]++;
    if (f === 'enhance') {
      let acc = 0, gotLo = false;
      const t1 = tot * 0.01, t2 = tot * 0.8;
      for (let v = 0; v < 256; v++) {
        acc += h[v];
        if (!gotLo && acc >= t1) { lo = v; gotLo = true; }
        if (acc >= t2) { hi = v; break; }
      }
      if (hi - lo < 40) { lo = 0; hi = 255; }
    } else {
      let sum = 0; for (let v = 0; v < 256; v++) sum += v * h[v];
      let sB = 0, wB = 0, max = 0;
      for (let v = 0; v < 256; v++) {
        wB += h[v]; if (!wB) continue;
        const wF = tot - wB; if (!wF) break;
        sB += v * h[v];
        const mB = sB / wB, mF = (sum - sB) / wF, bt = wB * wF * (mB - mF) * (mB - mF);
        if (bt > max) { max = bt; thr = v; }
      }
    }
  }

  const cc = k * 2.55, fac = (259 * (cc + 255)) / (255 * (259 - cc)), bb = b * 2.55;
  const adjust = !!(b || k);
  for (let i = 0; i < n; i += 4) {
    let r = p[i], g = p[i + 1], bl = p[i + 2];
    if (gray) {
      let v = 0.299 * r + 0.587 * g + 0.114 * bl;
      if (f === 'enhance') v = (v - lo) * 255 / (hi - lo);
      if (adjust) v = fac * (v - 128) + 128 + bb;
      if (f === 'bw') v = v > thr ? 255 : 0;
      r = g = bl = v;
    } else if (adjust) {
      r = fac * (r - 128) + 128 + bb;
      g = fac * (g - 128) + 128 + bb;
      bl = fac * (bl - 128) + 128 + bb;
    }
    p[i] = r; p[i + 1] = g; p[i + 2] = bl;
  }
  x.putImageData(d, 0, 0);
}

/* Rotate → crop → filter. Returns a canvas. */
function renderCanvas(it, maxDim, useCrop = true) {
  const img = it.img, nw = img.naturalWidth, nh = img.naturalHeight;
  const k = Math.min(1, maxDim / Math.max(nw, nh));
  const iw = Math.round(nw * k), ih = Math.round(nh * k);
  const swap = it.rot % 180 !== 0;
  const rw = swap ? ih : iw, rh = swap ? iw : ih;
  let c = document.createElement('canvas');
  c.width = rw; c.height = rh;
  let x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, rw, rh);
  x.translate(rw / 2, rh / 2);
  x.rotate(it.rot * Math.PI / 180);
  x.drawImage(img, -iw / 2, -ih / 2, iw, ih);

  if (useCrop && it.crop) {
    const cr = it.crop;
    const sx = clamp(Math.round(cr.x * rw), 0, rw - 8), sy = clamp(Math.round(cr.y * rh), 0, rh - 8);
    const sw = clamp(Math.round(cr.w * rw), 8, rw - sx), sh = clamp(Math.round(cr.h * rh), 8, rh - sy);
    const c2 = document.createElement('canvas');
    c2.width = sw; c2.height = sh;
    c2.getContext('2d').drawImage(c, -sx, -sy);
    c = c2;
  }
  applyFilter(c, it);
  return c;
}

/* Re-render the photo and store it as a JPEG. `keep` keeps any extracted text. */
function process(it, keep) {
  const prev = it.cw && it.ch ? it.cw / it.ch : null;
  const c = renderCanvas(it, S.dim);
  it.url = c.toDataURL('image/jpeg', S.q);
  it.cw = c.width;
  it.ch = c.height;
  /* if the shape changed (crop / rotate / replace) the custom position no longer fits */
  if (prev && it.pos && Math.abs(prev / (it.cw / it.ch) - 1) > 0.01) it.pos = null;
  if (!keep) { it.ocr = false; it.text = null; it.none = false; }
}

/* Rotate the crop box together with the photo */
function rotCrop(cr, dir) {
  if (!cr) return cr;
  return dir > 0
    ? { x: 1 - cr.y - cr.h, y: cr.x, w: cr.h, h: cr.w }
    : { x: cr.y, y: 1 - cr.x - cr.w, w: cr.h, h: cr.w };
}
function rotateItem(it, dir) {
  it.rot = (it.rot + (dir > 0 ? 90 : 270)) % 360;
  it.crop = rotCrop(it.crop, dir);
  process(it);
}

/* =========================================================
   Page layout (shared by preview and PDF)
   ========================================================= */
function layoutOne(it) {
  const m = S.margin, iw = it.cw, ih = it.ch;
  if (S.size === 'fit') {
    const pw = 210, w = pw - 2 * m, h = w * ih / iw;
    return { pw, ph: h + 2 * m, x: m, y: m, w, h };
  }
  const [bw, bh] = SIZES[S.size];
  const land = S.orient === 'land' || (S.orient === 'auto' && iw > ih);
  const pw = land ? bh : bw, ph = land ? bw : bh;
  const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih);
  const w = iw * s, h = ih * s;
  return { pw, ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

/* A photo the user has dragged/resized keeps its own position (stored as page fractions) */
const freeOK = n => !(S.size === 'fit' && n === 1);   /* "Match photo" pages are sized by the photo, so they can't be free-placed */
function applyPos(c, pw, ph, n) {
  const it = c.it;
  if (!it.pos || !freeOK(n)) return c;
  const w = Math.min(it.pos.fw * pw, pw);
  const h = it.pos.fh != null ? Math.min(it.pos.fh * ph, ph) : w * it.ch / it.cw;   /* fh set = stretched */
  return { it, x: clamp(it.pos.fx * pw, 0, Math.max(0, pw - w)), y: clamp(it.pos.fy * ph, 0, Math.max(0, ph - h)), w, h };
}

/* columns × rows that suit N photos on one page (more rows than columns on a portrait page) */
function gridFor(n, land) {
  const rows = Math.ceil(Math.sqrt(n)), cols = Math.ceil(n / rows);
  return land ? [rows, cols] : [cols, rows];
}

function layoutPage(chunk) {
  const n = chunk.length;
  if (n === 1) {
    const it = chunk[0], L = layoutOne(it);
    return { pw: L.pw, ph: L.ph, cells: [applyPos({ it, x: L.x, y: L.y, w: L.w, h: L.h }, L.pw, L.ph, 1)] };
  }
  const m = S.margin, [bw, bh] = SIZES[S.size === 'fit' ? 'a4' : S.size];
  const land = S.orient === 'land';
  const pw = land ? bh : bw, ph = land ? bw : bh;
  const [cols, rows] = gridFor(n, land);
  const gap = Math.max(2, m / 2);
  const cw = (pw - 2 * m - gap * (cols - 1)) / cols, ch = (ph - 2 * m - gap * (rows - 1)) / rows;
  const cells = chunk.map((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const bx = m + col * (cw + gap), by = m + row * (ch + gap);
    const s = Math.min(cw / it.cw, ch / it.ch), w = it.cw * s, h = it.ch * s;
    return applyPos({ it, x: bx + (cw - w) / 2, y: by + (ch - h) / 2, w, h }, pw, ph, n);
  });
  return { pw, ph, cells };
}

/* =========================================================
   Rendering
   ========================================================= */
const DUPICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

function pageHTML(chunk, pi) {
  const L = layoutPage(chunk), p = v => (v * 100).toFixed(3) + '%';
  const cells = L.cells.map(c => `
    <div class="cell ${c.it.id === sel ? 'sel' : ''}" data-id="${c.it.id}"
         style="left:${p(c.x / L.pw)};top:${p(c.y / L.ph)};width:${p(c.w / L.pw)};height:${p(c.h / L.ph)}">
      <img src="${c.it.url}" alt="Photo ${items.indexOf(c.it) + 1}" draggable="false">
      <div class="ctl">
        <button class="cb" data-edit="${c.it.id}" aria-label="Edit photo" title="Edit / crop">${PENCIL}</button>
        <button class="cb" data-dup="${c.it.id}" aria-label="Duplicate photo" title="Duplicate on this page">${DUPICON}</button>
        <button class="cb del" data-x="${c.it.id}" aria-label="Remove photo" title="Remove this photo">×</button>
      </div>
      <i class="rz" data-rz="nw"></i><i class="rz" data-rz="ne"></i><i class="rz" data-rz="sw"></i><i class="rz" data-rz="se"></i>
      <i class="rz rzs" data-rz="n"></i><i class="rz rzs" data-rz="s"></i><i class="rz rzs" data-rz="e"></i><i class="rz rzs" data-rz="w"></i>
    </div>`).join('');
  return `<figure class="pg">
    <div class="sheetp" data-page="${pi}" data-n="${chunk.length}" data-free="${freeOK(chunk.length) ? 1 : 0}" data-pw="${L.pw}" data-ph="${L.ph}" style="aspect-ratio:${L.pw}/${L.ph}">
      ${cells}
      ${S.nums ? `<span class="num">${pi + 1}</span>` : ''}
    </div>
    <figcaption>Page ${pi + 1}${chunk.length > 1 ? ` · ${chunk.length} photos` : ''}</figcaption></figure>`;
}

function render() {
  const pg = chunks();
  $('#thumbs').innerHTML = items.map((it, i) =>
    `<li draggable="true" data-i="${i}" class="${it.id === sel ? 'sel' : ''}">
      <img src="${it.url}" alt=""><span class="n">${i + 1}</span>
      <button class="x" data-x="${it.id}" aria-label="Remove photo ${i + 1}">×</button></li>`).join('');
  $('#pages').classList.toggle('multi', pg.some(p => p.length > 1));
  $('#empty1').hidden = !!items.length;
  $('#n1').textContent = items.length;
  let plus = '';
  if (items.length) {
    const L = layoutPage(pg[pg.length - 1]);
    plus = `<figure class="pg addpg"><button type="button" class="sheetp plus" id="addPage" style="aspect-ratio:${L.pw}/${L.ph}" aria-label="Add another page">
      <span class="pl">+</span><span class="pt">Add page</span></button><figcaption>&nbsp;</figcaption></figure>`;
  }
  $('#pages').innerHTML = items.length ? pg.map(pageHTML).join('') + plus
    : `<div class="empty"><h3>Your pages will appear here</h3>Add a few photos and you’ll see each page exactly as it will print.</div>`;
  $('#count').textContent = pg.length + (pg.length === 1 ? ' page' : ' pages') + ' · ' + items.length + (items.length === 1 ? ' photo' : ' photos');
  const none = !items.length;
  $('#to2').disabled = $('#to3').disabled = none;
  $('#ddBtn').disabled = none || busy;
  syncTools();
  updateMenu();
}

function syncTools() {
  const it = cur();
  ['ed1', 'rep', 'rl', 'rr', 'bw'].forEach(id => $('#' + id).disabled = !it);
  $('#rpos').disabled = !(it && it.pos);
  $('#rall').disabled = !items.length;
  $('#bw').classList.toggle('on', !!(it && it.filter === 'gray'));
}

/* =========================================================
   Loading photos
   ========================================================= */
function readImage(file) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => res(img.naturalWidth ? img : null);
    img.onerror = () => res(null);
    img.src = URL.createObjectURL(file);
  });
}

async function load(file, forceNew) {
  const img = await readImage(file);
  if (!img) { toast('Couldn’t read “' + file.name + '”. Try JPG, PNG or WebP.'); return false; }
  const it = { id: ++uid, img, name: file.name, rot: 0, filter: 'none', bright: 0, contrast: 0, crop: null, pos: null, ocr: false, text: null, none: false, pick: false };
  process(it);
  it.pg = 0;
  items.push(it);
  assignPage(it, forceNew);
  sel = it.id;
  return true;
}

async function add(files, newPage) {
  const list = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
  if (!list.length) { toast('Those files aren’t images.'); return; }
  let ok = 0;
  for (const f of list) if (await load(f, newPage && ok === 0)) ok++;
  render();
  if (ok) toast(ok + (ok > 1 ? ' photos added' : ' photo added'));
}

const drop = $('#drop'), file = $('#file');
drop.onclick = () => file.click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
file.onchange = () => { add(file.files); file.value = ''; };
['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); if (dragFrom === null) drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) add(e.dataTransfer.files); });

/* =========================================================
   Selecting, reordering, removing
   ========================================================= */
function removeItem(id) {
  items = items.filter(i => i.id !== id);
  normalize();
  if (!items.find(i => i.id === sel)) sel = items.length ? items[0].id : null;
  render();
  if (!items.length && step !== 1) goStep(1);
}
function reorder(from, to) {
  if (from === null || from < 0 || to < 0 || from === to) return;
  const [m] = items.splice(from, 1);
  items.splice(to, 0, m);
  sel = m.id;
  regroup();   /* a new photo order means the pages are laid out again */
  render();
}
/* Select without re-rendering (keeps double-click working) */
function select(id) {
  sel = id;
  $$('.cell').forEach(c => c.classList.toggle('sel', +c.dataset.id === id));
  $$('#thumbs li').forEach((li, i) => li.classList.toggle('sel', items[i] && items[i].id === id));
  syncTools();
}
/* Duplicate a photo on its own page (only from the icon on the page) */
function dupItem(id) {
  const i = items.find(x => x.id === id); if (!i) return;
  const c = {
    ...i, id: ++uid, crop: i.crop ? { ...i.crop } : null, pick: false, ocr: false, text: null, none: false,
    pos: i.pos ? { ...i.pos, fx: clamp(i.pos.fx + 0.04, 0, 0.9), fy: clamp(i.pos.fy + 0.04, 0, 0.9) } : null
  };
  items.splice(items.indexOf(i) + 1, 0, c);
  sel = c.id; render(); toast('Photo duplicated on this page');
}

/* Step 1 thumbnails */
const thumbs = $('#thumbs');
thumbs.addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { removeItem(+x.dataset.x); return; }
  const li = e.target.closest('li');
  if (li) select(items[li.dataset.i].id);
});
thumbs.addEventListener('dragstart', e => {
  const li = e.target.closest('li'); if (!li) return;
  dragFrom = +li.dataset.i; li.classList.add('drag');
  e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'x');
});
thumbs.addEventListener('dragover', e => { if (dragFrom !== null) e.preventDefault(); });
thumbs.addEventListener('drop', e => {
  const li = e.target.closest('li'); if (!li || dragFrom === null) return;
  e.preventDefault(); e.stopPropagation();
  const from = dragFrom; dragFrom = null;
  reorder(from, +li.dataset.i);
});
thumbs.addEventListener('dragend', () => { dragFrom = null; render(); });

/* Step 2 pages: select, edit, remove, add page */
const pagesEl = $('#pages');
pagesEl.addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { removeItem(+x.dataset.x); return; }
  const dp = e.target.closest('[data-dup]');
  if (dp) { dupItem(+dp.dataset.dup); return; }
  if (e.target.closest('#addPage')) { $('#file2').click(); return; }
  const ed = e.target.closest('[data-edit]');
  if (ed) { select(+ed.dataset.edit); openEditor(); return; }
});
pagesEl.addEventListener('dblclick', e => {
  const c = e.target.closest('.cell');
  if (c && !e.target.closest('.ctl')) { select(+c.dataset.id); openEditor(); }
});

/* Move and resize photos right on the page (positions are saved as page fractions).
   Drag a photo OUT of its page and onto another page (or the "+" tile) to move it there. */
let pdrag = null, freeToast = false, asRaf = 0;

pagesEl.addEventListener('pointerdown', e => {
  if (e.target.closest('.ctl') || e.button > 0) return;
  const cell = e.target.closest('.cell'); if (!cell) return;
  const it = items.find(i => i.id === +cell.dataset.id); if (!it) return;
  select(it.id);
  const sheet = cell.parentElement, r = sheet.getBoundingClientRect();
  const rz = e.target.closest('[data-rz]');
  /* "Match photo" pages: resizing makes no sense, but the photo can still be moved to another page */
  if (sheet.dataset.free === '0' && rz) {
    if (!freeToast) { freeToast = true; toast('Choose a page size other than “Match photo” to resize photos.'); setTimeout(() => freeToast = false, 6000); }
    return;
  }
  const x = parseFloat(cell.style.left) / 100, y = parseFloat(cell.style.top) / 100;
  const w = parseFloat(cell.style.width) / 100, h = parseFloat(cell.style.height) / 100;
  const hf0 = (it.ch / it.cw) * (+sheet.dataset.pw / +sheet.dataset.ph);   /* natural height/width in page fractions */
  pdrag = {
    it, cell, sheet, mode: rz ? rz.dataset.rz : 'move', x, y, w, h, hf: h / w, hf0,
    sx: e.clientX, sy: e.clientY, px0: (e.clientX - r.left) / r.width, py0: (e.clientY - r.top) / r.height,
    lx: e.clientX, ly: e.clientY, moved: false, cur: null, transfer: false, ghost: null, target: null, free: sheet.dataset.free === '1'
  };
  cell.setPointerCapture(e.pointerId);
  e.preventDefault();
});

/* which page (or the + tile) is under the pointer? */
function sheetAt(x, y) {
  return document.elementsFromPoint(x, y).find(el => el.classList && el.classList.contains('sheetp')) || null;
}
function setTarget(d, sh) {
  const t = sh && sh !== d.sheet ? sh : null;
  if (t === d.target) return;
  if (d.target) d.target.classList.remove('drop');
  d.target = t;
  if (t) t.classList.add('drop');
}
function startTransfer(d) {
  d.transfer = true;
  d.cell.classList.add('lift');
  const g = document.createElement('div');
  g.className = 'ghost';
  g.innerHTML = `<img src="${d.it.url}" alt="">`;
  document.body.appendChild(g);
  d.ghost = g;
}
function endTransfer(d) {
  if (d.ghost) d.ghost.remove();
  d.ghost = null; d.transfer = false;
  d.cell.classList.remove('lift');
  setTarget(d, null);
}
/* keep scrolling while a photo is held near the top / bottom of the screen, so far-away pages can be reached */
function autoScroll() {
  const d = pdrag;
  if (!d || d.mode !== 'move' || !d.moved) { asRaf = 0; return; }
  const H = innerHeight, Z = 90;
  let v = 0;
  if (d.ly < Z) v = -Math.ceil((Z - d.ly) / 5);
  else if (d.ly > H - Z) v = Math.ceil((d.ly - (H - Z)) / 5);
  if (v) { const y0 = scrollY; scrollBy(0, v); if (scrollY !== y0) updateDrag(d); }
  asRaf = requestAnimationFrame(autoScroll);
}

/* apply the drag for the last known pointer position (also called while the page auto-scrolls) */
function updateDrag(d) {
  const r = d.sheet.getBoundingClientRect();           /* fresh: the page may have scrolled */
  const px = (d.lx - r.left) / r.width, py = (d.ly - r.top) / r.height;
  const pxc = clamp(px, 0, 1), pyc = clamp(py, 0, 1);
  let { x, y, w, h } = d;
  if (d.mode === 'move') {
    x = clamp(d.x + (px - d.px0), 0, Math.max(0, 1 - w));
    y = clamp(d.y + (py - d.py0), 0, Math.max(0, 1 - h));
    /* pointer left this page → carry the photo to another one */
    const outside = px < 0 || px > 1 || py < 0 || py > 1;
    if (outside && !d.transfer) startTransfer(d);
    if (!outside && d.transfer) endTransfer(d);
    if (d.transfer) {
      d.ghost.style.left = d.lx + 'px'; d.ghost.style.top = d.ly + 'px';
      setTarget(d, sheetAt(d.lx, d.ly));
    }
    if (!d.free) return;                               /* can't free-place on "Match photo" pages */
  } else if (d.mode.length === 1) {
    /* middle handles: stretch only one direction (widen / heighten freely) */
    const m = d.mode, MINW = 0.06, MINH = 0.04;
    if (m === 'e') w = clamp(pxc - d.x, MINW, 1 - d.x);
    if (m === 'w') { x = clamp(pxc, 0, d.x + d.w - MINW); w = d.x + d.w - x; }
    if (m === 's') h = clamp(pyc - d.y, MINH, 1 - d.y);
    if (m === 'n') { y = clamp(pyc, 0, d.y + d.h - MINH); h = d.y + d.h - y; }
  } else {
    const m = d.mode, MINW = 0.06;
    const ax = m.includes('w') ? d.x + d.w : d.x, ay = m.includes('n') ? d.y + d.h : d.y;
    let nw = Math.max(Math.abs(pxc - ax), Math.abs(pyc - ay) / d.hf);
    const maxW = Math.min(m.includes('w') ? ax : 1 - ax, (m.includes('n') ? ay : 1 - ay) / d.hf);
    nw = clamp(nw, MINW, Math.max(MINW, maxW));
    w = nw; h = nw * d.hf;
    x = m.includes('w') ? ax - w : ax;
    y = m.includes('n') ? ay - h : ay;
  }
  const st = d.cell.style;
  st.left = x * 100 + '%'; st.top = y * 100 + '%'; st.width = w * 100 + '%'; st.height = h * 100 + '%';
  d.cur = { fx: x, fy: y, fw: w };
  if (Math.abs(h - w * d.hf0) > 0.003) d.cur.fh = h;   /* only remember a height when the photo is stretched */
}
pagesEl.addEventListener('pointermove', e => {
  const d = pdrag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
  d.moved = true;
  d.lx = e.clientX; d.ly = e.clientY;
  updateDrag(d);
  if (d.mode === 'move' && !asRaf) asRaf = requestAnimationFrame(autoScroll);
});
const endDrag = (e, cancel) => {
  const d = pdrag; if (!d) return;
  pdrag = null;
  let target = null;
  if (d.transfer) {
    target = cancel ? null : (sheetAt(e.clientX, e.clientY) || d.target);
    if (target === d.sheet) target = null;
    endTransfer(d);
  }
  if (target) {
    movePhoto(d.it, target.id === 'addPage' ? -1 : +target.dataset.page);
  } else if (d.moved && d.cur && !cancel && d.free) {
    d.it.pos = d.cur; syncTools(); updateMenu();        /* released on its own page: keep the new position */
  } else if (d.moved) render();
};
pagesEl.addEventListener('pointerup', e => endDrag(e, false));
pagesEl.addEventListener('pointercancel', e => endDrag(e, true));

/* =========================================================
   Toolbar
   ========================================================= */
$('#ed1').onclick = () => openEditor();
$('#rep').onclick = () => $('#repl').click();
$('#file2').onchange = async e => {
  const f = [...e.target.files]; e.target.value = '';
  if (f.length) { await add(f, true); const c = document.querySelector('.cell.sel'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
};
$('#repl').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  const it = cur(); if (!f || !it) return;
  const img = await readImage(f);
  if (!img) { toast('Couldn’t read that photo. Try JPG, PNG or WebP.'); return; }
  it.img = img; it.name = f.name; it.rot = 0; it.crop = null;
  process(it); render(); toast('Photo replaced');
};
$('#rl').onclick = () => { const i = cur(); if (i) { rotateItem(i, -1); render(); } };
$('#rr').onclick = () => { const i = cur(); if (i) { rotateItem(i, 1); render(); } };
$('#bw').onclick = () => { const i = cur(); if (i) { i.filter = i.filter === 'gray' ? 'none' : 'gray'; process(i); render(); } };
$('#rpos').onclick = () => { const i = cur(); if (i && i.pos) { i.pos = null; render(); toast('Position reset'); } };
$('#rall').onclick = () => { items.forEach(i => rotateItem(i, 1)); render(); };
$('#clear').onclick = () => {
  if (items.length && confirm('Remove all photos?')) { items = []; sel = null; render(); goStep(1); }
};

/* Page setup */
$('#per').onchange = e => {
  S.per = +e.target.value;
  regroup();   /* start every page with N photos (you can still drag photos between pages afterwards) */
  render();
  toast('Pages regrouped: ' + S.per + (S.per === 1 ? ' photo' : ' photos') + ' per page');
};
$('#size').onchange = e => { S.size = e.target.value; render(); };
$('#nums').onchange = e => { S.nums = e.target.checked; render(); };
$('#orient').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  S.orient = b.dataset.v;
  $$('#orient button').forEach(x => x.classList.toggle('on', x === b));
  render();
};

/* =========================================================
   Steps
   ========================================================= */
function goStep(n) {
  if (n > 1 && !items.length) { toast('Add at least one photo first.'); return; }
  step = n;
  $$('.view').forEach((v, i) => v.hidden = (i + 1) !== n);
  $$('#stepper button').forEach(b => {
    const k = +b.dataset.go;
    b.classList.toggle('on', k === n);
    b.classList.toggle('done', k < n);
  });
  $('#stepHint').textContent = HINTS[n];
  const v = $('#v' + n);
  v.classList.remove('in'); void v.offsetWidth; v.classList.add('in');
  if (n === 3) renderText();
  $('#app').scrollLeft = 0;
  $('#app').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$$('#stepper button').forEach(b => b.onclick = () => goStep(+b.dataset.go));
$('#to2').onclick = () => goStep(2);
$('#to3').onclick = () => goStep(3);
$('#back1').onclick = () => goStep(1);
$('#back2').onclick = () => goStep(2);

/* =========================================================
   Photo editor (crop by dragging, rotate, filters, replace)
   ========================================================= */
const E = { it: null, img: null, name: null, rot: 0, filter: 'none', bright: 0, contrast: 0, crop: null, cw: 1, ch: 1, drag: null, before: '' };
let lastFocus = null, edRaf = 0;
const FULL = () => ({ x: 0, y: 0, w: 1, h: 1 });
const edState = () => JSON.stringify([E.rot, E.filter, E.bright, E.contrast, E.crop]);

function openEditor() {
  const it = cur(); if (!it) return;
  Object.assign(E, {
    it, img: it.img, name: null, rot: it.rot, filter: it.filter, bright: it.bright, contrast: it.contrast,
    crop: it.crop ? { ...it.crop } : FULL()
  });
  E.before = edState();
  syncEd();
  lastFocus = document.activeElement;
  $('#ed').hidden = false;
  document.body.classList.add('lock');
  $('#edx').focus();
  requestAnimationFrame(drawEditor);
}
function closeEditor() {
  $('#ed').hidden = true;
  document.body.classList.remove('lock');
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
function syncEd() {
  $$('#edf button').forEach(b => b.classList.toggle('on', b.dataset.f === E.filter));
  $('#edb').value = E.bright;
  $('#edk').value = E.contrast;
}
function redraw() { cancelAnimationFrame(edRaf); edRaf = requestAnimationFrame(drawEditor); }

function drawEditor() {
  const c = renderCanvas({ img: E.img, rot: E.rot, filter: E.filter, bright: E.bright, contrast: E.contrast, crop: null }, 1000);
  const cv = $('#edc');
  cv.width = c.width; cv.height = c.height;
  cv.getContext('2d').drawImage(c, 0, 0);
  E.cw = c.width; E.ch = c.height;
  fitStage();
  drawCrop();
}
function fitStage() {
  const w = $('#stagewrap');
  const s = Math.min((w.clientWidth - 28) / E.cw, (w.clientHeight - 28) / E.ch, 2);
  const st = $('#stage');
  st.style.width = Math.max(40, E.cw * s) + 'px';
  st.style.height = Math.max(40, E.ch * s) + 'px';
}
function drawCrop() {
  const c = E.crop;
  [$('#crop'), $('#dim')].forEach(b => {
    b.style.left = c.x * 100 + '%'; b.style.top = c.y * 100 + '%';
    b.style.width = c.w * 100 + '%'; b.style.height = c.h * 100 + '%';
  });
}
window.addEventListener('resize', () => { if (!$('#ed').hidden) { fitStage(); drawCrop(); } });

/* Dragging: draw a new box, move it, or pull a handle */
const stage = $('#stage');
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
stage.addEventListener('pointerdown', e => {
  const h = e.target.closest('[data-h]'), inBox = e.target.closest('#crop');
  const r = stage.getBoundingClientRect();
  const px = clamp((e.clientX - r.left) / r.width, 0, 1), py = clamp((e.clientY - r.top) / r.height, 0, 1);
  const isFull = E.crop.w > 0.98 && E.crop.h > 0.98;
  E.drag = { mode: h ? h.dataset.h : (inBox && !isFull) ? 'move' : 'new', px, py, rx: (e.clientX - r.left) / r.width, ry: (e.clientY - r.top) / r.height, s: { ...E.crop } };
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener('pointermove', e => {
  const d = E.drag; if (!d) return;
  const r = stage.getBoundingClientRect(), MIN = 0.04, s = d.s;
  const rx = (e.clientX - r.left) / r.width, ry = (e.clientY - r.top) / r.height;
  const px = clamp(rx, 0, 1), py = clamp(ry, 0, 1);
  if (d.mode === 'move') {
    E.crop = { x: clamp(s.x + rx - d.rx, 0, 1 - s.w), y: clamp(s.y + ry - d.ry, 0, 1 - s.h), w: s.w, h: s.h };
  } else if (d.mode === 'new') {
    let x = Math.min(d.px, px), y = Math.min(d.py, py);
    const w = Math.max(MIN, Math.abs(px - d.px)), h = Math.max(MIN, Math.abs(py - d.py));
    E.crop = { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
  } else if (HANDLES.includes(d.mode)) {
    let L = s.x, T = s.y, R = s.x + s.w, B = s.y + s.h;
    if (d.mode.includes('w')) L = clamp(px, 0, R - MIN);
    if (d.mode.includes('e')) R = clamp(px, L + MIN, 1);
    if (d.mode.includes('n')) T = clamp(py, 0, B - MIN);
    if (d.mode.includes('s')) B = clamp(py, T + MIN, 1);
    E.crop = { x: L, y: T, w: R - L, h: B - T };
  }
  drawCrop();
});
['pointerup', 'pointercancel'].forEach(n => stage.addEventListener(n, () => { E.drag = null; }));

function edRotate(dir) {
  E.rot = (E.rot + (dir > 0 ? 90 : 270)) % 360;
  E.crop = rotCrop(E.crop, dir);
  redraw();
}
$('#edrl').onclick = () => edRotate(-1);
$('#edrr').onclick = () => edRotate(1);
$('#edcr').onclick = () => { E.crop = FULL(); drawCrop(); };
$('#edf').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  E.filter = b.dataset.f; syncEd(); redraw();
};
$('#edb').oninput = e => { E.bright = +e.target.value; redraw(); };
$('#edk').oninput = e => { E.contrast = +e.target.value; redraw(); };
$('#edreset').onclick = () => {
  Object.assign(E, { rot: 0, filter: 'none', bright: 0, contrast: 0, crop: FULL() });
  syncEd(); redraw();
};
$('#edrep').onclick = () => $('#edfile').click();
$('#edfile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const img = await readImage(f);
  if (!img) { toast('Couldn’t read that photo. Try JPG, PNG or WebP.'); return; }
  E.img = img; E.name = f.name; E.rot = 0; E.crop = FULL();
  redraw();
};
$('#edx').onclick = $('#edcancel').onclick = closeEditor;
$('#edok').onclick = () => {
  const it = E.it;
  if (!it || !items.includes(it)) { closeEditor(); return; }
  const full = E.crop.x <= 0.001 && E.crop.y <= 0.001 && E.crop.w >= 0.998 && E.crop.h >= 0.998;
  if (full) E.crop = FULL();
  const changed = E.img !== it.img || edState() !== E.before;
  if (changed) {
    it.img = E.img; it.rot = E.rot; it.filter = E.filter; it.bright = E.bright; it.contrast = E.contrast;
    it.crop = full ? null : { ...E.crop };
    if (E.name) it.name = E.name;
    process(it);
    render();
    toast('Changes applied');
  }
  closeEditor();
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#ed').hidden) closeEditor();
});

/* =========================================================
   Text extraction (OCR with Tesseract.js, runs in the browser)
   Only the photos the user ticks are read.
   ========================================================= */
let worker = null, workerLang = null, onProg = null;

function setProg(txt, frac) {
  const p = $('#prog');
  p.hidden = txt === null;
  if (txt === null) return;
  $('#progTxt').textContent = txt;
  $('#progBar').style.width = Math.round(clamp(frac || 0, 0, 1) * 100) + '%';
}

async function getWorker(lang) {
  if (worker && workerLang === lang) return worker;
  if (worker) { try { await worker.terminate(); } catch (e) {} worker = null; }
  worker = await Tesseract.createWorker(lang, 1, { logger: m => { if (onProg) onProg(m); } });
  try { await worker.setParameters({ user_defined_dpi: '300' }); } catch (e) {}
  workerLang = lang;
  return worker;
}

/* Prepare a photo for reading: redraw from the ORIGINAL (not the small PDF copy), enlarge small text,
   turn it grey and stretch the contrast. Small, low-contrast text is the #1 reason OCR returns junk. */
function ocrPrep(it) {
  let c = renderCanvas({ img: it.img, rot: it.rot, crop: it.crop, filter: 'none', bright: 0, contrast: 0 }, 3600);
  const side = Math.max(c.width, c.height);
  if (side < 3000) {
    const k = Math.min(3, 3000 / side), c2 = document.createElement('canvas');
    c2.width = Math.round(c.width * k); c2.height = Math.round(c.height * k);
    const x = c2.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, c2.width, c2.height);
    c = c2;
  }
  const x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height), p = d.data, h = new Uint32Array(256);
  for (let i = 0; i < p.length; i += 4) h[(p[i] * 299 + p[i + 1] * 587 + p[i + 2] * 114) / 1000 | 0]++;
  const tot = p.length / 4;
  let acc = 0, lo = 0, hi = 255, gotLo = false;
  for (let v = 0; v < 256; v++) {
    acc += h[v];
    if (!gotLo && acc >= tot * 0.005) { lo = v; gotLo = true; }
    if (acc >= tot * 0.995) { hi = v; break; }
  }
  if (hi - lo < 40) { lo = 0; hi = 255; }
  const sc = 255 / (hi - lo);
  for (let i = 0; i < p.length; i += 4) {
    const v = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2] - lo) * sc;
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  x.putImageData(d, 0, 0);
  return c;
}
function rotCanvas(c, deg) {
  const r = document.createElement('canvas'), swap = deg % 180 !== 0;
  r.width = swap ? c.height : c.width; r.height = swap ? c.width : c.height;
  const x = r.getContext('2d');
  x.translate(r.width / 2, r.height / 2); x.rotate(deg * Math.PI / 180);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return r;
}
const toBlob = c => new Promise(res => c.toBlob(res, 'image/png'));

/* Read the page the way it is, and if that looks wrong try it turned 180°, 90° and 270°.
   Text read in the wrong direction comes out as nonsense with LOW confidence, so the
   best-confidence attempt is the right way up. Stops early once a result is clearly good. */
async function readBest(it, w, label, n, total) {
  const base = ocrPrep(it), tries = [0, 180, 90, 270];
  let best = null;
  for (let k = 0; k < tries.length; k++) {
    if (k === 1 && best && best.conf >= 70) break;
    if (k >= 2 && best && best.conf >= 55) break;
    const deg = tries[k];
    if (k > 0) setProg(`${label}: checking the photo turned ${deg}°…`, n / total);
    const { data } = await w.recognize(await toBlob(deg ? rotCanvas(base, deg) : base));
    const conf = typeof data.confidence === 'number' ? data.confidence : 0;
    if (!best || conf > best.conf) best = { text: data.text, conf, deg };
  }
  return best;
}

/* Throw away OCR noise: a photo with no real text should come back as "no text", not as junk.
   Returns the cleaned text, or null when there is no real text. */
function cleanOCR(text, conf) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim())
    .filter(l => l === '' || /[\p{L}\p{N}]/u.test(l));
  const res = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const alnum = (res.match(/[\p{L}\p{N}]/gu) || []).length;
  const all = res.replace(/\s/g, '').length;
  if (alnum < 3 || alnum / all < 0.6) return null;
  if (!/\p{L}{2,}|\p{N}{2,}/u.test(res)) return null;
  if (typeof conf === 'number' && conf < 30) return null;
  return res;
}

const picked = () => items.filter(i => i.pick);
const hasText = it => !!(it.text && it.text.trim());
const wordCount = t => (t || '').trim().split(/\s+/).filter(Boolean).length;

function setBusy(v) {
  busy = v;
  $('#ddBtn').disabled = v || !items.length;
  $$('[data-ocr],[data-pick],[data-copy],#selAll,#selNone').forEach(b => b.disabled = v);
  updateOcrBtn();
}
function updateOcrBtn() {
  const n = picked().length;
  const b = $('#ocrAll');
  b.disabled = busy || !n;
  b.textContent = n ? `Extract text from ${n} photo${n > 1 ? 's' : ''}` : 'Extract text';
  const done = items.filter(i => i.ocr && !i.none).length;
  $('#readStat').textContent = !items.length ? '' : n ? '' : done ? `${done} photo${done > 1 ? 's' : ''} with text` : 'Tick the photos you want to read.';
}

async function runOCR(list) {
  if (typeof Tesseract === 'undefined') { toast('The text-reading library didn’t load. Check your internet connection and refresh.'); return false; }
  list = list.filter(it => items.includes(it));
  if (!list.length) return true;
  setBusy(true);
  let ok = true;
  try {
    for (let n = 0; n < list.length; n++) {
      const it = list[n], url = it.url, label = `Photo ${items.indexOf(it) + 1} (${n + 1} of ${list.length})`;
      it.reading = true; renderText();
      setProg(`${label}: getting ready…`, n / list.length);
      onProg = m => {
        if (m.status === 'recognizing text') setProg(`${label}: reading… ${Math.round(m.progress * 100)}%`, (n + m.progress) / list.length);
        else if (/load|init/.test(m.status)) setProg(`${label}: loading ${S.lang === 'eng' ? 'engine' : 'language data'}…`, n / list.length);
      };
      const w = await getWorker(S.lang);
      const best = await readBest(it, w, label, n, list.length);
      it.reading = false;
      if (items.includes(it) && it.url === url) {
        const t = cleanOCR(best.text, best.conf);
        it.ocr = true; it.none = t === null; it.text = t || ''; it.conf = best.conf; it.pick = false;
      }
      renderText();
    }
    setProg('Done', 1);
    setTimeout(() => { if (!busy) setProg(null); }, 1500);
  } catch (e) {
    ok = false;
    setProg(null);
    toast('Couldn’t read the text. Check your internet connection and try again.');
  } finally {
    onProg = null;
    items.forEach(i => i.reading = false);
    setBusy(false);
    renderText();
  }
  return ok;
}

function renderText() {
  const box = $('#texts');
  box.innerHTML = items.map((it, i) => {
    const badge = it.reading ? '<span class="bd busy">Reading…</span>'
      : it.none ? '<span class="bd none">No text found</span>'
      : it.ocr && it.conf < 60 ? `<span class="bd warn">${wordCount(it.text)} words · check text</span>`
      : it.ocr ? `<span class="bd ok">${wordCount(it.text)} words</span>`
      : '<span class="bd">Not extracted</span>';
    const body = it.none
      ? `<p class="hint">No readable text was found in this photo, so nothing from it will be saved.</p>
         <div class="btnrow"><button class="btn line sm" data-ocr="${it.id}" ${busy ? 'disabled' : ''}>Read this photo again</button></div>`
      : it.ocr
      ? `<textarea data-t="${it.id}" rows="6" aria-label="Text from photo ${i + 1}">${esc(it.text || '')}</textarea>
         ${it.conf < 60 ? '<p class="hint warnhint">This text may have mistakes. Crop closer to the text, brighten the photo, or retake it, then read again.</p>' : ''}
         <div class="btnrow"><button class="btn line sm" data-ocr="${it.id}" ${busy ? 'disabled' : ''}>Read this photo again</button>
         <button class="btn line sm" data-copy="${it.id}" ${busy ? 'disabled' : ''}>Copy text</button></div>`
      : '';
    return `<div class="tx ${it.pick ? 'pick' : ''}">
      <label class="txh"><input type="checkbox" class="switch" data-pick="${it.id}" ${it.pick ? 'checked' : ''} ${busy ? 'disabled' : ''}>
        <img src="${it.url}" alt=""><b>Photo ${i + 1}</b>${badge}</label>${body}</div>`;
  }).join('');
  updateOcrBtn();
  updateMenu();
}

$('#texts').addEventListener('input', e => {
  const t = e.target.closest('[data-t]'); if (!t) return;
  const it = items.find(i => i.id === +t.dataset.t);
  if (it) { it.text = t.value; updateMenu(); }
});
$('#texts').addEventListener('change', e => {
  const c = e.target.closest('[data-pick]'); if (!c) return;
  const it = items.find(i => i.id === +c.dataset.pick);
  if (it) { it.pick = c.checked; c.closest('.tx').classList.toggle('pick', c.checked); updateOcrBtn(); }
});
$('#texts').addEventListener('click', async e => {
  const b = e.target.closest('[data-ocr]');
  if (b) { const it = items.find(i => i.id === +b.dataset.ocr); if (it) runOCR([it]); return; }
  const cp = e.target.closest('[data-copy]');
  if (cp) {
    const it = items.find(i => i.id === +cp.dataset.copy);
    if (it && hasText(it)) { await copyText(it.text.trim()); toast('Text copied'); }
  }
});
$('#ocrAll').onclick = () => runOCR(picked());
$('#selAll').onclick = () => { items.forEach(i => i.pick = true); renderText(); };
$('#selNone').onclick = () => { items.forEach(i => i.pick = false); renderText(); };
$('#lang').onchange = e => { S.lang = e.target.value; toast('Language changed. Tick the photos and extract again.'); };

async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
}

/* =========================================================
   Saving: .txt, real .docx, .zip (tiny zip writer, no library needed)
   ========================================================= */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

/* files: [{ name, data: Uint8Array }] -> Blob (stored, no compression) */
function zipFiles(files, type) {
  const enc = new TextEncoder(), parts = [], central = [];
  const dt = new Date();
  const time = (dt.getHours() << 11) | (dt.getMinutes() << 5) | (dt.getSeconds() >> 1);
  const date = ((dt.getFullYear() - 1980) << 9) | ((dt.getMonth() + 1) << 5) | dt.getDate();
  let off = 0;
  files.forEach(f => {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
    h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    parts.push(new Uint8Array(h.buffer), name, f.data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
    c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + size;
  });
  const csize = central.reduce((a, x) => a + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: type || 'application/zip' });
}

const xe = t => String(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function docxBlob(parts) {
  const enc = new TextEncoder();
  const body = parts.map(p => {
    const head = parts.length > 1
      ? `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>Photo ${p.n}</w:t></w:r></w:p>` : '';
    const paras = p.t.split(/\n{2,}/).map(par =>
      `<w:p><w:r>${par.split('\n').map((ln, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${xe(ln)}</w:t>`).join('')}</w:r></w:p>`).join('');
    return head + paras;
  }).join('');
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode(X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>') },
    { name: 'word/document.xml', data: enc.encode(X + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>') }
  ];
  return zipFiles(files, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

/* Only photos that really have text are saved */
function textParts() { return items.map((it, i) => ({ n: i + 1, t: (it.text || '').trim() })).filter(p => p.t); }
function plainText(parts) {
  return parts.length === 1 ? parts[0].t : parts.map(p => `— Photo ${p.n} —\n\n${p.t}`).join('\n\n\n');
}
function fileName() { return ($('#fname').value.trim() || 'my-notes').replace(/[\\/:*?"<>|]+/g, '-'); }
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer());

/* =========================================================
   Build the PDF
   ========================================================= */
function build() {
  const { jsPDF } = window.jspdf;
  let doc;
  chunks().forEach((chunk, pi) => {
    const L = layoutPage(chunk), o = L.pw > L.ph ? 'l' : 'p';
    if (pi === 0) doc = new jsPDF({ unit: 'mm', format: [L.pw, L.ph], orientation: o, compress: true });
    else doc.addPage([L.pw, L.ph], o);
    L.cells.forEach(c => doc.addImage(c.it.url, 'JPEG', c.x, c.y, c.w, c.h, undefined, 'FAST'));
    if (S.nums) {
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(String(pi + 1), L.pw / 2, L.ph - Math.max(3, S.margin / 3), { align: 'center' });
    }
  });
  return doc;
}

/* =========================================================
   Download menu: PDF only, text only, or both
   ========================================================= */
const menu = $('#ddMenu'), ddBtn = $('#ddBtn');
function openMenu(v) {
  menu.hidden = !v;
  ddBtn.setAttribute('aria-expanded', String(v));
}
ddBtn.onclick = e => { e.stopPropagation(); updateMenu(); openMenu(menu.hidden); };
document.addEventListener('click', e => { if (!e.target.closest('#dd')) openMenu(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') openMenu(false); });

function updateMenu() {
  if (!$('#pdfSize')) return;
  const n = textParts().length, msg = n ? `${n} photo${n > 1 ? 's' : ''} with text` : 'Extract text first';
  $('#pdfSize').textContent = items.length ? 'Your photos as one PDF' : 'Add photos first';
  $$('#ddMenu [data-dl]').forEach(b => {
    const k = b.dataset.dl, needsText = k === 'txt' || k === 'docx' || k === 'both';
    b.disabled = !items.length || (needsText && !n);
    if (needsText) b.querySelector('small').textContent = msg + (k === 'both' ? ' · PDF + Word file' : '');
  });
}

async function withBtn(label, fn) {
  const old = ddBtn.innerHTML;
  ddBtn.disabled = true; ddBtn.textContent = label;
  await tick();
  try { return await fn(); }
  catch (e) { toast('Something went wrong while preparing the file. Try fewer or smaller photos.'); return null; }
  finally { ddBtn.innerHTML = old; ddBtn.disabled = !items.length || busy; }
}

$('#ddMenu').addEventListener('click', async e => {
  const b = e.target.closest('[data-dl]'); if (!b || b.disabled) return;
  openMenu(false);
  const kind = b.dataset.dl, name = fileName();
  const needPdf = kind === 'pdf' || kind === 'both' || kind === 'share';
  if (needPdf && !window.jspdf) { toast('The PDF library didn’t load. Check your internet connection and refresh.'); return; }

  if (kind === 'txt') {
    saveBlob(new Blob(['\ufeff' + plainText(textParts())], { type: 'text/plain;charset=utf-8' }), name + '.txt');
    toast('Saved ' + name + '.txt');
  } else if (kind === 'docx') {
    saveBlob(docxBlob(textParts()), name + '.docx');
    toast('Saved ' + name + '.docx');
  } else if (kind === 'pdf') {
    const doc = await withBtn('Building PDF…', async () => build());
    if (doc) { doc.save(name + '.pdf'); toast('Saved ' + name + '.pdf'); }
  } else if (kind === 'both') {
    const z = await withBtn('Building files…', async () => {
      const pdf = await bytesOf(build().output('blob'));
      const docx = await bytesOf(docxBlob(textParts()));
      return zipFiles([{ name: name + '.pdf', data: pdf }, { name: name + '.docx', data: docx }]);
    });
    if (z) { saveBlob(z, name + '.zip'); toast('Saved ' + name + '.zip'); }
  } else if (kind === 'share') {
    const doc = await withBtn('Preparing…', async () => build());
    if (!doc) return;
    const f = new File([doc.output('blob')], name + '.pdf', { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [f] })) navigator.share({ files: [f], title: name }).catch(() => {});
    else { doc.save(name + '.pdf'); toast('Sharing isn’t supported here, so the PDF was downloaded.'); }
  }
});

render();
