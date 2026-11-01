'use strict';
/* Ritmo Studio — Piano Roll: notes of the selected channel in the current pattern.
   Tools: draw, paint, delete, mute, slice, select; chord stamp; scale highlighting; velocity lane; editing tools menu. */

const PR_TOOLS = {
  draw: { label: T('Disegna'), hint: T('Clic: aggiungi una nota (o un accordo) e trascinala; bordo destro: allunga') },
  paint: { label: T('Pennello'), hint: T('Trascina per dipingere note in sequenza') },
  delete: { label: T('Cancella'), hint: T('Clic o trascina sulle note per cancellarle') },
  mute: { label: T('Muta'), hint: T('Clic o trascina per mutare / riattivare le note') },
  slice: { label: T('Taglia'), hint: T('Clic su una nota per tagliarla in due al punto della griglia') },
  select: { label: T('Seleziona'), hint: T('Trascina per selezionare; trascina una nota selezionata per spostare') },
  lasso: { label: T('Lazo'), hint: T('Disegna a mano libera intorno alle note da selezionare (Maiusc aggiunge)') },
  zoom: { label: T('Zoom'), hint: T('Trascina sul tratto da ingrandire, clic ingrandisce, clic destro riduce') },
  play: { label: T('Ascolta'), hint: T('Tieni premuto e scorri: suonano le note sotto il cursore') },
};
// Event lane under the notes: one note property at a time.
const PR_LANES = [['v', T('Vel')], ['rel', T('Rilascio')], ['pan', T('Pan')], ['fine', T('Fine')], ['mx', T('Mod X')], ['my', T('Mod Y')]];

