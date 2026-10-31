'use strict';
/* Ritmo Studio — shared UI pieces: knob, fader, context menu, inline rename, hint bar, toast, canvas helpers */

const TH = {}; // canvas colors read from the CSS tokens
function readTheme() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  Object.assign(TH, {
    grid: v('--cv-grid'), gridBlack: v('--cv-grid-black'), scaleIn: v('--cv-scale-in'), scaleRoot: v('--cv-scale-root'), loopBand: v('--cv-loop'), lineBar: v('--cv-line-bar'), lineBeat: v('--cv-line-beat'),
    lineStep: v('--cv-line-step'), outside: v('--cv-outside'), signal: v('--signal'), brass: v('--brass'), alert: v('--alert'),
    text: v('--text'), dim: v('--dim'), faint: v('--faint'), noteInk: v('--note-ink'), keyWhite: v('--key-white'),
    keyBlack: v('--key-black'), keyLine: v('--key-line'), panel: v('--panel'), panel2: v('--panel-2'), raise: v('--raise'),
    line: v('--line'), lineSoft: v('--line-soft'), meterBg: v('--meter-bg'), lcd: v('--lcd'),
    mono: v('--f-mono'), label: v('--f-label'),
  });
}

function fitCanvas(cv, w, hgt) {
  const d = window.devicePixelRatio || 1, W = Math.max(1, Math.round(w * d)), H = Math.max(1, Math.round(hgt * d));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  cv.style.width = w + 'px';
  cv.style.height = hgt + 'px';
  const g = cv.getContext('2d');
  g.setTransform(d, 0, 0, d, 0, 0);
  return g;
}
function rrect(g, x, y, w, hh, r) {
  r = Math.min(r, w / 2, hh / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + hh, r);
  g.arcTo(x + w, y + hh, x, y + hh, r);
  g.arcTo(x, y + hh, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fmtParam(spec, v) {
  if (spec.select) { const o = spec.options.find(x => x[0] === v); return o ? o[1] : String(v); }
  switch (spec.unit) {
    case 'Hz': return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
    case 's': return v < 1 ? Math.round(v * 1000) + ' ms' : v.toFixed(2) + ' s';
    case 'dB': return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
    case 'st': return (v > 0 ? '+' : '') + Math.round(v) + ' st';
    case 'ct': return Math.round(v) + ' cent';
    case ':1': return v.toFixed(1) + ':1';
    case 'pan': return Math.abs(v) < 0.01 ? 'Centro' : Math.round(Math.abs(v) * 100) + '% ' + (v < 0 ? 'sinistra' : 'destra');
    case '%': return Math.round(v * 100) + '%';
  }
  if (spec.step >= 1) return (v > 0 && spec.min < 0 ? '+' : '') + Math.round(v);
  if (spec.min >= 0 && spec.max <= 1.5 && !spec.step) return Math.round(v * 100) + '%';
  return v.toFixed(spec.step && spec.step < 1 ? Math.max(1, String(spec.step).split('.')[1].length) : 2);
}
const volDb = v => (v <= 0.0005 ? '−∞ dB' : (40 * Math.log10(v) >= 0 ? '+' : '') + (40 * Math.log10(v)).toFixed(1) + ' dB');

/* ---------- Knob ---------- */
const SVGNS = 'http://www.w3.org/2000/svg';
function arcD(a0, a1, r = 12) {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const pt = a => [16 + r * Math.sin(a * Math.PI / 180), 16 - r * Math.cos(a * Math.PI / 180)];
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
function knob(o) {
  const s = o.spec;
  const root = h('div', 'knob');
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', s.label);
  root.style.setProperty('--size', (o.size || 30) + 'px');
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, cls) => { const e = document.createElementNS(SVGNS, tag); e.setAttribute('class', cls); svg.appendChild(e); return e; };
  mk('path', 'k-track').setAttribute('d', arcD(-135, 135));
  const body = mk('circle', 'k-body');
  body.setAttribute('cx', 16); body.setAttribute('cy', 16); body.setAttribute('r', 8.5);
  const arc = mk('path', 'k-val'), ptr = mk('line', 'k-ptr');
  root.appendChild(svg);
  if (o.showLabel) root.appendChild(h('span', 'k-label', s.label));
  const valEl = o.showValue ? root.appendChild(h('span', 'k-value')) : null;

  const toN = v => (s.log ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min));
  const fromN = n => {
    n = clamp(n, 0, 1);
    let v = s.log ? s.min * Math.pow(s.max / s.min, n) : s.min + n * (s.max - s.min);
    if (s.step) v = Math.round(v / s.step) * s.step;
    return clamp(v, s.min, s.max);
  };
  const bip = o.bipolar != null ? o.bipolar : (s.min < 0 && s.max > 0);
  let value = o.value;
  function draw() {
    const n = clamp(toN(value), 0, 1), a = -135 + n * 270, from = bip ? 0 : -135;
    arc.setAttribute('d', arcD(Math.min(from, a), Math.max(from, a)));
    const sn = Math.sin(a * Math.PI / 180), cs = Math.cos(a * Math.PI / 180);
    ptr.setAttribute('x1', (16 + 2.5 * sn).toFixed(2)); ptr.setAttribute('y1', (16 - 2.5 * cs).toFixed(2));
    ptr.setAttribute('x2', (16 + 8 * sn).toFixed(2)); ptr.setAttribute('y2', (16 - 8 * cs).toFixed(2));
    const txt = fmtParam(s, value);
    root.setAttribute('aria-valuetext', txt);
    root.title = s.label + ': ' + txt + ' (doppio clic: valore iniziale)';
    if (valEl) valEl.textContent = txt;
  }
  function set(v, fire) {
    if (v === value) return;
    value = v;
    draw();
    if (fire) { o.onInput && o.onInput(v); hint(s.label + ': ' + fmtParam(s, v)); }
  }
  const stepN = () => (s.step && !s.log ? s.step / (s.max - s.min) : 0.02);
  root.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    root.focus({ preventScroll: true });
    root.setPointerCapture(e.pointerId);
    root.classList.add('drag');
    let lastY = e.clientY, n = toN(value);
    const move = ev => {
      const dy = lastY - ev.clientY;
      lastY = ev.clientY;
      n = clamp(n + dy / (ev.shiftKey ? 700 : 160), 0, 1);
      set(fromN(n), true);
    };
    const up = () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      root.classList.remove('drag');
      o.onCommit && o.onCommit(value);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  root.addEventListener('dblclick', e => { e.stopPropagation(); set(s.def, true); o.onCommit && o.onCommit(value); });
  let wheelT = 0;
  root.addEventListener('wheel', e => {
    e.preventDefault();
    set(fromN(toN(value) - Math.sign(e.deltaY) * stepN()), true);
    clearTimeout(wheelT);
    wheelT = setTimeout(() => o.onCommit && o.onCommit(value), 350);
  }, { passive: false });
  root.addEventListener('keydown', e => {
    const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    set(fromN(toN(value) + d * stepN() * (e.shiftKey ? 5 : 1)), true);
    o.onCommit && o.onCommit(value);
  });
  root.addEventListener('pointerenter', () => hint(s.label + ': ' + fmtParam(s, value)));
  // o.auto: automation target of this knob (right-click: create an automation clip). o.bind: live value getter.
  if (o.auto || o.onContext) root.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    if (o.onContext) o.onContext(e);
    else openMenu(e.clientX, e.clientY, [{ title: s.label }, ...autoMenuItems(o.auto), '-', { label: 'Valore iniziale', action: () => { set(s.def, true); o.onCommit && o.onCommit(value); } }]);
  });
  draw();
  root.setValue = v => { if (v !== value) { value = v; draw(); } };
  if (o.bind) { root._bind = o.bind; BOUND.add(root); }
  return root;
}
// Controls that follow values changed by automation while the song plays.
const BOUND = new Set();
function syncBound() {
  for (const el of BOUND) {
    if (!el.isConnected) { BOUND.delete(el); continue; }
    const v = el._bind();
    if (v != null) el.setValue(v);
  }
}

