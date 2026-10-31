'use strict';
/* Ritmo Studio — automation clips: created from any knob (right-click), edited as a curve in their own window,
   arranged on the playlist like patterns. The engines read them while the song plays (see Automation in audio.js). */

const AUTO_COLOR = '#9fb6c6';

function sameTarget(a, b) { return a.kind === b.kind && a.ch === b.ch && a.ins === b.ins && a.slot === b.slot && a.key === b.key && a.pid === b.pid; }

function autoTargetLabel(tg) {
  switch (tg.kind) {
    case 'chVol': case 'chPan': case 'chParam': {
      const ch = chById(tg.ch), what = tg.kind === 'chVol' ? 'Volume' : tg.kind === 'chPan' ? 'Panoramica' : (Automation.spec(tg) || {}).label || tg.key;
      return (ch ? ch.name : 'Canale') + ' - ' + what;
    }
    case 'mixVol': return insName(tg.ins) + ' - Volume';
    case 'mixPan': return insName(tg.ins) + ' - Panoramica';
    case 'fxParam': {
      const sl = proj.mixer[tg.ins] && proj.mixer[tg.ins].fx[tg.slot], spec = Automation.spec(tg);
      return insName(tg.ins) + ' - ' + (sl ? FXDEFS[sl.type].label : 'Slot ' + (tg.slot + 1)) + ' - ' + (spec ? spec.label : tg.key);
    }
    case 'plugin': return (tg.name || 'Plugin') + ' - ' + (tg.pname || 'parametro ' + tg.pid);
  }
  return 'Automazione';
}

// Current value of the target, as 0..1 on its knob.
function currentNorm(tg) {
  const spec = Automation.spec(tg);
  if (!spec) return tg.kind === 'plugin' ? (tg.value ?? 0.5) : 0.5;
  let v = 0;
  switch (tg.kind) {
    case 'chVol': v = chById(tg.ch).vol; break;
    case 'chPan': v = chById(tg.ch).pan; break;
    case 'chParam': v = chById(tg.ch).params[tg.key]; break;
    case 'mixVol': v = proj.mixer[tg.ins].vol; break;
    case 'mixPan': v = proj.mixer[tg.ins].pan; break;
    case 'fxParam': v = proj.mixer[tg.ins].fx[tg.slot].params[tg.key]; break;
  }
  return Automation.toNorm(spec, v);
}

function autoMenuItems(tg) {
  if (!tg) return [];
  const existing = proj.automation.find(a => sameTarget(a.target, tg));
  return [
    { label: 'Crea clip di automazione', action: () => createAutomation(tg) },
    ...(existing ? [{ label: 'Modifica “' + existing.name + '”', action: () => AutoEditor.open(existing.id) }] : []),
  ];
}

// Submenu of the channel menu: every automatable control of the channel.
function automationTargetsFor(ch) {
  const items = [
    { label: 'Volume', action: () => createAutomation({ kind: 'chVol', ch: ch.id }) },
    { label: 'Panoramica', action: () => createAutomation({ kind: 'chPan', ch: ch.id }) },
  ];
  const params = Object.entries(INSTRUMENTS[ch.type].params).filter(([, s]) => !s.select);
  if (params.length) items.push('-');
  params.forEach(([key, s]) => items.push({ label: s.label, action: () => createAutomation({ kind: 'chParam', ch: ch.id, key }) }));
  if (ch.type === 'plugin' && window.NativePlugins && NativePlugins.paramMenu) items.push('-', { label: 'Parametri del plugin…', action: () => NativePlugins.paramMenu('ch:' + ch.id, ch.name) });
  return items;
}

function createAutomation(tg) {
  const len = 4 * spb(), v = currentNorm(tg);
  const a = { id: uid(), name: autoTargetLabel(tg), color: AUTO_COLOR, len, target: tg, points: [{ s: 0, v }, { s: len, v }] };
  proj.automation.push(a);
  // a free playlist track at the song position (or after the last track's clips)
  const s = barAt(ui.songPos || 0).barStart, tracks = proj.playlist.tracks;
  let t = tracks.findIndex((_, i) => !proj.playlist.clips.some(c => c.t === i));
  if (t < 0) { tracks.push({ name: 'Traccia ' + (tracks.length + 1), mute: false }); t = tracks.length - 1; }
  proj.playlist.clips.push({ id: uid(), a: a.id, t, s, l: len });
  ui.plPick = { kind: 'auto', id: a.id };
  commit();
  PL.renderHeads();
  PL.draw();
  Tree.render();
  AutoEditor.open(a.id);
  toast('Clip di automazione aggiunta alla Playlist (traccia ' + (t + 1) + ')');
}