const PR = {
  rowH: 14, lo: 24, hi: 109, // C1 … C8
  tool: 'draw', chord: '', chordTop: false, color: 0, slideMode: false, portaMode: false,
  sel: new Set(), drag: null, clipboard: null, pv: null, pvKey: null, scrolled: false, velDrag: false,
  get lane() { return NOTE_PROPS[ui.prLane] ? ui.prLane : 'v'; },
  get sw() { return 20 * ui.prZoom; },
  get scale() { return proj.scale || { root: 0, type: 'none' }; },
  init() {
    this.sc = $('#pr-scroll'); this.sizer = $('#pr-sizer'); this.cv = $('#pr-canvas');
    this.kc = $('#pr-keys'); this.rc = $('#pr-ruler'); this.vc = $('#pr-vel');
    this.sc.addEventListener('scroll', () => this.draw());
    new ResizeObserver(() => this.draw()).observe(this.sc);
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', () => this.up());
    this.cv.addEventListener('pointercancel', () => this.up());
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    this.sc.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
    }, { passive: false });
    this.kc.addEventListener('pointerdown', e => {
      const ch = chById(ui.selCh);
      if (!ch) return;
      audioReady();
      const r = this.kc.getBoundingClientRect();
      const m = this.rowToM(e.clientY - r.top + this.sc.scrollTop);
      this.kc.setPointerCapture(e.pointerId);
      this.preview(ch, m, 0.8);
    });
    const kOff = () => this.stopPreview();
    this.kc.addEventListener('pointerup', kOff);
    this.kc.addEventListener('pointercancel', kOff);
    this.vc.addEventListener('pointerdown', e => { this.velDrag = e.button === 2 ? 'reset' : true; this.vc.setPointerCapture(e.pointerId); this.laneAt(e); });
    this.vc.addEventListener('pointermove', e => { if (this.velDrag) this.laneAt(e); });
    this.vc.addEventListener('contextmenu', e => e.preventDefault());
    const vEnd = () => { if (this.velDrag) { this.velDrag = false; commit(); afterNotesChanged('piano'); } };
    this.vc.addEventListener('pointerup', vEnd);
    this.vc.addEventListener('pointercancel', vEnd);
    const lane = $('#pr-lane');
    PR_LANES.forEach(([k, l]) => lane.appendChild(new Option(l, k)));
    lane.addEventListener('change', () => { ui.prLane = lane.value; savePrefs(); this.draw(); hint(T('Corsia: {0} — trascina per cambiare, clic destro riporta al valore normale', T(NOTE_PROPS[this.lane].label))); });
    this.cv.addEventListener('dblclick', e => {
      const { x, y } = this.pt(e), hit = this.hit(x, y);
      if (hit) openNoteProps(hit.n, e.clientX, e.clientY);
    });
    $('#pr-color').addEventListener('click', e => menuAt(e.currentTarget, noteColorMenu()));
    $('#pr-slide').addEventListener('click', e => { this.slideMode = !this.slideMode; if (this.slideMode) this.portaMode = false; this.refreshToolbar(); hint(this.slideMode ? T('Slide: le nuove note fanno scivolare l\'intonazione delle note che suonano') : T('Slide disattivato')); });
    $('#pr-porta').addEventListener('click', e => { this.portaMode = !this.portaMode; if (this.portaMode) this.slideMode = false; this.refreshToolbar(); hint(this.portaMode ? T('Porta: le nuove note partono dall\'intonazione della nota precedente') : T('Porta disattivato')); });

    $('#pr-ch').addEventListener('change', e => { Rack.select(e.target.value); this.scrollToNotes(); });
    $('#pr-snap').addEventListener('change', e => { ui.prSnap = +e.target.value; savePrefs(); });
    $('#pr-zoom-in').addEventListener('click', () => this.zoom(1.25));
    $('#pr-zoom-out').addEventListener('click', () => this.zoom(0.8));
    $('#pr-ghost').addEventListener('click', e => { ui.ghost = !ui.ghost; e.currentTarget.setAttribute('aria-pressed', String(ui.ghost)); savePrefs(); this.draw(); });
    $('#pr-quant').addEventListener('click', () => this.quantize());
    $('#pr-clear').addEventListener('click', () => { const ch = chById(ui.selCh); if (ch) clearChannel(ch); });
    $$('[data-prtool]').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.prtool)));
    $('#pr-tools-menu').addEventListener('click', e => menuAt(e.currentTarget, prToolsMenu()));
    const chordSel = $('#pr-chord');
    chordSel.appendChild(new Option(T('Nessun accordo'), ''));
    chordSel.appendChild(new Option(T('Triade nella scala'), 'scale3'));
    chordSel.appendChild(new Option(T('Settima nella scala'), 'scale4'));
    Object.entries(CHORDS).forEach(([k, c]) => chordSel.appendChild(new Option(T(c.label) + (c.sym ? ' (' + c.sym + ')' : ''), k)));
    chordSel.addEventListener('change', () => { this.chord = chordSel.value; hint(this.chord ? T('Chord Stamp: ogni clic inserisce un accordo') : T('Chord Stamp disattivato')); });
    $('#pr-chord-top').addEventListener('click', e => {
      this.chordTop = !this.chordTop;
      e.currentTarget.setAttribute('aria-pressed', String(this.chordTop));
      hint(this.chordTop ? T('Chord Stamp dall’alto: la nota cliccata è la voce più acuta') : T('Chord Stamp dal basso: la nota cliccata è la fondamentale'));
    });
    const root = $('#pr-scale-root'), type = $('#pr-scale-type');
    NOTE_NAMES.forEach((n, i) => root.appendChild(new Option(n, i)));
    Object.entries(SCALES).forEach(([k, s]) => type.appendChild(new Option(T(s.label), k)));
    const setScale = () => { proj.scale = { root: +root.value, type: type.value }; commit(); this.draw(); };
    root.addEventListener('change', setScale);
    type.addEventListener('change', setScale);
  },
  setTool(t) {
    this.tool = t;
    $$('[data-prtool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.prtool === t)));
    hint(PR_TOOLS[t].label + ': ' + PR_TOOLS[t].hint);
  },
  refreshToolbar() {
    const sel = $('#pr-ch');
    sel.textContent = '';
    proj.channels.forEach(c => sel.appendChild(new Option(c.name, c.id)));
    if (ui.selCh) sel.value = ui.selCh;
    const ch = chById(ui.selCh);
    $('#pr-title').textContent = '· ' + curPat().name + (ch ? ' › ' + ch.name : '');
    $('#pr-snap').value = String(ui.prSnap);
    $('#pr-ghost').setAttribute('aria-pressed', String(ui.ghost));
    $('#pr-scale-root').value = String(this.scale.root);
    $('#pr-scale-type').value = this.scale.type;
    $$('[data-prtool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.prtool === this.tool)));
    $('#pr-lane').value = this.lane;
    $('#pr-color').style.setProperty('--nc', this.color ? NOTE_COLORS[this.color] : (ch ? ch.color : NOTE_COLORS[0]));
    $('#pr-color').title = T('Colore delle nuove note: {0} (canale MIDI {0})', this.color + 1);
    $('#pr-slide').setAttribute('aria-pressed', String(this.slideMode));
    $('#pr-porta').setAttribute('aria-pressed', String(this.portaMode));
  },
  // Properties a newly drawn note takes from the toolbar: colour, slide, portamento.
  newNote(s, m) {
    const n = { s, l: ui.lastLen, m, v: 0.8 };
    if (this.color) n.col = this.color;
    if (this.slideMode) n.slide = true;
    if (this.portaMode) n.porta = true;
    return n;
  },
  noteColor(n, ch) { return n.col ? NOTE_COLORS[n.col] : ch.color; },
  notes() { const ch = chById(ui.selCh); return ch ? (curPat().notes[ch.id] || []) : []; },
  ensureNotes() { const ch = chById(ui.selCh), p = curPat(); return ch ? (p.notes[ch.id] = p.notes[ch.id] || []) : null; },
  target() { return this.sel.size ? Array.from(this.sel) : this.notes(); },
  rowToM(y) { return this.hi - 1 - Math.floor(y / this.rowH); },
  mToY(m) { return (this.hi - 1 - m) * this.rowH; },
  pt(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left + this.sc.scrollLeft, y: e.clientY - r.top + this.sc.scrollTop }; },
  snapFloor(x) { const q = ui.prSnap; return Math.max(0, Math.floor(x / this.sw / q) * q); },
  scrollToNotes() {
    const notes = this.notes();
    let m = 60;
    if (notes.length) m = Math.round(notes.reduce((a, n) => a + n.m, 0) / notes.length);
    this.sc.scrollTop = Math.max(0, this.mToY(m) - this.sc.clientHeight / 2);
    this.scrolled = true;
  },
  zoom(f, clientX) {
    const old = this.sw, r = this.sc.getBoundingClientRect();
    const vx = clientX != null ? clientX - r.left : this.sc.clientWidth / 2;
    const cx = (this.sc.scrollLeft + vx) / old;
    ui.prZoom = clamp(ui.prZoom * f, 0.25, 4);
    savePrefs();
    this.draw();
    this.sc.scrollLeft = Math.max(0, cx * this.sw - vx);
    this.draw();
  },
  hit(x, y) {
    const notes = this.notes(), m = this.rowToM(y), sw = this.sw;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.m !== m) continue;
      const x0 = n.s * sw, x1 = (n.s + n.l) * sw;
      if (x >= x0 && x <= x1) return { n, edge: x >= x1 - Math.min(8, (x1 - x0) / 3) };
    }
    return null;
  },
  removeNotes(list) {
    const ch = chById(ui.selCh), p = curPat();
    if (!ch || !p.notes[ch.id]) return;
    const kill = new Set(list);
    p.notes[ch.id] = p.notes[ch.id].filter(n => !kill.has(n));
    if (!p.notes[ch.id].length) delete p.notes[ch.id];
    list.forEach(n => this.sel.delete(n));
  },
  preview(ch, m, v) {
    this.stopPreview();
    if (!engine) return;
    this.pv = engine.noteOn(ch, m, v);
    this.pvKey = m;
    this.drawKeys();
  },
  stopPreview() {
    if (this.pv && engine) engine.noteOff(this.pv);
    this.pv = null;
    if (this.pvKey != null) { this.pvKey = null; this.drawKeys(); }
  },
  /** Pitches inserted by one click of the draw tool, honouring the chord stamp. */
  stampPitches(m) {
    if (!this.chord) return [m];
    const sc = this.scale;
    if (this.chord === 'scale3' || this.chord === 'scale4') {
      const notes = diatonicChord(m, sc.root, sc.type === 'none' ? 'major' : sc.type, this.chord === 'scale4' ? 4 : 3);
      return this.chordTop ? notes.map((n, i) => (i === 0 ? n : n - 12 * Math.ceil((n - notes[0] + 0.5) / 12))).sort((a, b) => a - b) : notes;
    }
    return buildChord(m, this.chord, this.chordTop);
  },
  down(e) {
    const ch = chById(ui.selCh);
    if (!ch) { toast(T('Seleziona prima un canale nel Channel Rack')); return; }
    audioReady();
    const { x, y } = this.pt(e), hit = this.hit(x, y), p = curPat(), q = ui.prSnap, tool = this.tool;
    this.cv.setPointerCapture(e.pointerId);
    if (tool === 'zoom') { if (e.button === 2) this.zoom(0.66, e.clientX); else this.drag = { mode: 'zoom', x0: x, x1: x }; return; }
    if (tool === 'play') { if (e.button === 0) { this.drag = { mode: 'play', ms: [] }; this.playAt(x); } return; }
    if (tool === 'lasso' && e.button === 0 && !(hit && this.sel.has(hit.n))) { this.drag = { mode: 'lasso', pts: [[x, y]], base: e.shiftKey ? new Set(this.sel) : new Set() }; return; }
    if (e.button === 2 || (e.button === 0 && tool === 'delete')) {
      this.drag = { mode: 'erase' };
      if (hit) this.removeNotes([hit.n]);
      this.draw();
      return;
    }
    if (e.button !== 0) return;
    if (tool === 'mute') {
      const to = hit ? !hit.n.mu : true;
      this.drag = { mode: 'mute', to };
      if (hit) { if (to) hit.n.mu = true; else delete hit.n.mu; }
      this.draw();
      return;
    }
    if (tool === 'slice') {
      if (hit) {
        const cut = Math.round(x / this.sw / q) * q, n = hit.n;
        if (cut > n.s && cut < n.s + n.l) {
          const rest = { ...n, s: cut, l: n.s + n.l - cut };
          n.l = cut - n.s;
          this.ensureNotes().push(rest);
          hint(T('Nota tagliata alla battuta {0}, battito {1}', barAt(cut, false).bar, barAt(cut, false).beat));
        }
      }
      this.drag = { mode: 'slice' };
      this.draw();
      return;
    }
    if (!hit && (tool === 'select' || e.ctrlKey || e.metaKey || e.shiftKey)) {
      this.drag = { mode: 'select', x0: x, y0: y, x1: x, y1: y, base: e.shiftKey ? new Set(this.sel) : new Set() };
      return;
    }
    let anchor, created = false;
    if (hit) {
      anchor = hit.n;
      if (!this.sel.has(anchor)) { if (!e.shiftKey) this.sel.clear(); this.sel.add(anchor); }
    } else {
      const s = this.snapFloor(x), m0 = clamp(this.rowToM(y), this.lo, this.hi - 1);
      const added = this.stampPitches(m0).filter(m => m >= this.lo && m < this.hi).map(m => this.newNote(s, m));
      this.ensureNotes().push(...added);
      this.sel = new Set(added);
      anchor = added.find(n => n.m === m0) || added[0];
      created = true;
    }
    const mode = hit && hit.edge ? 'resize' : (tool === 'paint' && created ? 'paint' : 'move');
    this.drag = { mode, x0: x, y0: y, anchor, created, lastM: anchor.m, lastCell: anchor.s, orig: Array.from(this.sel).map(n => ({ n, s: n.s, m: n.m, l: n.l })) };
    if (mode !== 'resize') this.preview(ch, anchor.m, anchor.v);
    this.draw();
  },
  move(e) {
    const { x, y } = this.pt(e), d = this.drag;
    if (!d) {
      const hit = this.hit(x, y), t = this.tool;
      this.cv.style.cursor = t === 'delete' ? (hit ? 'not-allowed' : 'default') : t === 'slice' ? 'col-resize' : t === 'mute' ? 'pointer'
        : hit ? (hit.edge ? 'ew-resize' : 'grab') : 'crosshair';
      return;
    }
    const q = ui.prSnap, sw = this.sw;
    if (d.mode === 'zoom') { d.x1 = x; this.draw(); return; }
    if (d.mode === 'play') { this.playAt(x); return; }
    if (d.mode === 'lasso') {
      d.pts.push([x, y]);
      const sel = new Set(d.base), rh = this.rowH;
      for (const n of this.notes()) if (inPolygon((n.s + Math.min(n.l, 1) / 2) * sw, this.mToY(n.m) + rh / 2, d.pts)) sel.add(n);
      this.sel = sel;
      this.draw();
      return;
    }
    if (d.mode === 'erase') { const hit = this.hit(x, y); if (hit) { this.removeNotes([hit.n]); this.draw(); } return; }
    if (d.mode === 'mute') { const hit = this.hit(x, y); if (hit && !!hit.n.mu !== d.to) { if (d.to) hit.n.mu = true; else delete hit.n.mu; this.draw(); } return; }
    if (d.mode === 'slice') return;
    if (d.mode === 'select') {
      d.x1 = x; d.y1 = y;
      const xa = Math.min(d.x0, x), xb = Math.max(d.x0, x), ya = Math.min(d.y0, y), yb = Math.max(d.y0, y), sel = new Set(d.base);
      for (const n of this.notes()) {
        const nx0 = n.s * sw, nx1 = (n.s + n.l) * sw, ny0 = this.mToY(n.m), ny1 = ny0 + this.rowH;
        if (nx1 > xa && nx0 < xb && ny1 > ya && ny0 < yb) sel.add(n);
      }
      this.sel = sel;
      this.draw();
      return;
    }
    if (d.mode === 'paint') {
      const cell = this.snapFloor(x), m = clamp(this.rowToM(y), this.lo, this.hi - 1), len = ui.lastLen;
      if (cell !== d.lastCell && Math.abs(cell - d.lastCell) >= len - 1e-9) {
        d.lastCell = cell;
        const busy = this.notes().some(n => n.m === m && n.s < cell + len && n.s + n.l > cell);
        if (!busy) {
          const added = this.stampPitches(m).filter(v => v >= this.lo && v < this.hi).map(v => this.newNote(cell, v));
          this.ensureNotes().push(...added);
          added.forEach(n => this.sel.add(n));
          this.preview(chById(ui.selCh), m, 0.8);
        }
        this.draw();
      }
      return;
    }
    const dS = Math.round((x - d.x0) / sw / q) * q;
    if (d.mode === 'move') {
      const minS = Math.min(...d.orig.map(o => o.s)), shift = Math.max(dS, -minS);
      const ms = d.orig.map(o => o.m);
      const dm = clamp(this.rowToM(y) - this.rowToM(d.y0), this.lo - Math.min(...ms), this.hi - 1 - Math.max(...ms));
      for (const o of d.orig) { o.n.s = o.s + shift; o.n.m = o.m + dm; }
      if (d.anchor.m !== d.lastM) { d.lastM = d.anchor.m; this.preview(chById(ui.selCh), d.anchor.m, d.anchor.v); }
    } else {
      for (const o of d.orig) o.n.l = Math.max(q, o.l + dS);
    }
    this.draw();
  },
  up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.stopPreview();
    if (d.mode === 'zoom') {
      if (Math.abs(d.x1 - d.x0) > 8) {
        const a = Math.min(d.x0, d.x1) / this.sw, b = Math.max(d.x0, d.x1) / this.sw;
        ui.prZoom = clamp(this.sc.clientWidth / Math.max(0.5, b - a) / 20, 0.25, 4);
        savePrefs(); this.draw(); this.sc.scrollLeft = a * this.sw; this.draw();
      } else this.zoom(1.5, d.x0 - this.sc.scrollLeft + this.sc.getBoundingClientRect().left);
      return;
    }
    if (d.mode === 'play') { this.stopPlayAt(d); return; }
    if (d.mode === 'lasso') { this.draw(); if (window.ChordPanel) ChordPanel.update(); return; }
    if ((d.mode === 'resize' || d.created) && d.anchor) ui.lastLen = d.anchor.l;
    commit();
    afterNotesChanged('piano');
    this.draw();
    if (window.ChordPanel) ChordPanel.update();
  },
  // Event lane: drag sets the property of the notes under the pointer; right click puts back the normal value.
  laneAt(e) {
    const ch = chById(ui.selCh);
    if (!ch) return;
    const k = this.lane, P = NOTE_PROPS[k], r = this.vc.getBoundingClientRect(), x = e.clientX - r.left + this.sc.scrollLeft;
    const f = clamp(1 - (e.clientY - r.top - 4) / (r.height - 8), 0, 1), sw = this.sw;
    const v = this.velDrag === 'reset' ? P.def : k === 'v' ? Math.max(0.02, f) : P.min + f * (P.max - P.min);
    let hitAny = false;
    for (const n of this.notes()) {
      if (this.sel.size && !this.sel.has(n)) continue;
      if (Math.abs(x - n.s * sw) <= Math.max(5, sw * 0.4)) { setNoteProp(n, k, v); hitAny = true; }
    }
    if (hitAny) { hint(T(P.label) + ': ' + fmtNoteProp(k, v)); this.draw(); }
  },
  // Play tool: the notes under the pointer sound while it stays on them.
  playAt(x) {
    const ch = chById(ui.selCh), d = this.drag;
    if (!ch || !engine || !d) return;
    const s = x / this.sw, ms = this.notes().filter(n => !n.mu && !n.slide && n.s <= s && n.s + n.l > s);
    const key = ms.map(n => n.m).sort().join(',');
    if (key === d.key) return;
    this.stopPlayAt(d);
    d.key = key;
    d.voices = ms.map(n => engine.noteOn(ch, n.m, n.v));
    this.pvKey = ms.length ? ms[0].m : null;
    this.drawKeys();
  },
  stopPlayAt(d) {
    if (d && d.voices && engine) d.voices.forEach(v => engine.noteOff(v));
    if (d) d.voices = [];
    this.pvKey = null;
    this.drawKeys();
  },
  quantize(lengthsToo) {
    const notes = this.target();
    if (!notes.length) { toast(T('Nessuna nota da quantizzare')); return; }
    const q = ui.prSnap;
    notes.forEach(n => {
      n.s = Math.max(0, Math.round(n.s / q) * q);
      if (lengthsToo) n.l = Math.max(q, Math.round(n.l / q) * q);
    });
    this.applied(T('{0} note allineate alla griglia', notes.length));
  },
  applied(msg) {
    commit();
    afterNotesChanged();
    if (msg) toast(msg);
  },
  key(e) {
    const ch = chById(ui.selCh);
    if (!ch) return false;
    const p = curPat(), mod = e.ctrlKey || e.metaKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) {
      this.removeNotes(Array.from(this.sel));
      commit(); afterNotesChanged();
      return true;
    }
    if (mod && e.code === 'KeyA') { this.sel = new Set(this.notes()); this.draw(); if (window.ChordPanel) ChordPanel.update(); return true; }
    if (mod && e.code === 'KeyC' && this.sel.size) {
      this.clipboard = Array.from(this.sel).map(n => ({ ...n }));
      toast(T('{0} note copiate', this.clipboard.length));
      return true;
    }
    if (mod && e.code === 'KeyV' && this.clipboard) {
      const add = this.clipboard.map(n => ({ ...n }));
      (p.notes[ch.id] = p.notes[ch.id] || []).push(...add);
      this.sel = new Set(add);
      commit(); afterNotesChanged();
      return true;
    }
    if (mod && e.code === 'KeyD' && this.sel.size) {
      const sel = Array.from(this.sel), s0 = Math.min(...sel.map(n => n.s)), s1 = Math.max(...sel.map(n => n.s + n.l));
      const span = Math.ceil((s1 - s0) / 4) * 4 || 4;
      const add = sel.map(n => ({ ...n, s: n.s + span }));
      p.notes[ch.id].push(...add);
      this.sel = new Set(add);
      commit(); afterNotesChanged();
      return true;
    }
    if (this.sel.size && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const sel = Array.from(this.sel);
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        if (sel.every(n => n.m + d >= this.lo && n.m + d < this.hi)) sel.forEach(n => { n.m += d; });
      } else {
        const d = (e.key === 'ArrowRight' ? 1 : -1) * ui.prSnap;
        if (sel.every(n => n.s + d >= 0)) sel.forEach(n => { n.s += d; });
      }
      commit(); afterNotesChanged();
      return true;
    }
    return false;
  },

  /* ---------- drawing ---------- */
  draw() {
    if (!WM.isOpen('piano')) return;
    const sc = this.sc, W = sc.clientWidth, H = sc.clientHeight;
    if (!W || !H) return;
    const p = curPat(), L = patLen(p), sw = this.sw, rh = this.rowH, scale = this.scale;
    const cw = Math.max(W, (L + 4 * spb()) * sw), chh = Math.max(H, (this.hi - this.lo) * rh);
    this.sizer.style.width = cw + 'px';
    this.sizer.style.height = chh + 'px';
    if (!this.scrolled) this.scrollToNotes();
    const sx = sc.scrollLeft, sy = sc.scrollTop, g = fitCanvas(this.cv, W, H);
    g.fillStyle = TH.grid;
    g.fillRect(0, 0, W, H);
    const mTop = this.rowToM(sy), mBot = Math.max(this.lo, this.rowToM(sy + H));
    const hasScale = scale.type !== 'none';
    for (let m = mTop; m >= mBot; m--) {
      const y = this.mToY(m) - sy;
      if (hasScale) {
        if (inScale(m, scale.root, scale.type)) { g.fillStyle = pc(m - scale.root) === 0 ? TH.scaleRoot : TH.scaleIn; g.fillRect(0, y, W, rh); }
      } else if (isBlack(m)) { g.fillStyle = TH.gridBlack; g.fillRect(0, y, W, rh); }
      g.fillStyle = m % 12 === 0 ? TH.lineBar : TH.lineStep;
      g.fillRect(0, y + rh - 1, W, 1);
    }
    const i0 = Math.floor(sx / sw), i1 = Math.ceil((sx + W) / sw);
    for (let i = i0; i <= i1; i++) {
      const bar = i % spb() === 0, beat = i % beatSteps() === 0;
      if (!beat && sw < 7) continue;
      g.fillStyle = bar ? TH.lineBar : beat ? TH.lineBeat : TH.lineStep;
      g.fillRect(Math.round(i * sw - sx), 0, 1, H);
    }
    const xe = L * sw - sx;
    if (xe < W) { g.fillStyle = TH.outside; g.fillRect(Math.max(0, xe), 0, W - Math.max(0, xe), H); }
    const ch = chById(ui.selCh);
    if (ui.ghost) {
      g.lineWidth = 1;
      for (const o of proj.channels) {
        if (o === ch) continue;
        for (const n of p.notes[o.id] || []) this.noteRect(g, n, o.color, sx, sy, W, H, true, false);
      }
    }
    if (ch) for (const n of p.notes[ch.id] || []) this.noteRect(g, n, this.noteColor(n, ch), sx, sy, W, H, false, this.sel.has(n));
    const d = this.drag;
    if (d && d.mode === 'select') {
      g.strokeStyle = TH.brass;
      g.setLineDash([4, 3]);
      g.strokeRect(Math.min(d.x0, d.x1) - sx + 0.5, Math.min(d.y0, d.y1) - sy + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    }
    if (d && d.mode === 'lasso' && d.pts.length > 1) {
      g.strokeStyle = TH.brass; g.fillStyle = '#e8b55e18'; g.setLineDash([4, 3]);
      g.beginPath();
      d.pts.forEach(([px, py], i) => (i ? g.lineTo(px - sx, py - sy) : g.moveTo(px - sx, py - sy)));
      g.closePath(); g.fill(); g.stroke(); g.setLineDash([]);
    }
    if (d && d.mode === 'zoom') { g.fillStyle = '#ffffff18'; g.fillRect(Math.min(d.x0, d.x1) - sx, 0, Math.abs(d.x1 - d.x0), H); }
    const pos = Transport.playing && ui.mode === 'pattern' ? Transport.position() : null;
    if (pos != null) { g.fillStyle = TH.signal; g.fillRect(Math.round(pos * sw - sx), 0, 2, H); }
    if (!ch) {
      g.fillStyle = TH.dim;
      g.font = '500 14px ' + TH.label;
      g.fillText(T('Aggiungi un canale nel Channel Rack per scrivere note.'), 16, 28);
    }
    this.drawKeys();
    this.drawRuler(sx, W, L, pos);
    this.drawLane(sx, W, ch, p);
  },
  noteRect(g, n, color, sx, sy, W, H, ghost, sel) {
    const sw = this.sw, rh = this.rowH, x = n.s * sw - sx, w = Math.max(3, n.l * sw - 1), y = this.mToY(n.m) - sy;
    if (x > W || x + w < 0 || y > H || y + rh < 0) return;
    if (ghost) { g.strokeStyle = color + '50'; g.strokeRect(x + 0.5, y + 1.5, w - 1, rh - 3); return; }
    if (n.mu) {
      g.strokeStyle = color;
      g.globalAlpha = 0.7;
      rrect(g, x + 0.5, y + 1.5, w - 1, rh - 3, 3);
      g.stroke();
      g.globalAlpha = 0.25;
      g.fillStyle = color;
      g.fill();
      g.globalAlpha = 1;
    } else {
      g.globalAlpha = 0.5 + 0.5 * n.v;
      g.fillStyle = color;
      rrect(g, x, y + 1, w, rh - 2, 3);
      g.fill();
      g.globalAlpha = 1;
    }
    if (sel) { g.strokeStyle = TH.text; g.lineWidth = 1.5; rrect(g, x + 0.75, y + 1.75, w - 1.5, rh - 3.5, 3); g.stroke(); g.lineWidth = 1; }
    // slide notes end in an arrow, portamento notes start with a ramp
    if (n.slide) { g.fillStyle = TH.noteInk; g.beginPath(); g.moveTo(x + w - 9, y + 3); g.lineTo(x + w - 2, y + rh / 2); g.lineTo(x + w - 9, y + rh - 3); g.fill(); }
    if (n.porta) { g.strokeStyle = TH.noteInk; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x + 2, y + rh - 3); g.lineTo(x + 8, y + 3); g.stroke(); g.lineWidth = 1; }
    if (w > 30) { g.fillStyle = n.mu ? TH.dim : TH.noteInk; g.font = '600 9px ' + TH.mono; g.fillText(noteName(n.m), x + 4, y + rh - 4); }
  },
  drawKeys() {
    if (!WM.isOpen('piano')) return;
    const H = this.sc.clientHeight, W = 58, sy = this.sc.scrollTop, rh = this.rowH;
    if (!H) return;
    const g = fitCanvas(this.kc, W, H), scale = this.scale, hasScale = scale.type !== 'none';
    g.fillStyle = TH.keyWhite;
    g.fillRect(0, 0, W, H);
    const mTop = this.rowToM(sy), mBot = Math.max(this.lo, this.rowToM(sy + H));
    g.font = '600 9px ' + TH.mono;
    for (let m = mTop; m >= mBot; m--) {
      const y = this.mToY(m) - sy;
      if (m === this.pvKey) { g.fillStyle = TH.brass; g.fillRect(0, y, W, rh); }
      if (isBlack(m)) {
        g.fillStyle = m === this.pvKey ? TH.brass : TH.keyBlack;
        g.fillRect(0, y + 1, 36, rh - 2);
      } else {
        const k = ((m % 12) + 12) % 12;
        if (k === 0 || k === 5) { g.fillStyle = TH.keyLine; g.fillRect(0, y + rh - 1, W, 1); }
      }
      const showName = ui.prAllNames || pc(m) === 0;
      if (showName) { g.fillStyle = isBlack(m) ? TH.keyWhite : TH.keyBlack; g.fillText(noteName(m), isBlack(m) ? 3 : W - 26, y + rh - 3); }
      if (hasScale && inScale(m, scale.root, scale.type)) { g.fillStyle = pc(m - scale.root) === 0 ? TH.brass : TH.signal; g.fillRect(W - 4, y + 2, 3, rh - 4); }
    }
    g.fillStyle = TH.line;
    g.fillRect(W - 1, 0, 1, H);
  },
  drawRuler(sx, W, L, pos) {
    const g = fitCanvas(this.rc, W, 22), sw = this.sw;
    g.fillStyle = TH.panel2;
    g.fillRect(0, 0, W, 22);
    g.font = '600 10px ' + TH.mono;
    const bt = beatSteps(), bl = spb(), i0 = Math.floor(sx / sw / bt) * bt, i1 = Math.ceil((sx + W) / sw);
    for (let i = i0; i <= i1; i += bt) {
      const x = Math.round(i * sw - sx);
      if (i % bl === 0) { g.fillStyle = TH.dim; g.fillRect(x, 9, 1, 13); g.fillText(String(i / bl + 1), x + 4, 13); }
      else if (sw * bt >= 10) { g.fillStyle = TH.faint; g.fillRect(x, 16, 1, 6); }
    }
    g.fillStyle = TH.brass;
    const xe = L * sw - sx;
    if (xe >= 0 && xe <= W) { g.beginPath(); g.moveTo(xe, 22); g.lineTo(xe - 6, 12); g.lineTo(xe, 12); g.fill(); }
    if (pos != null) { g.fillStyle = TH.signal; const x = pos * sw - sx; g.beginPath(); g.moveTo(x - 5, 12); g.lineTo(x + 5, 12); g.lineTo(x, 20); g.fill(); }
    g.fillStyle = TH.line;
    g.fillRect(0, 21, W, 1);
  },
  // Event lane: velocity or another note property as stems; pan, fine pitch and mod X/Y grow from their normal value.
  drawLane(sx, W, ch, p) {
    const cell = this.vc.parentElement, H = cell.clientHeight, sw = this.sw, k = this.lane, P = NOTE_PROPS[k];
    const g = fitCanvas(this.vc, W, H), yOf = v => 4 + (1 - (v - P.min) / (P.max - P.min)) * (H - 8);
    g.fillStyle = TH.panel;
    g.fillRect(0, 0, W, H);
    g.fillStyle = TH.lineSoft;
    [0.25, 0.5, 0.75].forEach(f => g.fillRect(0, Math.round(4 + (1 - f) * (H - 8)), W, 1));
    if (!ch) return;
    const base = k === 'v' ? H - 4 : yOf(P.def);
    for (const n of p.notes[ch.id] || []) {
      const x = n.s * sw - sx;
      if (x < -10 || x > W + 10) continue;
      const y = yOf(np(n, k));
      g.fillStyle = this.noteColor(n, ch);
      g.globalAlpha = (this.sel.size && !this.sel.has(n)) || n.mu ? 0.35 : 0.9;
      g.fillRect(Math.round(x), Math.min(y, base), 2, Math.max(1, Math.abs(base - y)));
      g.beginPath();
      g.arc(x + 1, y, 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  },
};

/* ---------- Piano Roll tools menu ---------- */
const PRTools = {
  chords(notes) {
    const groups = new Map();
    for (const n of notes) { const k = Math.round(n.s * 4) / 4; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
    return [...groups.values()].map(g => g.sort((a, b) => a.m - b.m));
  },
  arpeggiate(rate, mode) {
    const notes = PR.target();
    if (!notes.length) return toast(T('Nessuna nota da arpeggiare'));
    const out = [];
    for (const chord of this.chords(notes)) {
      const start = chord[0].s, end = Math.max(...chord.map(n => n.s + n.l));
      let order = chord.map(n => n.m);
      if (mode === 'down') order = order.reverse();
      if (mode === 'updown' && order.length > 2) order = order.concat(order.slice(1, -1).reverse());
      if (mode === 'random') order = order.sort(() => Math.random() - 0.5);
      let i = 0;
      for (let s = start; s < end - 1e-9; s += rate, i++) out.push({ s, l: Math.min(rate, end - s), m: order[i % order.length], v: chord[0].v });
    }
    PR.removeNotes(notes);
    PR.ensureNotes().push(...out);
    PR.sel = new Set(out);
    PR.applied(T('Arpeggio creato: {0} note', out.length));
  },
  strum(amount) {
    const notes = PR.target();
    for (const chord of this.chords(notes)) chord.forEach((n, i) => { const d = i * amount; n.s += d; n.l = Math.max(0.25, n.l - d); });
    PR.applied(T('Strum applicato'));
  },
  flam() {
    const notes = PR.target(), add = notes.map(n => ({ s: Math.max(0, n.s - 0.25), l: 0.25, m: n.m, v: n.v * 0.55 }));
    PR.ensureNotes().push(...add);
    PR.applied(T('Flam aggiunto a {0} note', notes.length));
  },
  chop() {
    const notes = PR.target(), q = ui.prSnap, out = [];
    for (const n of notes) for (let s = n.s; s < n.s + n.l - 1e-9; s += q) out.push({ ...n, s, l: Math.min(q, n.s + n.l - s) });
    PR.removeNotes(notes);
    PR.ensureNotes().push(...out);
    PR.sel = new Set(out);
    PR.applied(T('Note tagliate in {0} pezzi', out.length));
  },
  glue() {
    const notes = PR.target().slice().sort((a, b) => a.m - b.m || a.s - b.s), kill = [];
    for (let i = 1; i < notes.length; i++) {
      const a = notes[i - 1], b = notes[i];
      if (a.m === b.m && Math.abs(a.s + a.l - b.s) < 1e-6 && !kill.includes(a)) { a.l += b.l; kill.push(b); notes[i] = a; }
    }
    PR.removeNotes(kill);
    PR.applied(T('{0} note unite', kill.length));
  },
  legato() {
    const notes = PR.target().slice().sort((a, b) => a.s - b.s), starts = [...new Set(notes.map(n => n.s))];
    for (const n of notes) { const next = starts.find(s => s > n.s + 1e-6); if (next != null) n.l = next - n.s; }
    PR.applied(T('Legato applicato'));
  },
  flip(axis) {
    const notes = PR.target();
    if (!notes.length) return;
    if (axis === 'h') {
      const s0 = Math.min(...notes.map(n => n.s)), s1 = Math.max(...notes.map(n => n.s + n.l));
      notes.forEach(n => { n.s = s0 + (s1 - (n.s + n.l)); });
    } else {
      const lo = Math.min(...notes.map(n => n.m)), hi = Math.max(...notes.map(n => n.m));
      notes.forEach(n => { n.m = hi - (n.m - lo); });
    }
    PR.applied(axis === 'h' ? T('Note capovolte nel tempo') : T('Note capovolte nell’altezza'));
  },
  randomize(what) {
    const notes = PR.target();
    notes.forEach(n => {
      if (what === 'vel') n.v = clamp(n.v + (Math.random() - 0.5) * 0.3, 0.1, 1);
      if (what === 'time') n.s = Math.max(0, n.s + (Math.random() - 0.5) * 0.25);
    });
    PR.applied(what === 'vel' ? T('Dinamica randomizzata') : T('Tempi umanizzati'));
  },
  levels(kind) {
    const notes = PR.target().slice().sort((a, b) => a.s - b.s), n = notes.length;
    notes.forEach((x, i) => { x.v = kind === 'up' ? 0.35 + 0.65 * (i / Math.max(1, n - 1)) : kind === 'down' ? 1 - 0.65 * (i / Math.max(1, n - 1)) : 0.8; });
    PR.applied(kind === 'up' ? T('Crescendo') : kind === 'down' ? T('Diminuendo') : T('Dinamica uniforme'));
  },
  limitToScale() {
    const sc = PR.scale;
    if (sc.type === 'none') return toast(T('Scegli prima una scala nel Piano Roll'));
    PR.target().forEach(n => { n.m = snapToScale(n.m, sc.root, sc.type); });
    PR.applied(T('Note limitate alla scala {0} {1}', NOTE_NAMES[sc.root], inSentence(T(SCALES[sc.type].label))));
  },
  octave(d) { PR.target().forEach(n => { n.m = clamp(n.m + d, PR.lo, PR.hi - 1); }); PR.applied(d > 0 ? T('Un’ottava sopra') : T('Un’ottava sotto')); },
  riff(kind) {
    const ch = chById(ui.selCh);
    if (!ch) return toast(T('Seleziona un canale'));
    const sc = PR.scale, type = sc.type === 'none' ? 'minor' : sc.type, p = curPat();
    const L = Math.max(16, p.len);
    const notes = kind === 'bass'
      ? bassLine(Array.from({ length: Math.ceil(L / spb()) }, (_, i) => ({ root: 12 * 3 + sc.root + (SCALES[type].steps || [0])[[0, 5, 3, 4][i % 4] % (SCALES[type].steps || [0]).length] })), { style: 'house', octave: 2 })
      : riffMachine({ steps: L, root: sc.root, type, base: 72, density: 0.6 });
    p.notes[ch.id] = notes;
    PR.sel = new Set(notes);
    PR.applied(T('Riff Machine: {0} note in {1} {2}', notes.length, NOTE_NAMES[sc.root], inSentence(T(SCALES[type].label))));
  },
};

Object.assign(PRTools, {
  // Articulation: shorter notes, notes that fill their grid cell, or accents on the beats.
  articulate(kind) {
    const notes = PR.target(), q = ui.prSnap;
    if (!notes.length) return toast(T('Nessuna nota'));
    notes.forEach(n => {
      if (kind === 'staccato') n.l = Math.max(0.25, n.l * 0.5);
      if (kind === 'tenuto') n.l = Math.max(q, Math.ceil(n.l / q - 1e-9) * q);
      if (kind === 'accent') { const b = barAt(n.s, false), onBeat = Math.abs((n.s - b.barStart) % b.beatLen) < 1e-6; n.v = clamp(onBeat ? Math.max(n.v, 0.8) * 1.15 : n.v * 0.75, 0.05, 1); }
    });
    PR.applied({ staccato: T('Staccato'), tenuto: T('Tenuto'), accent: T('Accenti sui battiti') }[kind]);
  },
  // LFO on the event lane shown: one shape repeated every `period` steps across the notes.
  lfo(shape, period) {
    const notes = PR.target(), k = PR.lane, P = NOTE_PROPS[k], lo = k === 'v' ? 0.3 : P.min, hi = k === 'v' ? 1 : P.max;
    if (!notes.length) return toast(T('Nessuna nota'));
    notes.forEach(n => {
      const ph = ((n.s / period) % 1 + 1) % 1;
      const w = shape === 'sine' ? 0.5 + 0.5 * Math.sin(2 * Math.PI * ph) : shape === 'tri' ? 1 - Math.abs(2 * ph - 1) : shape === 'saw' ? ph : ph < 0.5 ? 1 : 0;
      setNoteProp(n, k, lo + w * (hi - lo));
    });
    PR.applied(T('LFO su {0}', inSentence(T(P.label))));
  },
  // Interpolate: the lane values go in a straight line from the first note to the last.
  interpolate() {
    const notes = PR.target().slice().sort((a, b) => a.s - b.s), k = PR.lane;
    if (notes.length < 3) return toast(T('Servono almeno tre note (selezionale)'));
    const a = notes[0], b = notes[notes.length - 1], va = np(a, k), vb = np(b, k), span = b.s - a.s || 1;
    notes.forEach(n => setNoteProp(n, k, va + (vb - va) * (n.s - a.s) / span));
    PR.applied(T('{0} interpolata su {1} note', T(NOTE_PROPS[k].label), notes.length));
  },
  // Claw machine: keep or remove one group of notes (a chord counts once) in every `every`, in time order.
  claw(keep, every, offset = 0) {
    const groups = this.chords(PR.target()).sort((a, b) => a[0].s - b[0].s), kill = [];
    groups.forEach((g, i) => { const hit = (i - offset) % every === 0 && i >= offset; if (keep ? !hit : hit) kill.push(...g); });
    PR.removeNotes(kill);
    PR.applied(T('Claw machine: {0} note tolte', kill.length));
  },
  // Quick chop: every note cut into equal parts.
  quickChop(parts) {
    const notes = PR.target(), out = [];
    for (const n of notes) { const l = n.l / parts; for (let i = 0; i < parts; i++) out.push({ ...n, s: n.s + i * l, l }); }
    PR.removeNotes(notes);
    PR.ensureNotes().push(...out);
    PR.sel = new Set(out);
    PR.applied(T('Taglio rapido: {0} note', out.length));
  },
});

/* ---------- Note properties ---------- */
function setNoteProp(n, k, v) {
  const P = NOTE_PROPS[k];
  v = clamp(v, k === 'v' ? 0.02 : P.min, P.max);
  if (k === 'v') n.v = Math.round(v * 1000) / 1000;
  else if (Math.abs(v - P.def) < 0.006) delete n[k];
  else n[k] = Math.round(v * 1000) / 1000;
}
function fmtNoteProp(k, v) {
  if (k === 'pan') return Math.abs(v) < 0.01 ? T('centro') : (v < 0 ? T('S {0}%', Math.round(Math.abs(v) * 100)) : T('D {0}%', Math.round(Math.abs(v) * 100)));
  if (k === 'fine') return (v > 0 ? '+' : '') + Math.round(v * 100) + ' cent';
  return Math.round(v * 100) + '%';
}
function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Note properties: velocity, release, pan, fine pitch, mod X/Y, colour, slide and portamento of a note
// (of every selected note, when the note is part of the selection).
let notePropsEl = null;
function closeNoteProps() {
  if (!notePropsEl) return;
  notePropsEl.remove();
  notePropsEl = null;
  document.removeEventListener('pointerdown', notePropsOutside, true);
  commit();
  afterNotesChanged('piano');
}
function notePropsOutside(e) { if (notePropsEl && !notePropsEl.contains(e.target)) closeNoteProps(); }
function openNoteProps(n, x, y) {
  closeNoteProps();
  const ch = chById(ui.selCh), list = PR.sel.has(n) ? [...PR.sel] : [n];
  const box = h('div', 'note-props');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', T('Proprietà della nota'));
  const b = barAt(n.s, false);
  box.appendChild(h('div', 'np-title', noteName(n.m) + ' · ' + T('battuta {0}', b.bar + '.' + b.beat) + (list.length > 1 ? ' · ' + T('{0} note', list.length) : '')));
  for (const [k] of PR_LANES) {
    const P = NOTE_PROPS[k], row = h('label', 'np-row'), val = h('span', 'np-val', fmtNoteProp(k, np(n, k)));
    const inp = h('input');
    inp.type = 'range'; inp.min = k === 'v' ? 0.02 : P.min; inp.max = P.max; inp.step = 0.01; inp.value = np(n, k);
    inp.addEventListener('input', () => { list.forEach(o => setNoteProp(o, k, +inp.value)); val.textContent = fmtNoteProp(k, +inp.value); PR.draw(); });
    inp.addEventListener('dblclick', () => { inp.value = P.def; inp.dispatchEvent(new Event('input')); });
    row.append(h('span', 'np-lbl', T(P.label)), inp, val);
    box.appendChild(row);
  }
  const cols = h('div', 'np-colors');
  NOTE_COLORS.forEach((c, i) => {
    const sw = h('button', 'np-swatch' + ((n.col | 0) === i ? ' on' : ''));
    sw.type = 'button';
    sw.style.background = i ? c : ch.color;
    sw.title = T('Colore {0} (canale MIDI {0})', i + 1);
    sw.addEventListener('click', () => { list.forEach(o => { if (i) o.col = i; else delete o.col; }); cols.querySelectorAll('.np-swatch').forEach(x => x.classList.toggle('on', x === sw)); PR.draw(); });
    cols.appendChild(sw);
  });
  box.appendChild(cols);
  const flags = h('div', 'np-flags');
  [['slide', T('Slide')], ['porta', T('Porta')]].forEach(([k, l]) => {
    const lab = h('label', 'np-flag'), cb = h('input');
    cb.type = 'checkbox'; cb.checked = !!n[k];
    cb.addEventListener('change', () => { list.forEach(o => { if (cb.checked) o[k] = true; else delete o[k]; if (cb.checked) delete o[k === 'slide' ? 'porta' : 'slide']; }); PR.draw(); });
    lab.append(cb, document.createTextNode(' ' + l));
    flags.appendChild(lab);
  });
  const reset = h('button', 'tbtn small', T('Valori normali'));
  reset.type = 'button';
  reset.addEventListener('click', () => { list.forEach(o => { ['rel', 'pan', 'fine', 'mx', 'my'].forEach(k => delete o[k]); }); closeNoteProps(); });
  flags.appendChild(reset);
  box.appendChild(flags);
  box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || e.key === 'Enter') closeNoteProps(); });
  notePropsEl = box;
  placeMenu(box, x + 8, y + 8);
  setTimeout(() => document.addEventListener('pointerdown', notePropsOutside, true));
}
function noteColorMenu() {
  const ch = chById(ui.selCh);
  return [
    { title: T('Colore delle nuove note') },
    ...NOTE_COLORS.map((c, i) => ({ label: (i ? T('Colore {0}', i + 1) : T('Colore del canale')) + ' · MIDI ' + (i + 1), color: i ? c : (ch ? ch.color : c), checked: PR.color === i, action: () => { PR.color = i; PR.refreshToolbar(); } })),
    '-',
    { label: T('Colora le note selezionate'), disabled: !PR.sel.size, action: () => { PR.sel.forEach(n => { if (PR.color) n.col = PR.color; else delete n.col; }); PR.applied(T('Colore applicato')); } },
    { label: T('Seleziona le note di questo colore'), action: () => { PR.sel = new Set(PR.notes().filter(n => (n.col | 0) === PR.color)); PR.draw(); } },
  ];
}