/* ---------- Vertical fader (mixer) ---------- */
// Vertical fader. Volume by default (value² is the gain, shown in dB); o.min / o.fmt / o.zero make it a generic slider.
function fader(o) {
  const root = h('div', 'fader');
  root.tabIndex = 0;
  root.setAttribute('role', 'slider');
  root.setAttribute('aria-label', o.label);
  root.append(h('div', 'fader-track'), h('div', 'fader-zero'), h('div', 'fader-cap'));
  const min = o.min || 0, span = o.max - min, fmt = o.fmt || volDb;
  root.style.setProperty('--z', String(((o.zero ?? 1) - min) / span));
  let value = o.value;
  const draw = () => {
    root.style.setProperty('--n', String(clamp((value - min) / span, 0, 1)));
    root.setAttribute('aria-valuetext', fmt(value));
    root.title = o.label + ': ' + fmt(value) + ' (doppio clic: valore iniziale)';
  };
  const set = v => { v = clamp(v, min, o.max); if (v === value) return; value = v; draw(); o.onInput && o.onInput(v); hint(o.label + ': ' + fmt(v)); };
  root.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    root.focus({ preventScroll: true });
    root.setPointerCapture(e.pointerId);
    let lastY = e.clientY;
    const travel = Math.max(30, root.clientHeight - 12);
    const move = ev => { const dy = lastY - ev.clientY; lastY = ev.clientY; set(value + dy / travel * span * (ev.shiftKey ? 0.2 : 1)); };
    const up = () => {
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', up);
      o.onCommit && o.onCommit(value);
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  });
  root.addEventListener('dblclick', e => { e.stopPropagation(); set(o.def); o.onCommit && o.onCommit(value); });
  let wheelT = 0;
  root.addEventListener('wheel', e => {
    e.preventDefault();
    set(value - Math.sign(e.deltaY) * span * 0.016);
    clearTimeout(wheelT);
    wheelT = setTimeout(() => o.onCommit && o.onCommit(value), 350);
  }, { passive: false });
  root.addEventListener('keydown', e => {
    const d = { ArrowUp: 1, ArrowDown: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    set(value + d * span * 0.016);
    o.onCommit && o.onCommit(value);
  });
  root.addEventListener('pointerenter', () => hint(o.label + ': ' + fmt(value)));
  if (o.onContext || o.auto) root.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation();
    if (o.onContext) o.onContext(e);
    else openMenu(e.clientX, e.clientY, [{ title: o.label }, ...autoMenuItems(o.auto)]);
  });
  draw();
  root.setValue = v => { if (v !== value) { value = v; draw(); } };
  if (o.bind) { root._bind = o.bind; BOUND.add(root); }
  return root;
}