function deleteAutomation(a) {
  proj.automation = proj.automation.filter(x => x !== a);
  proj.playlist.clips = proj.playlist.clips.filter(c => c.a !== a.id);
  if (ui.plPick && ui.plPick.id === a.id) ui.plPick = null;
  if (AutoEditor.id === a.id) WM.close('auto');
  commit();
  PL.renderHeads();
  PL.draw();
  Tree.render();
}

/* ---------- Curve editor window ---------- */
const AutoEditor = {
  id: null, drag: null,
  get a() { return Automation.byId(this.id); },
  open(id) {
    this.id = id;
    WM.open('auto');
    this.render();
  },
  init() {
    const cv = $('#auto-cv');
    cv.addEventListener('pointerdown', e => this.down(e));
    cv.addEventListener('pointermove', e => this.move(e));
    cv.addEventListener('pointerup', () => this.up());
    cv.addEventListener('pointercancel', () => this.up());
    cv.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => this.draw()).observe(cv.parentElement);
    $('#auto-name').addEventListener('change', e => { const a = this.a; if (a) { a.name = e.target.value.trim() || a.name; commit(); PL.draw(); Tree.render(); } });
    $('#auto-len').addEventListener('change', e => {
      const a = this.a;
      if (!a) return;
      const old = a.len;
      a.len = +e.target.value;
      a.points = a.points.filter(p => p.s <= a.len);
      if (!a.points.some(p => p.s === a.len)) a.points.push({ s: a.len, v: Automation.valueAt({ points: a.points.length ? a.points : [{ s: 0, v: 0.5 }] }, a.len) });
      proj.playlist.clips.forEach(c => { if (c.a === a.id && c.l === old) c.l = a.len; });
      commit();
      PL.draw();
      this.draw();
    });
    $('#auto-shape').addEventListener('click', e => menuAt(e.currentTarget, [
      { label: 'Rampa in salita', action: () => this.shape(x => x) },
      { label: 'Rampa in discesa', action: () => this.shape(x => 1 - x) },
      { label: 'Sinusoide (una per battuta)', action: () => this.shape((x, s) => 0.5 + 0.5 * Math.sin(s / spb() * 2 * Math.PI), 1) },
      { label: 'Onda quadra (quarti)', action: () => this.shape((x, s) => (Math.floor(s / 4) % 2 ? 0.15 : 0.85), 2) },
      { label: 'Piatta', action: () => this.shape(() => currentNorm(this.a.target)) },
    ]));
    $('#auto-del').addEventListener('click', () => { const a = this.a; if (a) deleteAutomation(a); });
  },
  // Replace the curve with a shape sampled every 'every' steps.
  shape(fn, every) {
    const a = this.a;
    if (!a) return;
    const pts = [];
    if (every) for (let s = 0; s <= a.len; s += every) pts.push({ s, v: clamp(fn(s / a.len, s), 0, 1) });
    else pts.push({ s: 0, v: clamp(fn(0, 0), 0, 1) }, { s: a.len, v: clamp(fn(1, a.len), 0, 1) });
    a.points = pts;
    commit();
    PL.draw();
    this.draw();
  },
  render() {
    const a = this.a;
    if (!a) { WM.close('auto'); return; }
    $('#auto-title').textContent = a.name;
    $('#auto-name').value = a.name;
    const len = $('#auto-len');
    if (!Array.from(len.options).some(o => +o.value === a.len)) len.appendChild(new Option((a.len / spb()) + ' battute', a.len));
    len.value = String(a.len);
    $('#auto-target').textContent = 'Controlla: ' + autoTargetLabel(a.target);
    this.draw();
  },
  geo() {
    const cv = $('#auto-cv'), W = cv.parentElement.clientWidth, H = cv.parentElement.clientHeight, a = this.a;
    return { W, H, pad: 8, sx: (W - 16) / a.len, sy: H - 16 };
  },
  toPt(e) {
    const g = this.geo(), r = $('#auto-cv').getBoundingClientRect();
    return { s: clamp((e.clientX - r.left - g.pad) / g.sx, 0, this.a.len), v: clamp(1 - (e.clientY - r.top - g.pad) / g.sy, 0, 1) };
  },
  near(e) {
    const g = this.geo(), r = $('#auto-cv').getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 10;
    this.a.points.forEach((p, i) => { const d = Math.hypot(g.pad + p.s * g.sx - x, g.pad + (1 - p.v) * g.sy - y); if (d < bd) { bd = d; best = i; } });
    return best;
  },
  down(e) {
    const a = this.a;
    if (!a) return;
    const cv = $('#auto-cv'), i = this.near(e);
    cv.setPointerCapture(e.pointerId);
    if (e.button === 2) {
      if (i > 0 && i < a.points.length - 1) { a.points.splice(i, 1); commit(); PL.draw(); this.draw(); }
      return;
    }
    if (i >= 0) { this.drag = { i }; return; }
    const p = this.toPt(e), q = e.shiftKey ? 0 : 1;
    if (q) p.s = Math.round(p.s);
    a.points.push(p);
    a.points.sort((x, y) => x.s - y.s);
    this.drag = { i: a.points.indexOf(p) };
    this.draw();
  },
  move(e) {
    const a = this.a, d = this.drag;
    if (!a) return;
    if (!d) { $('#auto-cv').style.cursor = this.near(e) >= 0 ? 'grab' : 'crosshair'; return; }
    const p = a.points[d.i], q = this.toPt(e), last = a.points.length - 1;
    // the first and last points stay at the clip edges; the others stay between their neighbours
    if (d.i === 0) p.s = 0;
    else if (d.i === last) p.s = a.len;
    else p.s = clamp(e.shiftKey ? q.s : Math.round(q.s), a.points[d.i - 1].s, a.points[d.i + 1].s);
    p.v = q.v;
    const spec = Automation.spec(a.target);
    hint(a.name + ': ' + (spec && !spec.select ? fmtParam(spec, Automation.fromNorm(spec, p.v)) : Math.round(p.v * 100) + '%') + ' · passo ' + (p.s + 1).toFixed(0));
    this.draw();
    PL.draw();
  },
  up() { if (this.drag) { this.drag = null; commit(); PL.draw(); } },
  draw() {
    if (!this.id || !proj || !proj.automation) return;
    const a = this.a;
    if (!a || !WM.isOpen('auto')) return;
    const g0 = this.geo(), cv = $('#auto-cv'), g = fitCanvas(cv, g0.W, g0.H), { pad, sx, sy } = g0;
    g.fillStyle = TH.grid;
    g.fillRect(0, 0, g0.W, g0.H);
    for (let s = 0; s <= a.len; s += 4) {
      g.fillStyle = s % spb() === 0 ? TH.lineBar : TH.lineBeat;
      g.fillRect(Math.round(pad + s * sx), 0, 1, g0.H);
    }
    g.fillStyle = TH.lineBeat;
    g.fillRect(0, Math.round(pad + sy / 2), g0.W, 1);
    g.beginPath();
    a.points.forEach((p, i) => { const x = pad + p.s * sx, y = pad + (1 - p.v) * sy; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.lineTo(pad + a.len * sx, pad + sy);
    g.lineTo(pad, pad + sy);
    g.closePath();
    g.fillStyle = a.color + '30';
    g.fill();
    g.beginPath();
    a.points.forEach((p, i) => { const x = pad + p.s * sx, y = pad + (1 - p.v) * sy; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.strokeStyle = a.color;
    g.lineWidth = 2;
    g.stroke();
    g.lineWidth = 1;
    a.points.forEach(p => {
      g.beginPath();
      g.arc(pad + p.s * sx, pad + (1 - p.v) * sy, 4.5, 0, Math.PI * 2);
      g.fillStyle = TH.panel;
      g.fill();
      g.strokeStyle = TH.text;
      g.stroke();
    });
  },
};