function prToolsMenu() {
  const t = PRTools, lane = inSentence(T(NOTE_PROPS[PR.lane].label));
  return [
    { title: T('Tempo') },
    { label: T('Quantizza inizi'), action: () => PR.quantize(false) },
    { label: T('Quantizza inizi e durate'), action: () => PR.quantize(true) },
    { label: T('Legato'), action: () => t.legato() },
    { label: T('Taglia sulla griglia (Chop)'), action: () => t.chop() },
    { label: T('Taglio rapido'), sub: [2, 3, 4, 8].map(k => ({ label: T('In {0} parti', k), action: () => t.quickChop(k) })) },
    { label: T('Unisci note (Glue)'), action: () => t.glue() },
    { label: T('Umanizza i tempi'), action: () => t.randomize('time') },
    { label: T('Articolazione'), sub: [
      { label: T('Staccato (metà durata)'), action: () => t.articulate('staccato') },
      { label: T('Tenuto (riempie la griglia)'), action: () => t.articulate('tenuto') },
      { label: T('Accenti sui battiti'), action: () => t.articulate('accent') },
    ] },
    { label: T('Claw machine'), sub: [
      { label: T('Tieni 1 nota su 2'), action: () => t.claw(true, 2) },
      { label: T('Tieni 1 nota su 3'), action: () => t.claw(true, 3) },
      { label: T('Tieni 1 nota su 4'), action: () => t.claw(true, 4) },
      { label: T('Togli 1 nota su 2'), action: () => t.claw(false, 2, 1) },
      { label: T('Togli 1 nota su 3'), action: () => t.claw(false, 3, 2) },
      { label: T('Togli 1 nota su 4'), action: () => t.claw(false, 4, 3) },
    ] },
    { title: T('Corsia degli eventi: {0}', lane) },
    { label: 'LFO', sub: [
      { label: T('Sinusoide su 1 battuta'), action: () => t.lfo('sine', spb()) },
      { label: T('Sinusoide su 1 battito'), action: () => t.lfo('sine', beatSteps()) },
      { label: T('Triangolo su 2 battute'), action: () => t.lfo('tri', 2 * spb()) },
      { label: T('Dente di sega su 1 battuta'), action: () => t.lfo('saw', spb()) },
      { label: T('Quadra su 1 battito'), action: () => t.lfo('square', beatSteps()) },
    ] },
    { label: T('Interpola dalla prima all\'ultima nota'), action: () => t.interpolate() },
    { label: T('Proprietà delle note selezionate…'), disabled: !PR.sel.size, action: () => { const n = [...PR.sel][0], r = PR.cv.getBoundingClientRect(); openNoteProps(n, r.left + n.s * PR.sw - PR.sc.scrollLeft, r.top + PR.mToY(n.m) - PR.sc.scrollTop); } },
    { label: T('Colore delle note'), sub: noteColorMenu() },
    { title: T('Accordi') },
    { label: T('Arpeggio su 1/16 in salita'), action: () => t.arpeggiate(1, 'up') },
    { label: T('Arpeggio su 1/16 in discesa'), action: () => t.arpeggiate(1, 'down') },
    { label: T('Arpeggio su 1/8 su e giù'), action: () => t.arpeggiate(2, 'updown') },
    { label: T('Arpeggio su 1/32 casuale'), action: () => t.arpeggiate(0.5, 'random') },
    { label: T('Strum leggero'), action: () => t.strum(0.25) },
    { label: T('Strum ampio'), action: () => t.strum(0.5) },
    { label: T('Flam'), action: () => t.flam() },
    { label: T('Chord Progression Tool…'), action: () => ChordTool.open() },
    { title: T('Altezza e dinamica') },
    { label: T('Limita alla scala'), action: () => t.limitToScale() },
    { label: T('Un’ottava sopra'), action: () => t.octave(12) },
    { label: T('Un’ottava sotto'), action: () => t.octave(-12) },
    { label: T('Capovolgi nel tempo'), action: () => t.flip('h') },
    { label: T('Capovolgi nell’altezza'), action: () => t.flip('v') },
    { label: T('Randomizza la dinamica'), action: () => t.randomize('vel') },
    { label: T('Crescendo'), action: () => t.levels('up') },
    { label: T('Diminuendo'), action: () => t.levels('down') },
    { title: T('Genera') },
    { label: T('Riff Machine: melodia'), action: () => t.riff('melody') },
    { label: T('Riff Machine: linea di basso'), action: () => t.riff('bass') },
    '-',
    { label: T('Metro del progetto: {0}', proj.ts.num + '/' + proj.ts.den), sub: metreMenuItems() },
    { label: T('Allinea alla scala le note suonate dal vivo'), checked: !!ui.snapLive, action: () => { ui.snapLive = !ui.snapLive; savePrefs(); hint(ui.snapLive ? T('Tastiera e MIDI suonano solo note della scala del Piano Roll') : T('Tastiera e MIDI suonano tutte le note')); } },
    { label: T('Nomi di tutte le note sui tasti'), checked: !!ui.prAllNames, action: () => { ui.prAllNames = !ui.prAllNames; PR.drawKeys(); } },
  ];
}