/* ---------- Context menu ----------
   items: '-' separator · { title } heading · { col: true } starts a new column (side-by-side menus)
          · { label, key, checked, disabled, danger, color, action } · { label, sub: [items] } opens a submenu */
let menuEl = null, menuOnClose = null;
function closeMenu() {
  if (!menuEl) return;
  menuEl.remove();
  $$('.menu.submenu').forEach(m => m.remove());
  menuEl = null;
  document.removeEventListener('pointerdown', menuOutside, true);
  const f = menuOnClose;
  menuOnClose = null;
  if (f) f();
}
// Clicks on the menu bar buttons are handled by their own toggle logic.
function menuOutside(e) {
  if (!menuEl || (e.target.closest && (e.target.closest('.menu') || e.target.closest('[data-menu]')))) return;
  closeMenu();
}
function buildMenu(items, level) {
  const m = h('div', 'menu' + (level ? ' submenu' : ''));
  m.setAttribute('role', 'menu');
  m.dataset.level = level;
  let col = h('div', 'menu-col');
  m.appendChild(col);
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { col.appendChild(h('hr')); continue; }
    if (it.col) { col = h('div', 'menu-col'); m.appendChild(col); continue; }
    if (it.title) { col.appendChild(h('div', 'menu-title', it.title)); continue; }
    const b = h('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.color) { const sw = h('span', 'swatch'); sw.style.background = it.color; b.appendChild(sw); }
    b.appendChild(h('span', 'mi-label', it.label));
    if (it.key) b.appendChild(h('kbd', null, it.key));
    if (it.sub) { b.appendChild(h('span', 'sub', '›')); b.setAttribute('aria-haspopup', 'menu'); }
    if (it.checked) b.classList.add('checked');
    if (it.danger) b.classList.add('danger');
    b.disabled = !!it.disabled;
    b.addEventListener('pointerenter', () => {
      $$('.menu.submenu').forEach(x => { if (+x.dataset.level > level) x.remove(); });
      $$('.menu-item.open', m).forEach(x => x.classList.remove('open'));
      if (it.sub && !b.disabled) openSub(b, it.sub, level + 1);
    });
    b.addEventListener('click', () => {
      if (it.sub) { openSub(b, it.sub, level + 1); return; }
      closeMenu();
      it.action && it.action();
    });
    col.appendChild(b);
  }
  m.addEventListener('keydown', e => {
    const btns = $$('.menu-item:not(:disabled)', m), i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
    if (e.key === 'ArrowRight' && document.activeElement.getAttribute('aria-haspopup')) { e.preventDefault(); document.activeElement.click(); }
    if (e.key === 'ArrowLeft' && level) { e.preventDefault(); m.remove(); }
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    e.stopPropagation();
  });
  return m;
}
function placeMenu(m, x, y) {
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = clamp(x, 4, Math.max(4, window.innerWidth - r.width - 4)) + 'px';
  m.style.top = clamp(y, 4, Math.max(4, window.innerHeight - r.height - 4)) + 'px';
}
function openSub(anchor, items, level) {
  $$('.menu.submenu').forEach(x => { if (+x.dataset.level >= level) x.remove(); });
  anchor.classList.add('open');
  const m = buildMenu(items, level), r = anchor.getBoundingClientRect();
  placeMenu(m, r.right - 2, r.top - 4);
  const mr = m.getBoundingClientRect();
  if (mr.left < r.right - 10) m.style.left = Math.max(4, r.left - mr.width + 2) + 'px';
  m.style.zIndex = 1000 + level;
}
function openMenu(x, y, items, onClose) {
  closeMenu();
  menuOnClose = onClose || null;
  const m = buildMenu(items, 0);
  placeMenu(m, x, y);
  menuEl = m;
  const first = m.querySelector('.menu-item:not(:disabled)');
  if (first) first.focus({ preventScroll: true });
  setTimeout(() => document.addEventListener('pointerdown', menuOutside, true));
}
function menuAt(anchor, items, onClose) { const r = anchor.getBoundingClientRect(); openMenu(r.left, r.bottom + 1, items, onClose); }

/* ---------- Inline rename (prompt() is unavailable in embedded viewers) ---------- */
function inlineEdit(target, value, done) {
  const inp = h('input', 'inline-edit');
  inp.type = 'text';
  inp.value = value;
  inp.maxLength = 40;
  const r = target.getBoundingClientRect();
  Object.assign(inp.style, { position: 'fixed', left: r.left + 'px', top: r.top + 'px', width: Math.max(r.width, 140) + 'px', height: Math.max(r.height, 26) + 'px', zIndex: 150 });
  document.body.appendChild(inp);
  inp.focus();
  inp.select();
  let finished = false;
  const finish = ok => {
    if (finished) return;
    finished = true;
    const v = inp.value.trim();
    inp.remove();
    if (ok && v && v !== value) done(v);
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

/* ---------- Hint bar and toast ---------- */
let toastT = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2800);
}
function hint(msg) { const e = $('#hint'); if (e) e.textContent = msg; }
