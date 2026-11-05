const $ = s => document.querySelector(s);
const SIZES = {
  a4: [210, 297], a3: [297, 420], a5: [148, 210], b5: [176, 250],
  letter: [215.9, 279.4], legal: [215.9, 355.6], long: [215.9, 330.2],
  exec: [184.2, 266.7], tabloid: [279.4, 431.8]
};
const S = { size: 'a4', orient: 'auto', margin: 10, q: 0.9, nums: false };
let items = [], sel = null, uid = 0, dragFrom = null, tmr;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(tmr);
  tmr = setTimeout(() => t.classList.remove('show'), 2800);
}

/* Draw the photo (rotation + optional B&W) onto a canvas and keep it as a JPEG */
function process(it) {
  const k = Math.min(1, 2200 / Math.max(it.img.naturalWidth, it.img.naturalHeight));
  const iw = Math.round(it.img.naturalWidth * k), ih = Math.round(it.img.naturalHeight * k);
  const c = document.createElement('canvas');
  const swap = it.rot % 180 !== 0;
  c.width = swap ? ih : iw;
  c.height = swap ? iw : ih;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.filter = it.bw ? 'grayscale(1)' : 'none';
  x.translate(c.width / 2, c.height / 2);
  x.rotate(it.rot * Math.PI / 180);
  x.drawImage(it.img, -iw / 2, -ih / 2, iw, ih);
  it.url = c.toDataURL('image/jpeg', S.q);
  it.cw = c.width;
  it.ch = c.height;
}

/* Where the photo sits on its PDF page (in mm). Used by both preview and PDF. */
function layout(it) {
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

function pageHTML(it, i) {
  const L = layout(it), p = v => (v * 100).toFixed(3) + '%';
  return `<figure class="pg ${it.id === sel ? 'sel' : ''}" data-id="${it.id}">
    <div class="sheetp" style="aspect-ratio:${L.pw}/${L.ph}">
      <img src="${it.url}" alt="Page ${i + 1}" style="left:${p(L.x / L.pw)};top:${p(L.y / L.ph)};width:${p(L.w / L.pw)};height:${p(L.h / L.ph)}">
      <button class="px" data-x="${it.id}" aria-label="Remove page ${i + 1}" title="Remove this page">×</button>
    </div><figcaption>Page ${i + 1}</figcaption></figure>`;
}

function render() {
  $('#thumbs').innerHTML = items.map((it, i) =>
    `<li draggable="true" data-i="${i}" class="${it.id === sel ? 'sel' : ''}">
      <img src="${it.url}" alt=""><span class="n">${i + 1}</span>
      <button class="x" data-x="${it.id}" aria-label="Remove page ${i + 1}">×</button></li>`).join('');
  $('#pages').innerHTML = items.length ? items.map(pageHTML).join('')
    : `<div class="empty"><h3>Your pages will appear here</h3>Add a few photos and you’ll see each page exactly as it will print.</div>`;
  $('#count').textContent = items.length + (items.length === 1 ? ' page' : ' pages');
  $('#share').disabled = !items.length;
}

/* Loading photos */
function load(file) {
  return new Promise(res => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const it = { id: ++uid, img, name: file.name, rot: 0, bw: false };
      process(it);
      items.push(it);
      sel = it.id;
      res();
    };
    img.onerror = () => { toast('Couldn’t read “' + file.name + '”. Try JPG, PNG or WebP.'); res(); };
    img.src = u;
  });
}

async function add(files) {
  const list = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif|svg)$/i.test(f.name));
  if (!list.length) { toast('Those files aren’t images.'); return; }
  for (const f of list) await load(f);
  render();
  toast(list.length + (list.length > 1 ? ' photos added' : ' photo added'));
}

const drop = $('#drop'), file = $('#file');
drop.onclick = () => file.click();
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } };
file.onchange = () => { add(file.files); file.value = ''; };
['dragenter', 'dragover'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); if (dragFrom === null) drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(n => drop.addEventListener(n, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) add(e.dataTransfer.files); });

/* Thumbnails: select, remove, drag to reorder */
const thumbs = $('#thumbs');
thumbs.addEventListener('click', e => {
  const x = e.target.closest('[data-x]');
  if (x) { removeItem(+x.dataset.x); return; }
  const li = e.target.closest('li');
  if (li) { sel = items[li.dataset.i].id; render(); }
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
  const [m] = items.splice(dragFrom, 1);
  items.splice(+li.dataset.i, 0, m);
  dragFrom = null; render();
});
thumbs.addEventListener('dragend', () => { dragFrom = null; render(); });
$('#pages').addEventListener('click', e => {
  const x = e.target.closest('.px');
  if (x) { removeItem(+x.dataset.x); return; }
  const f = e.target.closest('.pg');
  if (f) { sel = +f.dataset.id; render(); }
});

function removeItem(id) {
  items = items.filter(i => i.id !== id);
  if (!items.find(i => i.id === sel)) sel = items.length ? items[0].id : null;
  render();
}

$('#clear').onclick = () => { if (items.length && confirm('Remove all photos?')) { items = []; sel = null; render(); } };

/* Page setup: clickable for now, but these controls don't change the PDF yet */
$('#orient').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('#orient button').forEach(x => x.classList.toggle('on', x === b));
});

/* Build the PDF */
function build() {
  const { jsPDF } = window.jspdf;
  let doc;
  items.forEach((it, i) => {
    const L = layout(it), o = L.pw > L.ph ? 'l' : 'p';
    if (i === 0) doc = new jsPDF({ unit: 'mm', format: [L.pw, L.ph], orientation: o, compress: true });
    else doc.addPage([L.pw, L.ph], o);
    doc.addImage(it.url, 'JPEG', L.x, L.y, L.w, L.h, undefined, 'FAST');
  });
  const name = ($('#fname').value.trim() || 'my-notes').replace(/[\\/:*?"<>|]+/g, '-');
  return { doc, name };
}

function run(btn, label, fn) {
  if (!items.length) return;
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  setTimeout(() => {
    try { fn(); } catch (e) { toast('Couldn’t build the PDF. Try fewer or smaller photos.'); }
    btn.textContent = old; btn.disabled = !items.length;
  }, 60);
}

$('#share').onclick = () => run($('#share'), 'Preparing…', () => {
  const { doc, name } = build();
  const f = new File([doc.output('blob')], name + '.pdf', { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    navigator.share({ files: [f], title: name }).catch(() => {});
  } else {
    doc.save(name + '.pdf');
    toast('Sharing isn’t supported here, so the PDF was downloaded.');
  }
});

render();
