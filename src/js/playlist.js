'use strict';
/* Ritmo Studio — Playlist: arrange pattern, audio and automation clips on tracks along the song timeline */

const PL_TOOLS = {
  draw: T('Disegna: clic per inserire, trascina per spostare, Ctrl+trascina duplica, bordo sinistro o destro per accorciare'),
  paint: T('Pennello: trascina sulla traccia per dipingere clip una dopo l\'altra'),
  delete: T('Cancella: clic o trascina sulle clip'),
  mute: T('Muta: clic sulle clip per silenziarle'),
  slip: T('Slip: trascina dentro una clip per far scorrere il contenuto senza spostarla'),
  slice: T('Taglia: clic su una clip per dividerla sulla griglia'),
  select: T('Seleziona: trascina un riquadro, Maiusc aggiunge; poi trascina le clip selezionate o usa Canc'),
  zoom: T('Zoom: trascina sul tratto da ingrandire, clic ingrandisce, clic destro riduce'),
  play: T('Ascolta: tieni premuto sulla griglia per suonare da quel punto'),
};
const RULER_H = 32, MARK_H = 13;

const PL = {
  th: 48, sel: new Set(), drag: null, tool: 'draw', rulerDrag: null, rows: [], totalH: 0,
  get sw() { return 4 * ui.plZoom; }, // pixels per step: a 4/4 bar is 64 px at zoom 1
  init() {
    this.sc = $('#pl-scroll'); this.sizer = $('#pl-sizer'); this.cv = $('#pl-canvas');
    this.rc = $('#pl-ruler'); this.heads = $('#pl-heads-inner');
    this.sc.addEventListener('scroll', () => { this.heads.style.transform = `translateY(${-this.sc.scrollTop}px)`; this.draw(); });
    new ResizeObserver(() => this.draw()).observe(this.sc);
    this.cv.addEventListener('pointerdown', e => this.down(e));
    this.cv.addEventListener('pointermove', e => this.move(e));
    this.cv.addEventListener('pointerup', e => this.up(e));
    this.cv.addEventListener('pointercancel', e => this.up(e));
    this.cv.addEventListener('contextmenu', e => e.preventDefault());
    this.cv.addEventListener('dblclick', e => {
      const { x, y } = this.pt(e), hit = this.hit(x, y);
      if (!hit) return;
      if (hit.c.a) AutoEditor.open(hit.c.a);
      else if (hit.c.smp) this.clipMenu(hit.c, e.clientX, e.clientY);
      else { selectPattern(hit.c.p); WM.open('piano'); }
    });
    this.sc.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX);
    }, { passive: false });
    this.initRuler();
    $$('[data-pltool]').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.pltool)));
    this.initHeads();
    $('#pl-snap').addEventListener('change', e => { ui.plSnap = +e.target.value; savePrefs(); });
    $('#pl-arr').addEventListener('click', e => arrangementMenu(e.currentTarget));
    const pats = $('#pl-pats');
    pats.addEventListener('click', e => {
      const b = e.target.closest('.pl-pat');
      if (!b) return;
      if (b.dataset.kind === 'pat') { ui.plPick = null; selectPattern(b.dataset.id); }
      else { ui.plPick = { kind: b.dataset.kind, id: b.dataset.id }; this.renderPatterns(); hint(T('Clic sulla griglia per inserire {0}', b.title.split(' —')[0])); }
    });
    pats.addEventListener('dblclick', e => {
      const b = e.target.closest('.pl-pat');
      if (!b) return;
      if (b.dataset.kind === 'pat') renamePattern(patById(b.dataset.id));
      else if (b.dataset.kind === 'auto') AutoEditor.open(b.dataset.id);
    });
    pats.addEventListener('contextmenu', e => {
      const b = e.target.closest('.pl-pat');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.kind === 'pat') patternMenu(patById(b.dataset.id), e.clientX, e.clientY);
      else if (b.dataset.kind === 'auto') { const a = Automation.byId(b.dataset.id); openMenu(e.clientX, e.clientY, [{ title: a.name }, { label: T('Modifica la curva'), action: () => AutoEditor.open(a.id) }, { label: T('Elimina'), danger: true, action: () => deleteAutomation(a) }]); }
    });
    $('#pl-zoom-in').addEventListener('click', () => this.zoom(1.25));
    $('#pl-zoom-out').addEventListener('click', () => this.zoom(0.8));
  },
  setTool(t) {
    this.tool = t;
    $$('[data-pltool]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.pltool === t)));
    hint(PL_TOOLS[t]);
    this.cv.style.cursor = '';
  },

  /* ---------- tracks: variable heights, colours and groups ---------- */
  // A group is a track followed by tracks marked "sub"; collapsing the header hides them.
  layout() {
    const tracks = proj.playlist.tracks, rows = [];
    let y = 0, hide = false;
    tracks.forEach((t, i) => {
      if (!t.sub) hide = !!t.collapsed;
      const h = t.sub && hide ? 0 : (t.h || this.th);
      rows.push({ i, y, h });
      y += h;
    });
    this.rows = rows;
    this.totalH = y;
    return rows;
  },
  rowAt(y) {
    const rows = this.rows.length === proj.playlist.tracks.length ? this.rows : this.layout();
    for (const r of rows) if (r.h && y >= r.y && y < r.y + r.h) return r.i;
    if (y < 0) return 0;
    for (let k = rows.length - 1; k >= 0; k--) if (rows[k].h) return rows[k].i;
    return 0;
  },
  row(i) { if (this.rows.length !== proj.playlist.tracks.length) this.layout(); return this.rows[i] || { i, y: 0, h: 0 }; },
  isHeader: i => { const tr = proj.playlist.tracks; return !!(tr[i] && !tr[i].sub && tr[i + 1] && tr[i + 1].sub); },
  initHeads() {
    this.heads.addEventListener('click', e => {
      const row = e.target.closest('.pl-head');
      if (!row) return;
      const i = +row.dataset.t, t = proj.playlist.tracks[i];
      if (e.target.closest('.ch-led')) { t.mute = !t.mute; commit(); this.renderHeads(); this.draw(); }
      else if (e.target.closest('.pl-fold')) { t.collapsed = !t.collapsed; commit(); this.renderHeads(); this.draw(); }
    });
    this.heads.addEventListener('dblclick', e => {
      const nm = e.target.closest('.nm');
      if (!nm) return;
      const t = proj.playlist.tracks[+nm.closest('.pl-head').dataset.t];
      inlineEdit(nm, t.name, v => { t.name = v; commit(); this.renderHeads(); });
    });
    this.heads.addEventListener('contextmenu', e => {
      const row = e.target.closest('.pl-head');
      if (!row) return;
      e.preventDefault();
      this.trackMenu(+row.dataset.t, e.clientX, e.clientY);
    });
    // drag the bottom edge of a track header to change its height
    this.heads.addEventListener('pointerdown', e => {
      const grip = e.target.closest('.pl-grip');
      if (!grip) return;
      e.preventDefault();
      const i = +grip.closest('.pl-head').dataset.t, t = proj.playlist.tracks[i], y0 = e.clientY, h0 = t.h || this.th;
      grip.setPointerCapture(e.pointerId);
      const mv = ev => { t.h = clamp(Math.round(h0 + ev.clientY - y0), 24, 160); this.renderHeads(); this.draw(); };
      const end = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end); commit(); };
      grip.addEventListener('pointermove', mv);
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
    });
  },
  trackMenu(i, x, y) {
    const tracks = proj.playlist.tracks, t = tracks[i], hdr = this.isHeader(i);
    const heights = [[32, T('Piccola')], [48, T('Normale')], [72, T('Grande')], [110, T('Molto grande')]];
    openMenu(x, y, [
      { title: t.name },
      { label: T('Rinomina'), action: () => { const nm = $(`.pl-head[data-t="${i}"] .nm`); if (nm) inlineEdit(nm, t.name, v => { t.name = v; commit(); this.renderHeads(); }); } },
      { label: T('Colore'), sub: [{ label: T('Nessuno'), checked: !t.color, action: () => { delete t.color; commit(); this.renderHeads(); this.draw(); } },
        ...[...COLORS, ...NOTE_COLORS.slice(0, 8)].map(c => ({ label: c, color: c, checked: t.color === c, action: () => { t.color = c; commit(); this.renderHeads(); this.draw(); } }))] },
      { label: T('Altezza'), sub: heights.map(([hh, l]) => ({ label: l, checked: (t.h || this.th) === hh, action: () => { t.h = hh; commit(); this.renderHeads(); this.draw(); } })) },
      { label: t.mute ? T('Riattiva la traccia') : T('Muta la traccia'), action: () => { t.mute = !t.mute; commit(); this.renderHeads(); this.draw(); } },
      '-',
      { label: t.sub ? T('Togli dal gruppo') : T('Raggruppa con la traccia sopra'), disabled: i === 0, action: () => { t.sub = !t.sub; commit(); this.renderHeads(); this.draw(); } },
      hdr ? { label: t.collapsed ? T('Espandi il gruppo') : T('Comprimi il gruppo'), action: () => { t.collapsed = !t.collapsed; commit(); this.renderHeads(); this.draw(); } } : null,
      { label: T('Seleziona le clip della traccia'), action: () => { this.select(proj.playlist.clips.filter(c => c.t === i)); this.draw(); } },
      '-',
      { label: T('Inserisci una traccia sopra'), action: () => this.insertTrack(i) },
      { label: T('Elimina la traccia e le sue clip'), danger: true, disabled: tracks.length <= 1, action: () => this.deleteTrack(i) },
    ].filter(Boolean));
  },
  insertTrack(i) {
    proj.playlist.tracks.splice(i, 0, { name: T('Traccia {0}', proj.playlist.tracks.length + 1), mute: false });
    proj.playlist.clips.forEach(c => { if (c.t >= i) c.t++; });
    commit(); this.renderHeads(); this.draw();
  },
  deleteTrack(i) {
    proj.playlist.clips = proj.playlist.clips.filter(c => c.t !== i);
    proj.playlist.clips.forEach(c => { if (c.t > i) c.t--; });
    proj.playlist.tracks.splice(i, 1);
    if (proj.playlist.tracks[0]) proj.playlist.tracks[0].sub = false;
    this.sel.clear();
    commit(); this.renderHeads(); this.draw();
  },
  renderHeads() {
    this.heads.textContent = '';
    const rows = this.layout();
    proj.playlist.tracks.forEach((t, i) => {
      const r = rows[i], muted = trackMuted(i);
      const row = h('div', 'pl-head' + (muted ? ' muted' : '') + (t.sub ? ' sub' : '') + (this.isHeader(i) ? ' group' : ''));
      row.dataset.t = i;
      row.style.height = r.h + 'px';
      if (!r.h) row.hidden = true;
      if (t.color) row.style.setProperty('--tc', t.color);
      const top = h('div', 'pl-head-top');
      if (this.isHeader(i)) {
        const fold = h('button', 'pl-fold', t.collapsed ? '▸' : '▾');
        fold.type = 'button';
        fold.title = t.collapsed ? T('Espandi il gruppo') : T('Comprimi il gruppo');
        top.appendChild(fold);
      }
      const nm = h('span', 'nm', t.name);
      nm.title = T('Doppio clic per rinominare, clic destro per il menu della traccia');
      top.appendChild(nm);
      const led = h('button', 'ch-led' + (t.mute ? '' : ' on'));
      led.type = 'button';
      led.title = t.mute ? T('Traccia muta') : T('Traccia attiva');
      led.setAttribute('aria-label', T('Attiva {0}', t.name));
      led.setAttribute('aria-pressed', String(!t.mute));
      const grip = h('div', 'pl-grip');
      grip.title = T('Trascina per cambiare l\'altezza');
      row.append(top, led, grip);
      this.heads.appendChild(row);
    });
    $('#pl-snap').value = String(ui.plSnap);
    $('#pl-pat-name').textContent = curPat().name;
    this.renderTitle();
    this.renderPatterns();
  },
  renderTitle() {
    const a = curArrangement();
    $('#pl-arr').textContent = (a ? a.name : T('Arrangiamento')) + ' ▾';
  },

  /* ---------- picker column: patterns, audio clips and automation clips ---------- */
  pick() {
    const k = ui.plPick;
    if (k && k.kind === 'auto' && Automation.byId(k.id)) return k;
    if (k && k.kind === 'smp' && SAMPLES[k.id]) return k;
    return { kind: 'pat', id: curPat().id };
  },
  renderPatterns() {
    const box = $('#pl-pats'), pick = this.pick();
    box.textContent = '';
    const item = (kind, id, color, name, title) => {
      const b = h('button', 'pl-pat' + (pick.kind === kind && pick.id === id ? ' sel' : ''));
      b.type = 'button';
      b.dataset.id = id;
      b.dataset.kind = kind;
      const dot = h('span', 'pdot');
      dot.style.background = color;
      if (kind !== 'pat') dot.style.borderRadius = kind === 'auto' ? '50%' : '0';
      b.append(dot, h('span', 'nm', name));
      b.title = title;
      box.appendChild(b);
    };
    proj.patterns.forEach(p => item('pat', p.id, p.color, p.name, p.name + ' — ' + T('clic: seleziona, doppio clic: rinomina, clic destro: menu')));
    const audio = [...new Set(proj.playlist.clips.filter(c => c.smp).map(c => c.smp))].filter(id => SAMPLES[id]);
    audio.forEach(id => item('smp', id, '#7fb9d9', SAMPLES[id].name, SAMPLES[id].name + ' — ' + T('clip audio: clic e poi clic sulla griglia')));
    proj.automation.forEach(a => item('auto', a.id, a.color, a.name, a.name + ' — ' + T('clip di automazione: doppio clic per la curva')));
  },
  stepSec() { return 60 / proj.bpm / 4; },

  /* ---------- audio clips ---------- */
  async dropAudio(files, e) {
    const { x, y } = this.pt(e);
    let t = this.rowAt(y);
    const s = this.snap(Math.max(0, x / this.sw));
    for (const f of files) {
      try {
        const id = await addSampleFromFile(f);
        this.addAudioClip(id, t, s);
        t = Math.min(t + 1, proj.playlist.tracks.length - 1);
      } catch (err) { toast(T('Impossibile leggere {0}: formato audio non supportato', f.name)); }
    }
    commit();
    this.renderPatterns();
    this.draw();
    Tree.render();
  },
  addAudioClip(id, t, s) {
    const smp = SAMPLES[id], l = Math.max(1, Math.ceil(smp.buffer.duration / this.stepSec()));
    const mx = freeInsert() || 0;
    if (mx) proj.mixer[mx].name = smp.name.replace(/\.[^.]+$/, '').slice(0, 24);
    const c = { id: uid(), smp: id, t, s, l, mx, gain: 1 };
    proj.playlist.clips.push(c);
    ui.plPick = { kind: 'smp', id };
    if (ui.mode !== 'song') setMode('song');
    hint(T('Clip audio “{0}” → {1}', smp.name, mixerName(mx)));
    return c;
  },
  // Menu of a clip, opened from the icon at its top-left corner or by double clicking an audio clip.
  clipMenu(c, x, y) {
    if (!this.sel.has(c)) this.select([c]);
    const many = [...this.sel], set = (fn, msg) => () => { fn(); commit(); this.draw(); if (msg) hint(msg); };
    const common = [
      '-',
      { label: c.mu ? T('Riattiva') : T('Muta'), action: set(() => { many.forEach(k => { if (c.mu) delete k.mu; else k.mu = true; }); }) },
      { label: many.length > 1 ? T('Consolida le {0} clip in audio', many.length) : T('Renderizza e sostituisci con audio'), disabled: !!c.a, action: () => consolidateClips(many) },
      { label: T('Elimina'), danger: true, action: () => { many.forEach(k => this.removeClip(k)); commit(); this.draw(); } },
    ];
    if (c.a) {
      const a = Automation.byId(c.a);
      openMenu(x, y, [{ title: a ? a.name : T('Automazione') }, { label: T('Modifica la curva'), action: () => AutoEditor.open(c.a) }, ...common]);
      return;
    }
    if (c.p) {
      const p = patById(c.p);
      openMenu(x, y, [
        { title: p.name },
        { label: T('Apri nel Piano Roll'), action: () => { selectPattern(p.id); WM.open('piano'); } },
        { label: T('Rinomina il pattern'), action: () => renamePattern(p) },
        { label: T('Rendi unico'), action: () => makeUnique(c) },
        { label: T('Unisci le clip selezionate'), disabled: many.filter(k => k.p).length < 2, action: () => mergePatternClips(many) },
        { label: T('Seleziona tutte le clip di questo pattern'), action: () => { this.select(proj.playlist.clips.filter(k => k.p === c.p)); this.draw(); } },
        { label: T('Renderizza il pattern in una nuova clip audio'), action: () => renderPatternToClip(p) },
        ...common,
      ]);
      return;
    }
    const smp = SAMPLES[c.smp], fades = [0, 0.5, 1, 2, 4, 8, 16];
    const fadeLabel = v => (v ? (v === 1 ? T('{0} passo', v) : T('{0} passi', v)) : T('Nessuna'));
    const ov = nextOverlap(c);
    openMenu(x, y, [
      { title: smp ? smp.name : T('Clip audio') },
      { label: T('Traccia del mixer: {0}', mixerName(c.mx | 0)), sub: [0, ...Array.from({ length: Math.min(numInserts(), 40) }, (_, i) => i + 1)].map(i => ({ label: mixerName(i), checked: (c.mx | 0) === i, action: set(() => { c.mx = i; }) })) },
      { label: T('Volume della clip'), sub: [2, 1.5, 1.25, 1, 0.75, 0.5, 0.25].map(g => ({ label: (g >= 1 ? '+' : '') + Math.round(20 * Math.log10(g) * 10) / 10 + ' dB', checked: Math.abs((c.gain ?? 1) - g) < 0.01, action: set(() => { c.gain = g; }) })) },
      { label: T('Dissolvenza in entrata: {0}', fadeLabel(c.fin || 0)), sub: fades.map(v => ({ label: fadeLabel(v), checked: (c.fin || 0) === v, action: set(() => { c.fin = Math.min(v, c.l); }) })) },
      { label: T('Dissolvenza in uscita: {0}', fadeLabel(c.fout || 0)), sub: fades.map(v => ({ label: fadeLabel(v), checked: (c.fout || 0) === v, action: set(() => { c.fout = Math.min(v, c.l); }) })) },
      { label: T('Dissolvenza incrociata con la clip successiva'), disabled: !ov, action: () => crossfadeNext(c) },
      '-',
      { label: T('Intonazione: {0} st', (c.pitch > 0 ? '+' : '') + (c.pitch || 0)), sub: [12, 7, 5, 3, 2, 1, 0, -1, -2, -3, -5, -7, -12].map(v => ({ label: T('{0} semitoni', (v > 0 ? '+' : '') + v), checked: (c.pitch || 0) === v, action: set(() => { c.pitch = v; }, T('Intonazione della clip: {0} semitoni (la durata resta uguale)', v)) })) },
      { label: T('Al contrario'), checked: !!c.rev, action: set(() => { c.rev = !c.rev; }) },
      { label: T('Time-stretch: {0}', c.stretch && c.stretch !== 1 ? '×' + (+c.stretch).toFixed(2) : T('spento')), sub: [
        { label: T('Adatta al tempo del progetto'), action: () => fitToTempo(c) },
        '-',
        ...[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => ({ label: v === 1 ? T('Spento (durata originale)') : T('×{0} della durata', v), checked: (c.stretch || 1) === v, action: set(() => { c.stretch = v === 1 ? 0 : v; c.l = clipSteps(c) - (c.o || 0); }) })),
      ] },
      { label: T('Adatta la lunghezza al file'), action: set(() => { c.l = Math.max(1, clipSteps(c) - (c.o || 0)); }) },
      ...common,
    ]);
  },

  /* ---------- geometry ---------- */
  pt(e) { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left + this.sc.scrollLeft, y: e.clientY - r.top + this.sc.scrollTop }; },
  // Snap a position to the playlist grid: bar or beat of the metre in force there, or step.
  snap(s, round) {
    const q = ui.plSnap;
    s = Math.max(0, s);
    if (q >= 4) {
      const b = barAt(s), unit = q >= 16 ? b.barLen : b.beatLen, k = (s - b.barStart) / unit;
      return Math.max(0, b.barStart + (round ? Math.round(k) : Math.floor(k + 1e-9)) * unit);
    }
    return round ? Math.round(s) : Math.floor(s);
  },
  zoom(f, clientX) {
    const old = this.sw, r = this.sc.getBoundingClientRect();
    const vx = clientX != null ? clientX - r.left : this.sc.clientWidth / 2;
    const cx = (this.sc.scrollLeft + vx) / old;
    ui.plZoom = clamp(ui.plZoom * f, 0.1, 8);
    savePrefs();
    this.draw();
    this.sc.scrollLeft = Math.max(0, cx * this.sw - vx);
    this.draw();
  },
  zoomTo(a, b) {
    const W = this.sc.clientWidth;
    ui.plZoom = clamp(W / Math.max(1, b - a) / 4, 0.1, 8);
    savePrefs();
    this.draw();
    this.sc.scrollLeft = Math.max(0, a * this.sw);
    this.draw();
  },
  clipBox(c) { const r = this.row(c.t); return { x0: c.s * this.sw, x1: (c.s + c.l) * this.sw, y0: r.y + 2, y1: r.y + r.h - 2, h: r.h }; },
  // What is under the pointer: the clip, and which part of it (menu icon, left/right edge, fade handles).
  hit(x, y) {
    const t = this.rowAt(y), clips = proj.playlist.clips;
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i];
      if (c.t !== t) continue;
      const b = this.clipBox(c);
      if (!b.h || x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      const w = b.x1 - b.x0, grab = Math.min(8, w / 4);
      let part = 'body';
      if (y < b.y0 + 14 && x < b.x0 + 14 && w > 24) part = 'menu';
      else if (c.smp && y >= b.y0 + 14 && y < b.y0 + 24 && w > 30) {
        const fi = b.x0 + (c.fin || 0) * this.sw, fo = b.x1 - (c.fout || 0) * this.sw;
        if (Math.abs(x - fi) < 6) part = 'fin';
        else if (Math.abs(x - fo) < 6) part = 'fout';
      }
      if (part === 'body') { if (x >= b.x1 - grab) part = 'right'; else if (x <= b.x0 + grab) part = 'left'; }
      return { c, part, edge: part === 'right' };
    }
    return null;
  },
  select(list) { this.sel = new Set(list); },
  removeClip(c) {
    proj.playlist.clips = proj.playlist.clips.filter(k => k !== c);
    this.sel.delete(c);
  },
  newClipAt(t, s) {
    const pick = this.pick();
    let c;
    if (pick.kind === 'auto') { const a = Automation.byId(pick.id); c = { id: uid(), a: a.id, t, s, l: a.len }; proj.playlist.clips.push(c); }
    else if (pick.kind === 'smp') c = this.addAudioClip(pick.id, t, s);
    else { const p = curPat(); c = { id: uid(), p: p.id, t, s, l: patLen(p) }; proj.playlist.clips.push(c); }
    return c;
  },
  focusClip(c) {
    if (c.p && ui.selPat !== c.p) { ui.plPick = null; selectPattern(c.p, true); }
    else if (c.a) { ui.plPick = { kind: 'auto', id: c.a }; this.renderPatterns(); }
    else if (c.smp) { ui.plPick = { kind: 'smp', id: c.smp }; this.renderPatterns(); }
  },

  /* ---------- pointer ---------- */
  down(e) {
    const { x, y } = this.pt(e), t = this.rowAt(y), hit = this.hit(x, y), s = x / this.sw, tool = this.tool;
    this.cv.setPointerCapture(e.pointerId);
    if (tool === 'zoom') {
      if (e.button === 2) { this.zoom(0.66, e.clientX); return; }
      this.drag = { mode: 'zoom', x0: x, x1: x };
      return;
    }
    if (tool === 'play') {
      if (e.button !== 0) return;
      ui.songPos = Math.max(0, Math.floor(s));
      if (ui.mode !== 'song') setMode('song');
      if (Transport.playing) Transport.stop();
      Transport.play();
      this.drag = { mode: 'play', at: ui.songPos };
      return;
    }
    if (e.button === 2 || (e.button === 0 && tool === 'delete')) {
      this.drag = { mode: 'erase' };
      if (hit) { this.removeClip(hit.c); this.draw(); }
      return;
    }
    if (e.button !== 0) return;
    if (hit && hit.part === 'menu') { this.drag = null; this.clipMenu(hit.c, e.clientX, e.clientY); return; }
    if (tool === 'mute') {
      const to = hit ? !hit.c.mu : true;
      this.drag = { mode: 'mute', to };
      if (hit) { if (to) hit.c.mu = true; else delete hit.c.mu; }
      this.draw();
      return;
    }
    if (tool === 'slice') {
      if (hit) splitClip(hit.c, this.snap(s, true));
      this.drag = { mode: 'slice' };
      this.draw();
      return;
    }
    if (hit && (hit.part === 'fin' || hit.part === 'fout')) {
      this.select([hit.c]);
      this.drag = { mode: hit.part, c: hit.c };
      return;
    }
    if (tool === 'select' && !(hit && this.sel.has(hit.c))) {
      if (hit) { if (e.shiftKey) this.sel.add(hit.c); else this.select([hit.c]); this.focusClip(hit.c); this.startMove(hit.c, x, y, false); }
      else this.drag = { mode: 'band', x0: x, y0: y, x1: x, y1: y, add: e.shiftKey ? new Set(this.sel) : null };
      this.draw();
      return;
    }
    if (hit && (tool === 'slip' || (e.altKey && e.shiftKey))) {
      this.select([hit.c]);
      this.drag = { mode: 'slip', c: hit.c, x0: x, o: hit.c.o || 0 };
      this.draw();
      return;
    }
    if (hit && (e.ctrlKey || e.metaKey || e.altKey)) {
      const list = this.sel.has(hit.c) ? [...this.sel] : [hit.c];
      const copies = list.map(c => ({ ...c, id: uid() }));
      proj.playlist.clips.push(...copies);
      this.select(copies);
      this.startMove(copies[list.indexOf(hit.c)], x, y, true);
      hint(copies.length > 1 ? T('{0} clip duplicate', copies.length) : T('Clip duplicata'));
    } else if (hit) {
      if (!this.sel.has(hit.c)) this.select([hit.c]);
      this.focusClip(hit.c);
      if (hit.part === 'right' || hit.part === 'left') this.drag = { mode: hit.part, c: hit.c, x0: x, s: hit.c.s, l: hit.c.l, o: hit.c.o || 0 };
      else this.startMove(hit.c, x, y, false);
    } else {
      const c = this.newClipAt(t, this.snap(s));
      this.select([c]);
      if (tool === 'paint') this.drag = { mode: 'paint', t, last: c };
      else this.startMove(c, x, y, false);
    }
    this.draw();
  },
  startMove(c, x, y, copied) {
    this.drag = { mode: 'move', c, x0: x, y0: y, copied, items: [...this.sel].map(k => ({ k, s: k.s, t: k.t })) };
  },
  move(e) {
    const { x, y } = this.pt(e), d = this.drag;
    if (!d) {
      const hit = this.hit(x, y);
      const cur = { menu: 'pointer', left: 'w-resize', right: 'e-resize', fin: 'col-resize', fout: 'col-resize', body: this.tool === 'slip' ? 'ew-resize' : 'grab' };
      this.cv.style.cursor = this.tool === 'zoom' ? 'zoom-in' : this.tool === 'play' ? 'pointer' : hit ? cur[hit.part] : this.tool === 'select' ? 'crosshair' : 'copy';
      return;
    }
    const sw = this.sw, s = x / sw;
    switch (d.mode) {
      case 'erase': { const hit = this.hit(x, y); if (hit) { this.removeClip(hit.c); this.draw(); } return; }
      case 'mute': { const hit = this.hit(x, y); if (hit && !!hit.c.mu !== d.to) { if (d.to) hit.c.mu = true; else delete hit.c.mu; this.draw(); } return; }
      case 'slice': case 'play': return;
      case 'zoom': d.x1 = x; this.draw(); return;
      case 'band': {
        d.x1 = x; d.y1 = y;
        const xa = Math.min(d.x0, x), xb = Math.max(d.x0, x), ya = Math.min(d.y0, y), yb = Math.max(d.y0, y);
        const inside = proj.playlist.clips.filter(c => { const b = this.clipBox(c); return b.h && b.x1 > xa && b.x0 < xb && b.y1 > ya && b.y0 < yb; });
        this.select(d.add ? [...d.add, ...inside] : inside);
        this.draw();
        return;
      }
      case 'paint': {
        const last = d.last, next = last.s + last.l;
        if (s >= next) {
          const c = { ...last, id: uid(), s: next };
          delete c.mu;
          proj.playlist.clips.push(c);
          d.last = c;
          this.sel.add(c);
          this.draw();
        }
        return;
      }
      case 'slip': {
        const c = d.c, dS = Math.round((x - d.x0) / sw);
        let o = d.o - dS;
        if (c.p) { const L = patLen(patById(c.p)); o = ((o % L) + L) % L; } else o = Math.max(0, o);
        c.o = o;
        this.draw();
        return;
      }
      case 'fin': case 'fout': {
        const c = d.c, v = d.mode === 'fin' ? s - c.s : c.s + c.l - s;
        c[d.mode] = clamp(Math.round(v * 4) / 4, 0, c.l);
        this.draw();
        return;
      }
      case 'right': {
        const end = this.snap(d.s + d.l + (x - d.x0) / sw, true);
        d.c.l = Math.max(ui.plSnap >= 4 ? 1 : 0.25, end - d.c.s);
        this.draw();
        return;
      }
      case 'left': {
        // trim the start: the content stays where it is on the timeline
        const ns = clamp(this.snap(d.s + (x - d.x0) / sw, true), Math.max(0, d.s - d.o), d.s + d.l - 1);
        d.c.s = ns; d.c.l = d.s + d.l - ns; d.c.o = d.o + (ns - d.s);
        this.draw();
        return;
      }
      case 'move': {
        const c = d.c, base = d.items.find(it => it.k === c) || { s: c.s, t: c.t };
        const ns = this.snap(base.s + (x - d.x0) / sw, true), dS = ns - base.s;
        const dT = this.rowAt(y) - this.rowAt(d.y0), n = proj.playlist.tracks.length;
        const minS = Math.min(...d.items.map(it => it.s)), minT = Math.min(...d.items.map(it => it.t)), maxT = Math.max(...d.items.map(it => it.t));
        const ds = Math.max(-minS, dS), dt = clamp(dT, -minT, n - 1 - maxT);
        d.items.forEach(it => { it.k.s = it.s + ds; it.k.t = it.t + dt; });
        this.draw();
        return;
      }
    }
  },
  up() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.mode === 'zoom') {
      if (Math.abs(d.x1 - d.x0) > 8) this.zoomTo(Math.min(d.x0, d.x1) / this.sw, Math.max(d.x0, d.x1) / this.sw);
      else this.zoom(1.5, d.x0 - this.sc.scrollLeft + this.sc.getBoundingClientRect().left);
      return;
    }
    if (d.mode === 'play') { Transport.stop(); ui.songPos = d.at; onTransportChange(); return; }
    if (d.mode === 'band') { this.draw(); return; }
    commit();
    this.draw();
  },
  key(e) {
    const mod = e.ctrlKey || e.metaKey;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel.size) {
      [...this.sel].forEach(c => this.removeClip(c));
      commit();
      this.draw();
      return true;
    }
    if (mod && shortcutKey(e) === 'a' && !WM.focused) { this.select(proj.playlist.clips); this.draw(); hint(T('{0} clip selezionate', this.sel.size)); return true; }
    if (mod && shortcutKey(e) === 'b' && this.sel.size) {
      // duplicate the selection right after itself
      const list = [...this.sel], a = Math.min(...list.map(c => c.s)), b = Math.max(...list.map(c => c.s + c.l));
      const copies = list.map(c => ({ ...c, id: uid(), s: c.s + (b - a) }));
      proj.playlist.clips.push(...copies);
      this.select(copies);
      commit();
      this.draw();
      return true;
    }
    return false;
  },

  /* ---------- ruler: position, loop and markers ---------- */
  initRuler() {
    const rp = e => { const r = this.rc.getBoundingClientRect(); return { x: e.clientX - r.left + this.sc.scrollLeft, y: e.clientY - r.top }; };
    this.rc.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const { x, y } = rp(e), m = y < MARK_H ? this.markerAt(x) : null;
      this.rc.setPointerCapture(e.pointerId);
      if (m) { this.rulerDrag = { marker: m, x0: x, s0: m.s, moved: false }; return; }
      this.rulerDrag = { x0: x, x1: x };
    });
    this.rc.addEventListener('pointermove', e => {
      const d = this.rulerDrag;
      if (!d) {
        const { x, y } = rp(e);
        this.rc.style.cursor = y < MARK_H && this.markerAt(x) ? 'grab' : '';
        return;
      }
      const { x } = rp(e);
      if (d.marker) {
        const s = Math.max(0, this.snap(d.s0 + (x - d.x0) / this.sw, true));
        if (s !== d.marker.s) { d.marker.s = s; d.moved = true; this.draw(); }
        return;
      }
      d.x1 = x;
      this.drawRuler(this.sc.scrollLeft, this.sc.clientWidth);
    });
    this.rc.addEventListener('pointerup', e => {
      const d = this.rulerDrag;
      if (!d) return;
      this.rulerDrag = null;
      if (d.marker) {
        if (d.moved) { proj.markers = normalizeMarkers(proj.markers); commit(); this.draw(); PR.draw(); }
        else { ui.songPos = d.marker.s; if (ui.mode !== 'song') setMode('song'); else Transport.restart(); onTransportChange(); }
        return;
      }
      if (Math.abs(d.x1 - d.x0) > 6) {
        const a = this.snap(Math.min(d.x0, d.x1) / this.sw, true), b = Math.max(a + 1, this.snap(Math.max(d.x0, d.x1) / this.sw, true));
        proj.loop = { s: a, e: b };
        ui.songPos = a;
        commit();
        hint(T('Loop: battuta {0} – {1} (clic destro sul righello per toglierlo)', barAt(a).bar, barAt(b).bar));
      } else {
        ui.songPos = this.snap(d.x0 / this.sw);
      }
      if (ui.mode !== 'song') setMode('song');
      else Transport.restart();
      onTransportChange();
      this.draw();
    });
    this.rc.addEventListener('dblclick', e => {
      const { x, y } = rp(e), m = y < MARK_H ? this.markerAt(x) : null;
      if (m) renameMarker(m, { left: e.clientX - 20, top: this.rc.getBoundingClientRect().top, width: 160, height: 24 });
      else if (y < MARK_H) addMarker(this.snap(x / this.sw, true));
    });
    this.rc.addEventListener('contextmenu', e => {
      e.preventDefault();
      const { x, y } = rp(e), m = y < MARK_H + 4 ? this.markerAt(x) : null;
      if (m) { markerMenu(m, e.clientX, e.clientY); return; }
      this.rulerMenu(this.snap(x / this.sw, true), e.clientX, e.clientY);
    });
  },
  markerAt(x) {
    const ms = proj.markers;
    for (let i = ms.length - 1; i >= 0; i--) {
      const mx = ms[i].s * this.sw, w = this.markerWidth(ms[i]);
      if (x >= mx - 3 && x <= mx + w) return ms[i];
    }
    return null;
  },
  markerWidth(m) {
    const g = this.rc.getContext('2d');
    g.font = '600 10px ' + TH.label;
    return 12 + g.measureText(this.markerLabel(m)).width;
  },
  markerLabel: m => (m.act === 'ts' ? m.num + '/' + m.den : (m.name || T('Marcatore')) + (m.act ? ' · ' + { start: T('inizio'), loop: T('loop'), mloop: T('ripeti'), skip: T('salta'), pause: T('pausa') }[m.act] : '')),
  rulerMenu(s, x, y) {
    const bar = barAt(s), at = bar.barStart, spans = [[bar.beatLen, T('1 battito')], [bar.barLen, T('1 battuta')], [bar.barLen * 2, T('2 battute')], [bar.barLen * 4, T('4 battute')], [bar.barLen * 8, T('8 battute')]];
    openMenu(x, y, [
      { title: T('Battuta {0}', bar.bar) + ' · ' + bar.ts.num + '/' + bar.ts.den },
      { label: T('Aggiungi un marcatore qui'), action: () => addMarker(s) },
      { label: T('Aggiungi un cambio di metro qui'), sub: METRES.map(([n, d]) => ({ label: n + '/' + d, action: () => addMarker(at, 'ts', { num: n, den: d }) })) },
      { label: T('Metro del progetto: {0}', proj.ts.num + '/' + proj.ts.den), sub: metreMenuItems() },
      '-',
      { label: T('Inserisci spazio dalla battuta {0}', bar.bar), sub: spans.map(([n, l]) => ({ label: l, action: () => insertSpace(at, n) })) },
      { label: T('Elimina spazio dalla battuta {0}', bar.bar), sub: spans.map(([n, l]) => ({ label: l, action: () => deleteSpace(at, n) })) },
      '-',
      { label: T('Loop su questa battuta'), action: () => { proj.loop = { s: at, e: at + bar.barLen }; commit(); this.draw(); } },
      { label: T('Togli il loop'), disabled: !proj.loop, action: () => { delete proj.loop; commit(); hint(T('Loop rimosso')); this.draw(); } },
    ]);
  },

  /* ---------- drawing ---------- */
  draw() {
    const sc = this.sc, W = sc.clientWidth, H = sc.clientHeight;
    if (!W || !H) return;
    const rows = this.layout(), sw = this.sw, tracks = proj.playlist.tracks;
    const total = Math.max(songLen() + 8 * spb(), 32 * spb());
    this.sizer.style.width = Math.max(W, total * sw) + 'px';
    this.sizer.style.height = Math.max(H, this.totalH) + 'px';
    if (this.heads.childElementCount !== tracks.length || [...this.heads.children].some((el, i) => +el.style.height.replace('px', '') !== rows[i].h)) this.renderHeads();
    const sx = sc.scrollLeft, sy = sc.scrollTop, g = fitCanvas(this.cv, W, H);
    g.fillStyle = TH.grid;
    g.fillRect(0, 0, W, H);
    rows.forEach(r => {
      const y = r.y - sy, t = tracks[r.i];
      if (!r.h || y > H || y + r.h < 0) return;
      if (t.color) { g.fillStyle = t.color + '14'; g.fillRect(0, y, W, r.h); }
      else if (r.i % 2) { g.fillStyle = TH.gridBlack; g.fillRect(0, y, W, r.h); }
      g.fillStyle = TH.lineStep;
      g.fillRect(0, y + r.h - 1, W, 1);
    });
    const from = sx / sw, to = (sx + W) / sw;
    eachBar(from - 64, to + 1, true, (bs, num, bl, bt) => {
      g.fillStyle = TH.lineBar;
      g.fillRect(Math.round(bs * sw - sx), 0, 1, H);
      if (bt * sw >= 9) { g.fillStyle = TH.lineBeat; for (let b = bt; b < bl - 1e-9; b += bt) g.fillRect(Math.round((bs + b) * sw - sx), 0, 1, H); }
    });
    if (proj.loop) {
      const a = proj.loop.s * sw - sx, b = proj.loop.e * sw - sx;
      g.fillStyle = TH.loopBand;
      g.fillRect(a, 0, b - a, H);
      g.fillStyle = TH.brass;
      g.fillRect(Math.round(a), 0, 1, H);
      g.fillRect(Math.round(b), 0, 1, H);
    }
    for (const m of proj.markers) {
      const xm = Math.round(m.s * sw - sx);
      if (xm < 0 || xm > W) continue;
      g.fillStyle = m.act === 'ts' ? '#8fa7f455' : '#e8b55e55';
      for (let yy = 0; yy < H; yy += 6) g.fillRect(xm, yy, 1, 3);
    }
    for (const c of proj.playlist.clips) this.drawClip(g, c, sx, sy, W, H);
    rows.forEach(r => { if (r.h && trackMuted(r.i)) { g.fillStyle = TH.outside; g.fillRect(0, r.y - sy, W, r.h); } });
    const d = this.drag;
    if (d && d.mode === 'band') {
      g.fillStyle = '#ffffff12'; g.strokeStyle = '#ffffffaa'; g.setLineDash([4, 3]);
      const xa = Math.min(d.x0, d.x1) - sx, ya = Math.min(d.y0, d.y1) - sy;
      g.fillRect(xa, ya, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.strokeRect(xa + 0.5, ya + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    }
    if (d && d.mode === 'zoom') { g.fillStyle = '#ffffff18'; g.fillRect(Math.min(d.x0, d.x1) - sx, 0, Math.abs(d.x1 - d.x0), H); }
    if (ui.mode === 'song') {
      const pos = Transport.playing ? Transport.position() : ui.songPos;
      if (pos != null) { g.fillStyle = TH.signal; g.fillRect(Math.round(pos * sw - sx), 0, 2, H); }
    }
    if (!proj.playlist.clips.length) {
      g.fillStyle = TH.dim;
      g.font = '500 14px ' + TH.label;
      g.fillText(T('Clicca sulla griglia per inserire il pattern “{0}”. Clic destro per cancellare.', curPat().name), 16 - sx, 28 - sy);
    }
    this.drawRuler(sx, W);
  },
  // Frame shared by every clip kind: body, coloured title strip with the menu icon, outline.
  clipFrame(g, c, x, y, w, hh, color, title, body) {
    const sel = this.sel.has(c);
    g.save();
    if (c.mu) g.globalAlpha = 0.35;
    rrect(g, x + 0.5, y + 0.5, w - 1, hh - 1, 3);
    g.clip();
    g.fillStyle = color + (sel ? '55' : '38');
    g.fillRect(x, y, w, hh);
    g.fillStyle = color + 'd8';
    g.fillRect(x, y, w, Math.min(14, hh));
    g.fillStyle = TH.noteInk;
    g.font = '600 10px ' + TH.label;
    if (w > 24) { g.fillRect(x + 4, y + 4, 7, 1.4); g.fillRect(x + 4, y + 7, 7, 1.4); g.fillRect(x + 4, y + 10, 7, 1.4); }
    g.fillText(title, x + (w > 24 ? 15 : 4), y + 10.5);
    if (hh > 16) body();
    g.restore();
    if (c.mu) g.setLineDash([4, 3]);
    g.strokeStyle = sel ? TH.text : color;
    g.lineWidth = sel ? 1.5 : 1;
    rrect(g, x + 0.5, y + 0.5, w - 1, hh - 1, 3);
    g.stroke();
    g.setLineDash([]);
    g.lineWidth = 1;
  },
  drawAutoClip(g, c, x, y, w, hh) {
    const a = Automation.byId(c.a);
    if (!a) return;
    this.clipFrame(g, c, x, y, w, hh, a.color, a.name, () => {
      const top = y + 17, bh = hh - 20, sw = this.sw, off = c.o || 0;
      g.strokeStyle = a.color;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let k = 0; k <= Math.ceil(c.l * sw / 3); k++) {
        const local = Math.min(c.l, k * 3 / sw), v = Automation.valueAt(a, local + off);
        const px = x + local * sw, py = top + (1 - v) * bh;
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.stroke();
    });
  },
  drawAudioClip(g, c, x, y, w, hh, W) {
    const smp = clipSample(c);
    const flags = (c.pitch ? ' ' + (c.pitch > 0 ? '+' : '') + c.pitch + 'st' : '') + (c.rev ? ' ◂' : '') + (c.stretch && c.stretch !== 1 ? ' ×' + (+c.stretch).toFixed(2) : '');
    const name = (SAMPLES[c.smp] ? SAMPLES[c.smp].name : T('Audio mancante')) + flags;
    this.clipFrame(g, c, x, y, w, hh, '#7fb9d9', name, () => {
      if (!smp || !smp.buffer) return;
      const pk = samplePeaks(smp), top = y + 15, bh = hh - 17, mid = top + bh / 2, sw = this.sw;
      const secPerPx = this.stepSec() / sw, off = (c.o || 0) * this.stepSec(), fin = c.fin || 0, fout = c.fout || 0;
      g.fillStyle = '#7fb9d9';
      const x0 = Math.max(x, 0), x1 = Math.min(x + w, W);
      for (let px = x0; px < x1; px++) {
        const t = off + (px - x) * secPerPx, i = Math.floor(t * pk.rate);
        if (i >= pk.data.length) break;
        const local = (px - x) / sw, f = (fin > 0 ? clamp(local / fin, 0, 1) : 1) * (fout > 0 ? clamp((c.l - local) / fout, 0, 1) : 1);
        const a = pk.data[i] * bh / 2 * (c.gain ?? 1) * f;
        g.fillRect(px, mid - a, 1, Math.max(1, a * 2));
      }
      // fade curves and their handles
      g.strokeStyle = '#e3eaee';
      g.lineWidth = 1;
      g.beginPath();
      if (fin > 0) { g.moveTo(x, y + hh); g.lineTo(x + fin * sw, top); }
      if (fout > 0) { g.moveTo(x + w - fout * sw, top); g.lineTo(x + w, y + hh); }
      g.stroke();
      if (w > 30) {
        g.fillStyle = '#e3eaee';
        g.fillRect(x + fin * sw - 3, top + 1, 6, 6);
        g.fillRect(x + w - fout * sw - 3, top + 1, 6, 6);
      }
    });
  },
  drawClip(g, c, sx, sy, W, H) {
    const r = this.row(c.t);
    if (!r.h) return;
    const x = c.s * this.sw - sx, w = c.l * this.sw, y = r.y - sy + 2, hh = r.h - 4;
    if (x > W || x + w < 0 || y > H || y + hh < 0) return;
    if (c.a) { this.drawAutoClip(g, c, x, y, w, hh); return; }
    if (c.smp) { this.drawAudioClip(g, c, x, y, w, hh, W); return; }
    const p = patById(c.p);
    if (!p) return;
    const sw = this.sw, off = c.o || 0;
    this.clipFrame(g, c, x, y, w, hh, p.color, p.name, () => {
      // note preview, repeated for each loop of the pattern inside the clip
      const L = patLen(p);
      let lo = 127, hi = 0, any = false;
      for (const k in p.notes) for (const n of p.notes[k]) { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); any = true; }
      if (!any) return;
      const span = Math.max(1, hi - lo), top = y + 17, bh = hh - 21;
      g.fillStyle = p.color;
      const base = c.mu ? 0.35 : 1;
      for (let rep = 0; rep * L < c.l + off; rep++) {
        const ox = x + (rep * L - off) * sw;
        if (ox > W) break;
        if (rep && ox > x) { g.globalAlpha = 0.5 * base; g.fillRect(ox, y + 14, 1, hh - 14); }
        g.globalAlpha = 0.9 * base;
        for (const k in p.notes) {
          for (const n of p.notes[k]) {
            const local = rep * L + n.s - off;
            if (local < 0 || local >= c.l || n.mu) continue;
            const nx = x + local * sw, ny = top + (1 - (n.m - lo) / span) * (bh - 2);
            if (nx > W || nx + n.l * sw < 0) continue;
            g.fillRect(nx, ny, Math.max(1.5, Math.min(n.l * sw, (c.l - local) * sw) - 1), 2);
          }
        }
      }
      g.globalAlpha = 1;
    });
  },
  drawRuler(sx, W) {
    const RH = RULER_H, g = fitCanvas(this.rc, W, RH), sw = this.sw;
    g.fillStyle = TH.panel2;
    g.fillRect(0, 0, W, RH);
    g.fillStyle = '#2b3439';
    g.fillRect(0, 0, W, MARK_H);
    g.font = '600 10px ' + TH.mono;
    const from = sx / sw, to = (sx + W) / sw, every = 64 * ui.plZoom < 28 ? 4 : 64 * ui.plZoom < 48 ? 2 : 1;
    eachBar(from - 64, to + 1, true, (bs, num, bl) => {
      const x = Math.round(bs * sw - sx), major = (num - 1) % every === 0;
      g.fillStyle = major ? TH.dim : TH.faint;
      g.fillRect(x, major ? MARK_H + 6 : MARK_H + 11, 1, RH - (major ? MARK_H + 6 : MARK_H + 11));
      if (major) g.fillText(String(num), x + 4, MARK_H + 13);
      if (bl !== spb() || num === 1) { /* metre shown on its marker */ }
    });
    const loop = this.rulerDrag && !this.rulerDrag.marker ? { s: Math.min(this.rulerDrag.x0, this.rulerDrag.x1) / sw, e: Math.max(this.rulerDrag.x0, this.rulerDrag.x1) / sw } : proj.loop;
    if (loop) {
      const a = loop.s * sw - sx, b = loop.e * sw - sx;
      g.fillStyle = TH.loopBand;
      g.fillRect(a, MARK_H, b - a, RH - MARK_H);
      g.fillStyle = TH.brass;
      g.fillRect(a, MARK_H, b - a, 3);
    }
    // time markers: flag and name in the top lane
    g.font = '600 10px ' + TH.label;
    for (const m of proj.markers) {
      const x = Math.round(m.s * sw - sx), label = this.markerLabel(m), w = 10 + g.measureText(label).width;
      if (x + w < 0 || x > W) continue;
      const col = m.act === 'ts' ? '#8fa7f4' : m.act ? '#e7795b' : '#e8b55e';
      g.fillStyle = col + '40';
      g.fillRect(x, 1, w, MARK_H - 2);
      g.fillStyle = col;
      g.fillRect(x, 0, 2, RH);
      g.fillStyle = '#e3eaee';
      g.fillText(label, x + 5, 10);
    }
    const end = songLen();
    if (end) { g.fillStyle = TH.brass; const xe = end * sw - sx; g.beginPath(); g.moveTo(xe, RH); g.lineTo(xe - 6, RH - 9); g.lineTo(xe, RH - 9); g.fill(); }
    const pos = ui.mode === 'song' && Transport.playing ? Transport.position() : ui.songPos;
    if (pos != null) { g.fillStyle = TH.signal; const x = pos * sw - sx; g.beginPath(); g.moveTo(x - 5, RH - 10); g.lineTo(x + 5, RH - 10); g.lineTo(x, RH - 2); g.fill(); }
    g.fillStyle = TH.line;
    g.fillRect(0, RH - 1, W, 1);
  },
};

// Peak envelope of a sample (200 values per second), cached on the sample for drawing audio clips.
function samplePeaks(smp) {
  if (smp.peaks && smp.peaks.buf === smp.buffer) return smp.peaks;
  const b = smp.buffer, rate = 200, per = Math.max(1, Math.floor(b.sampleRate / rate)), n = Math.ceil(b.length / per), data = new Float32Array(n);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * per, e = Math.min(d.length, j + per); j < e; j++) { const a = Math.abs(d[j]); if (a > m) m = a; }
      if (m > data[i]) data[i] = m;
    }
  }
  smp.peaks = { buf: b, rate: b.sampleRate / per, data };
  return smp.peaks;
}
