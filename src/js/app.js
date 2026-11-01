'use strict';
/* Ritmo Studio — application glue: toolbars, menu bar, folder browser, floating windows, instrument window,
   project operations, files, computer keyboard and MIDI, frame loop */

let masterKnob = null;

/* ---------- Floating windows ---------- */
const WIN_DEFAULTS = {
  rack: d => { const w = Math.min(1040, d.w - 40); return { x: Math.max(12, Math.round((d.w - w) / 2)), y: Math.round(d.h * 0.26), w, h: null }; },
  piano: d => { const w = Math.min(1180, d.w - 40), hh = Math.min(600, d.h - 40); return { x: Math.round((d.w - w) / 2), y: 16, w, h: hh }; },
  mixer: d => { const w = Math.min(1460, d.w - 24), hh = Math.min(500, d.h - 24); return { x: Math.round((d.w - w) / 2), y: Math.max(6, d.h - hh - 8), w, h: hh }; },
  inst: d => ({ x: Math.max(8, d.w - 452), y: 12, w: 440, h: Math.min(720, d.h - 24) }),
  help: d => ({ x: Math.max(8, Math.round(d.w / 2 - 270)), y: 30, w: 540, h: Math.min(560, d.h - 60) }),
  loopstarter: d => ({ x: Math.max(8, Math.round(d.w / 2 - 230)), y: 40, w: 460, h: null }),
  chordtool: d => ({ x: Math.max(8, Math.round(d.w / 2 - 240)), y: 30, w: 480, h: null }),
  chords: d => ({ x: Math.max(8, d.w - 330), y: d.h > 500 ? d.h - 230 : 12, w: 310, h: null }),
  welcome: d => ({ x: Math.max(8, Math.round(d.w / 2 - 300)), y: Math.max(8, Math.round(d.h / 2 - 230)), w: 600, h: null }),
  fx: d => ({ x: Math.max(8, Math.round(d.w / 2 - 200)), y: 30, w: 420, h: null }),
  auto: d => { const w = Math.min(760, d.w - 40); return { x: Math.round((d.w - w) / 2), y: 40, w, h: 300 }; },
  export: d => ({ x: Math.max(8, Math.round(d.w / 2 - 230)), y: 40, w: 460, h: null }),
  audio: d => ({ x: Math.max(8, Math.round(d.w / 2 - 240)), y: 40, w: 480, h: null }),
};
const WIN_ICON = {
  min: '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2.5 9h7"/></svg>',
  max: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2.5" width="8" height="7"/></svg>',
  close: '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m2 2 8 8M10 2l-8 8"/></svg>',
};
const WM = {
  z: 20, focused: null,
  el(id) { return document.getElementById('win-' + id); },
  isOpen(id) { const e = this.el(id); return !!e && !e.hidden; },
  open(id) {
    const e = this.el(id);
    if (!e) return;
    if (e.hidden) { e.hidden = false; this.place(id); e.classList.toggle('max', !!(ui.wins[id] && ui.wins[id].max)); }
    this.focus(id);
    ui.wins[id] = { ...(ui.wins[id] || {}), open: true };
    savePrefs();
    this.refresh(id);
  },
  close(id) {
    const e = this.el(id);
    if (!e || e.hidden) return;
    this.remember(id);
    e.hidden = true;
    ui.wins[id].open = false;
    if (id === 'inst') ui.editCh = null;
    if (this.focused === id) this.focused = null;
    savePrefs();
    this.syncButtons();
  },
  // Like the F-keys of classic DAWs: open it, bring it forward, or close it when it is already in front.
  toggle(id) { if (this.isOpen(id) && this.focused === id) this.close(id); else this.open(id); },
  focus(id) {
    const e = this.el(id);
    if (!e) return;
    e.style.zIndex = String(++this.z);
    $$('.win').forEach(w => w.classList.toggle('focused', w === e));
    this.focused = id;
    this.syncButtons();
  },
  blur() { $$('.win').forEach(w => w.classList.remove('focused')); this.focused = null; this.syncButtons(); },
  place(id) {
    const desk = $('#desk'), d = { w: desk.clientWidth, h: desk.clientHeight }, e = this.el(id);
    const saved = ui.wins[id], s = saved && saved.x != null ? saved : WIN_DEFAULTS[id](d);
    e.style.left = s.x + 'px';
    e.style.top = s.y + 'px';
    e.style.width = s.w + 'px';
    e.style.height = s.h ? s.h + 'px' : '';
    this.clampIn(e);
  },
  clampIn(e) {
    const desk = $('#desk'), W = desk.clientWidth, H = desk.clientHeight;
    if (!W || !H) return;
    if (e.offsetWidth > W) e.style.width = W + 'px';
    if (e.offsetHeight > H) e.style.height = H + 'px';
    e.style.left = clamp(e.offsetLeft, 0, Math.max(0, W - e.offsetWidth)) + 'px';
    e.style.top = clamp(e.offsetTop, 0, Math.max(0, H - e.offsetHeight)) + 'px';
  },
  remember(id) {
    const e = this.el(id);
    if (!e || e.hidden || e.classList.contains('max')) return;
    ui.wins[id] = { open: true, x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.style.height ? e.offsetHeight : null };
  },
  maximize(id) {
    const e = this.el(id);
    if (!e) return;
    const on = !e.classList.contains('max');
    if (on) this.remember(id);
    e.classList.toggle('max', on);
    ui.wins[id] = { ...(ui.wins[id] || {}), max: on };
    savePrefs();
    this.refresh(id);
  },
  // The small arrow at the left of every title bar: window commands.
  windowMenu(id, anchor) {
    const items = id === 'playlist' ? [
      { label: T('Porta la Playlist in primo piano'), key: 'F5', action: () => this.blur() },
      { label: T('Ripristina la disposizione delle finestre'), action: () => this.resetLayout() },
    ] : [
      { label: this.el(id).classList.contains('max') ? T('Ripristina dimensione') : T('Ingrandisci||finestra'), action: () => this.maximize(id) },
      { label: T('Posizione iniziale'), action: () => { delete ui.wins[id]; this.el(id).classList.remove('max'); this.place(id); this.remember(id); savePrefs(); } },
      '-',
      { label: T('Chiudi'), action: () => this.close(id) },
    ];
    menuAt(anchor, items);
  },
  refresh(id) {
    if (id === 'piano') { PR.refreshToolbar(); PR.draw(); }
    if (id === 'mixer' || id === 'fx') Mixer.render();
    if (id === 'auto') AutoEditor.render();
    if (id === 'export') ExportDialog.render();
    if (id === 'audio') AudioSettings.render();
    if (id === 'rack') Rack.render();
    if (id === 'chords') ChordPanel.update();
    this.syncButtons();
  },
  resetLayout() {
    Object.keys(WIN_DEFAULTS).forEach(id => { if (this.isOpen(id)) this.close(id); });
    ui.wins = { rack: { open: true } };
    this.open('rack');
    toast(T('Disposizione delle finestre ripristinata'));
  },
  syncButtons() {
    $$('[data-toggle]').forEach(b => {
      const id = b.dataset.toggle;
      b.setAttribute('aria-pressed', String(id === 'browser' ? ui.browser : id === 'playlist' ? !this.focused : this.isOpen(id)));
    });
  },
  init() {
    // Title bar chrome shared by every window: window menu on the left, minimise / maximise / close on the right.
    const chrome = (bar, id, closable) => {
      const menu = h('button', 'win-menu', '▶');
      menu.type = 'button';
      menu.title = T('Menu della finestra');
      menu.setAttribute('aria-label', T('Menu della finestra'));
      menu.addEventListener('click', e => { e.stopPropagation(); this.windowMenu(id, menu); });
      bar.prepend(menu);
      if (!closable) return;
      const ctl = h('span', 'win-ctl');
      const btn = (kind, label, fn) => { const b = h('button', 'win-x'); b.type = 'button'; b.innerHTML = WIN_ICON[kind]; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', fn); ctl.appendChild(b); return b; };
      btn('min', T('Riduci||finestra'), () => this.close(id));
      btn('max', T('Ingrandisci||finestra'), () => this.maximize(id));
      btn('close', T('Chiudi'), () => this.close(id)).dataset.close = id;
      bar.appendChild(ctl);
    };
    chrome($('#playlist .win-title'), 'playlist', false);
    $$('.win').forEach(w => {
      const id = w.dataset.win, bar = $('.win-title', w);
      chrome(bar, id, true);
      bar.addEventListener('dblclick', e => { if (!e.target.closest('button, select, input, label, .knob')) this.maximize(id); });
      w.addEventListener('pointerdown', () => { if (this.focused !== id) this.focus(id); }, true);
      bar.addEventListener('pointerdown', e => {
        if (e.button !== 0 || w.classList.contains('max') || e.target.closest('button, select, input, label, .knob')) return;
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        const ox = e.clientX - w.offsetLeft, oy = e.clientY - w.offsetTop;
        const move = ev => { w.style.left = (ev.clientX - ox) + 'px'; w.style.top = (ev.clientY - oy) + 'px'; this.clampIn(w); };
        const up = () => {
          bar.removeEventListener('pointermove', move);
          bar.removeEventListener('pointerup', up);
          bar.removeEventListener('pointercancel', up);
          this.remember(id);
          savePrefs();
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
        bar.addEventListener('pointercancel', up);
      });
      let t = 0;
      new ResizeObserver(() => {
        if (w.hidden) return;
        clearTimeout(t);
        t = setTimeout(() => { this.remember(id); savePrefs(); }, 300);
      }).observe(w);
    });
    $$('[data-toggle]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.toggle;
      if (id === 'browser') toggleBrowser();
      else if (id === 'playlist') this.blur();
      else this.toggle(id);
    }));
    window.addEventListener('resize', () => $$('.win:not([hidden])').forEach(w => this.clampIn(w)));
  },
};
function toggleBrowser() {
  const app = $('#app');
  if (window.matchMedia('(max-width: 860px)').matches) app.classList.toggle('show-browser');
  else { ui.browser = !ui.browser; app.classList.toggle('hide-browser', !ui.browser); savePrefs(); }
  WM.syncButtons();
}

/* ---------- Rendering ---------- */
function renderAll() {
  renderTop();
  Tree.render();
  Rack.render();
  PR.refreshToolbar();
  PL.renderHeads();
  PL.draw();
  PR.draw();
  if (WM.isOpen('mixer')) Mixer.render();
  if (ui.editCh) renderEditor();
}
function renderTop() {
  const nameIn = $('#proj-name');
  if (document.activeElement !== nameIn) nameIn.value = proj.name;
  document.title = proj.name + ' — Ritmo Studio';
  const bpm = $('#bpm');
  if (document.activeElement !== bpm) bpm.value = proj.bpm.toFixed(3);
  $('#mode-pat').classList.toggle('on', ui.mode === 'pattern');
  $('#mode-song').classList.toggle('on', ui.mode === 'song');
  $('#btn-play').setAttribute('aria-pressed', String(Transport.playing));
  $('#btn-rec').setAttribute('aria-pressed', String(ui.rec));
  $('#btn-metro').setAttribute('aria-pressed', String(ui.metro));
  $('#btn-typing').setAttribute('aria-pressed', String(ui.typing));
  $('#btn-recmode').setAttribute('aria-pressed', String(ui.recMode === 'audio'));
  const ps = $('#pat-select');
  ps.textContent = '';
  proj.patterns.forEach(p => ps.appendChild(new Option(p.name, p.id)));
  ps.value = curPat().id;
  masterKnob.setValue(proj.mixer[0].vol);
  WM.syncButtons();
}
function updateStatusRight() {
  $('#sys-audio').textContent = actx ? (actx.sampleRate / 1000).toFixed(1).replace('.', ',') + ' kHz' : T('spento');
}
let memT = 0;
function updateMemory(now) {
  if (now - memT < 1000) return;
  memT = now;
  const m = performance.memory;
  $('#sys-mem').textContent = m ? Math.round(m.usedJSHeapSize / 1048576) + ' MB'
    : (actx ? Math.round(((actx.baseLatency || 0) + (actx.outputLatency || 0)) * 1000) + ' ms' : '—');
}

/* ---------- Folder browser ---------- */
const ICONS = {
  folder: '<svg class="fold" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1.8 3.5h4.4l1.4 1.6h6.6v7.4H1.8z"/></svg>',
  inst: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8h2.2l1.6-4.5 2.6 9 2.1-6.5 1.4 2h3.1"/></svg>',
  fx: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 2v12M12 2v12"/><circle cx="4" cy="10" r="1.8" fill="currentColor"/><circle cx="12" cy="5" r="1.8" fill="currentColor"/></svg>',
  wave: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 5v6M6 3v10M8 6v4M10 4v8M12 6v4"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  song: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 12V3.5l7-1.5v8.5"/><circle cx="4.5" cy="12" r="1.8"/><circle cx="11.5" cy="10.5" r="1.8"/></svg>',
  midi: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><circle cx="5" cy="8.5" r=".9" fill="currentColor"/><circle cx="11" cy="8.5" r=".9" fill="currentColor"/><circle cx="8" cy="5.5" r=".9" fill="currentColor"/></svg>',
  mixer: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M4 2v12M8 2v12M12 2v12"/></svg>',
  help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M6.3 6.2a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.4v.1"/></svg>',
  project: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 1.5h6.5L13 5v9.5H3z" opacity=".9"/><path d="M9.5 1.5V5H13" fill="none" stroke="#2d363b" stroke-width="1"/></svg>',
  recent: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M1.8 3.5h4.4l1.4 1.6h6.6v7.4H1.8z"/><path d="M8 7.2v2.2l1.5 1" stroke-linecap="round"/></svg>',
  plug: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 1.5h1.4v3H5zM9.6 1.5H11v3H9.6zM3.5 4.5h9v3.2a4.5 4.5 0 0 1-3.6 4.4v2.4H7.1v-2.4a4.5 4.5 0 0 1-3.6-4.4z"/></svg>',
  preset: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 3h4l1.2 1.4h5.8v8.6h-11z" opacity=".85"/></svg>',
  score: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 2v8.3a2.3 2.3 0 1 1-1.4-2.1V2z"/></svg>',
  pack: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M2 5.5 8 2.5l6 3v6l-6 3-6-3z"/><path d="M2 5.5 8 8.5l6-3M8 8.5v6"/></svg>',
  auto: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12 5 6l3 3 3-6 3.5 5"/></svg>',
  star: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="m8 1.8 1.9 4 4.3.5-3.2 3 .9 4.3L8 11.4l-3.9 2.2.9-4.3-3.2-3 4.3-.5z"/></svg>',
};
let midiStatus = T('Nessun dispositivo collegato.');
// A preset in the browser: click applies it (new channel, first free slot, selected track), drag drops it.
function presetRow(pr, depth) {
  const Treeadd = Tree._add;
  Treeadd('item', depth, pr.kind === 'channel' ? 'inst' : pr.kind === 'effect' ? 'fx' : 'mixer', pr.name, {
    title: pr.kind === 'channel' ? T('Clic: nuovo canale da questo preset · trascina su un canale per sostituirlo') : pr.kind === 'effect' ? T('Clic: nello slot libero della traccia selezionata') : T('Clic: applica alla traccia selezionata del mixer'),
    click: async () => {
      const d = await Presets.read(pr.kind, pr.name);
      if (!d) return;
      if (pr.kind === 'channel') Presets.applyChannel(d, null, pr.name);
      else if (pr.kind === 'effect') { const i = ui.selMix, k = proj.mixer[i].fx.findIndex(x => !x); if (k < 0) toast(T('Gli slot di {0} sono tutti occupati', mixerName(i))); else { WM.open('mixer'); Presets.applySlot(d, i, k); } }
      else { WM.open('mixer'); Presets.applyTrack(d, ui.selMix); }
    },
    ctx: e => openMenu(e.clientX, e.clientY, [
      { title: pr.name },
      ...(pr.kind === 'channel' ? [{ label: T('Applica al canale selezionato'), disabled: !ui.selCh, action: async () => Presets.applyChannel(await Presets.read('channel', pr.name), chById(ui.selCh), pr.name) }] : []),
      { label: T('Elimina il preset'), danger: true, action: () => Presets.remove(pr.kind, pr.name) },
    ]),
    drag: { kind: 'preset', preset: pr },
  });
}
const Tree = {
  render() {
    const box = $('#tree'), keep = box.scrollTop;
    box.textContent = '';
    const add = (cls, depth, icon, label, o = {}) => {
      const b = h('button', 'tree-row ' + cls + (o.sel ? ' sel' : ''));
      b.type = 'button';
      b.style.setProperty('--d', depth);
      if (o.tone) b.style.setProperty('--tone', 'var(--tone-' + o.tone + ')');
      if (cls === 'folder') { b.appendChild(h('span', 'caret', o.open ? '▾' : '▸')); b.setAttribute('aria-expanded', String(!!o.open)); }
      if (o.color) { const dot = h('span', 'pdot'); dot.style.background = o.color; b.appendChild(dot); }
      else if (icon) b.insertAdjacentHTML('beforeend', ICONS[icon]);
      b.appendChild(h('span', 'nm', label));
      if (o.meta) b.appendChild(h('span', 'meta', o.meta));
      if (o.title) b.title = o.title;
      if (o.click) b.addEventListener('click', o.click);
      if (o.dbl) b.addEventListener('dblclick', o.dbl);
      if (o.ctx) b.addEventListener('contextmenu', e => { e.preventDefault(); o.ctx(e); });
      // items can be dragged onto the rack, the playlist or the mixer
      if (o.drag) {
        b.draggable = true;
        b.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-ritmo', JSON.stringify(o.drag)); e.dataTransfer.effectAllowed = 'copy'; });
      }
      // favourites: a star on the right of the row
      if (o.star) {
        const on = Browser.isStarred(o.star.key), st = h('span', 'star' + (on ? ' on' : ''), on ? '★' : '☆');
        st.title = on ? T('Togli dai preferiti') : T('Aggiungi ai preferiti');
        st.addEventListener('click', e => { e.stopPropagation(); Browser.toggleStar(o.star); });
        b.appendChild(st);
      }
      box.appendChild(b);
      return b;
    };
    this._add = add;
    const folder = (key, depth, label, fill, icon = 'folder', tone = null) => {
      const open = ui.treeOpen.includes(key);
      add('folder', depth, icon, label, {
        open, tone,
        click: () => {
          ui.treeOpen = open ? ui.treeOpen.filter(k => k !== key) : ui.treeOpen.concat(key);
          savePrefs();
          this.render();
        },
      });
      if (open) fill(depth + 1);
    };
    const note = (depth, text) => { const n = h('div', 'tree-note', text); n.style.setProperty('--d', depth); box.appendChild(n); };
    const FILE_ICON = { audio: 'wave', midi: 'midi', project: 'song', other: 'preset' };
    const fileRow = (e, depth) => {
      const key = Files.key(e.root, e.rel), kind = fileKind(e.name);
      add('item', depth, FILE_ICON[kind], e.name, {
        sel: Preview.current && Files.key(Preview.current.root, Preview.current.rel) === key,
        title: kind === 'audio' ? T('Clic: ascolta · doppio clic: nel canale selezionato · trascina sul rack, sulla Playlist o su un canale') : e.name,
        click: () => { openEntry(e); this.render(); },
        dbl: () => { if (kind !== 'audio') return; const ch = chById(ui.selCh); if (ch && ch.type === 'sampler') entryToChannel(e, ch); else entryToNewChannel(e); },
        ctx: ev => Browser.fileMenu(e, ev.clientX, ev.clientY),
        drag: kind === 'audio' ? { kind: 'file', entry: e } : null,
        star: { key, name: e.name, entry: e },
      });
    };
    const diskFolder = (rootId, rel, dirPath, depth) => {
      const entries = Files.cache.get(Files.key(rootId, rel));
      if (!entries) { Files.request(rootId, rel, dirPath); note(depth, T('Lettura della cartella…')); return; }
      if (!entries.length) note(depth, T('Cartella vuota'));
      entries.slice(0, 3000).forEach(e => {
        if (e.dir) folder('disk:' + Files.key(rootId, e.rel), depth, e.name, d => diskFolder(rootId, e.rel, e.path, d));
        else fileRow(e, depth);
      });
      if (entries.length > 3000) note(depth, T('Mostrati i primi 3000 elementi: usa la ricerca per gli altri.'));
    };

    // Search results replace the tree while the search box has text.
    const r = Browser.results;
    if (r) {
      const none = !r.inst.length && !r.fx.length && !r.plugins.length && !r.presets.length && !r.files.length && !r.project.length;
      if (none) note(0, T('Nessun risultato per “{0}”.', Browser.query));
      if (r.project.length) { add('folder', 0, 'project', T('Progetto corrente'), { open: true, tone: 'project' }); r.project.forEach(x => (x.kind === 'ch'
        ? add('item', 1, null, x.ch.name, { color: x.ch.color, click: () => { Rack.select(x.ch.id); openEditor(x.ch.id); } })
        : add('item', 1, null, x.p.name, { color: x.p.color, click: () => selectPattern(x.p.id) }))); }
      if (r.inst.length) { add('folder', 0, 'plug', T('Generatori'), { open: true, tone: 'plugins' }); r.inst.forEach(t => add('item', 1, 'inst', INSTRUMENTS[t].label, { click: () => (t === 'sampler' ? pickAudioFiles() : addChannel(t, {}, true)), drag: { kind: 'inst', type: t } })); }
      if (r.fx.length) { add('folder', 0, 'plug', T('Effetti'), { open: true, tone: 'presets' }); r.fx.forEach(t => add('item', 1, 'fx', FXDEFS[t].label, { click: () => addEffect(t), drag: { kind: 'fx', type: t } })); }
      if (r.plugins.length) { add('folder', 0, 'plug', T('Plugin'), { open: true, tone: 'plugins' }); r.plugins.forEach(pl => add('item', 1, pl.isInstrument ? 'inst' : 'fx', pl.name, { meta: pl.format, click: () => (pl.isInstrument ? NativePlugins.addInstrument(pl) : NativePlugins.addEffect(pl)), drag: { kind: 'plugin', plugin: pl } })); }
      if (r.presets.length) { add('folder', 0, 'preset', T('Preset'), { open: true, tone: 'presets' }); r.presets.forEach(pr => presetRow(pr, 1)); }
      if (r.files.length) { add('folder', 0, 'recent', T('File'), { open: true, tone: 'recent' }); r.files.forEach(e => fileRow(e, 1)); }
      box.scrollTop = 0;
      return;
    }


    folder('project', 0, T('Progetto corrente'), d => {
      folder('project/patterns', d, T('Pattern'), d2 => proj.patterns.forEach(p => add('item', d2, null, p.name, {
        color: p.color, sel: p.id === curPat().id, meta: T('{0} bt', patLen(p) / spb()), title: T('Clic: seleziona — doppio clic: rinomina'),
        click: () => selectPattern(p.id), dbl: () => renamePattern(p), ctx: e => patternMenu(p, e.clientX, e.clientY),
      })));
      folder('project/channels', d, T('Canali'), d2 => proj.channels.forEach(ch => add('item', d2, null, ch.name, {
        color: ch.color, sel: ch.id === ui.selCh, meta: INSTRUMENTS[ch.type].glyph, title: INSTRUMENTS[ch.type].label,
        click: () => { Rack.select(ch.id); openEditor(ch.id); }, ctx: e => channelMenu(ch, e.clientX, e.clientY),
      })));
      folder('project/automation', d, T('Automazioni'), d2 => {
        if (!proj.automation.length) note(d2, T('Clic destro su una manopola › Crea clip di automazione.'));
        proj.automation.forEach(a => add('item', d2, 'auto', a.name, {
          color: a.color, title: T('Clic: apri l\'editor della curva — trascinala nella Playlist'), click: () => AutoEditor.open(a.id),
        }));
      });
      add('item', d, 'mixer', T('Mixer'), { click: () => WM.open('mixer') });
    }, 'project', 'project');
    const starred = ui.starred || [];
    if (starred.length) folder('starred', 0, T('Preferiti'), d => starred.forEach(st => (st.entry ? fileRow(st.entry, d) : null)), 'star', 'project');
    folder('disk', 0, T('Cartelle'), d => {
      Files.roots.forEach(root => {
        const rkey = 'disk:' + Files.key(root.id, '');
        const open = ui.treeOpen.includes(rkey);
        add('folder', d, 'folder', root.name, {
          open, title: root.id,
          click: () => { ui.treeOpen = open ? ui.treeOpen.filter(k => k !== rkey) : ui.treeOpen.concat(rkey); savePrefs(); this.render(); },
          ctx: e => openMenu(e.clientX, e.clientY, [{ title: root.name }, { label: T('Aggiorna il contenuto'), action: () => { [...Files.cache.keys()].forEach(k => { if (k.startsWith(root.id + '|')) Files.cache.delete(k); }); Files.indexes.delete(root.id); this.render(); } }, { label: T('Togli dal browser'), danger: true, action: () => Files.remove(root) }]),
        });
        if (open) diskFolder(root.id, '', root.id, d + 1);
      });
      add('item', d, 'plus', T('Aggiungi una cartella…'), { click: () => Files.add(), title: T('Una cartella di campioni, loop o kit: resta nel browser anche alla prossima apertura') });
      if (!Files.roots.length) note(d, Files.mode === 'input' ? T('In questo browser la cartella resta disponibile solo fino alla chiusura della pagina.') : T('Aggiungi le cartelle dove tieni campioni e loop.'));
    }, 'recent', 'recent');
    folder('presets', 0, T('Preset'), d => {
      [['channel', T('Preset dei canali')], ['effect', T('Preset degli effetti')], ['mixer', T('Stati delle tracce del mixer')]].forEach(([kind, label]) => folder('presets/' + kind, d, label, d2 => {
        const list = Presets.of(kind);
        if (!list.length) note(d2, kind === 'channel' ? T('Clic destro su un canale › Salva preset del canale.') : kind === 'effect' ? T('Menu dello slot › Salva preset.') : T('Clic destro su una traccia del mixer › Salva lo stato.'));
        list.forEach(pr => presetRow(pr, d2));
      }, 'preset', 'presets'));
    }, 'preset', 'presets');
    folder('recent', 0, T('Progetti demo'), d => {
      add('item', d, 'song', T('Mezzanotte (demo)'), { click: loadDemo });
      add('item', d, 'plus', T('Progetto vuoto'), { click: newProject });
      add('item', d, 'folder', T('Apri un progetto…'), { click: openProjectDialog });
    }, 'recent', 'recent');
    folder('instruments', 0, T('Generatori'), d => {
      const groups = {};
      Object.entries(INSTRUMENTS).forEach(([t, def]) => { if (!def.hidden) (groups[def.group] = groups[def.group] || []).push([t, def]); });
      Object.entries(groups).forEach(([g, list]) => folder('instruments/' + g, d, T(g), d2 => list.forEach(([t, def]) => add('item', d2, 'inst', def.label, {
        meta: def.glyph, title: t === 'sampler' ? T('Carica un file audio in un nuovo canale') : T('Aggiungi {0} al Channel Rack (o trascinalo su un canale per sostituirlo)', def.label),
        click: () => (t === 'sampler' ? pickAudioFiles() : addChannel(t, {}, true)), drag: t === 'sampler' ? null : { kind: 'inst', type: t },
      }))));
    }, 'plug', 'plugins');
    folder('effects', 0, T('Effetti'), d => {
      note(d, T('Clic: aggiunge l\'effetto alla traccia selezionata del mixer ({0}).', mixerName(ui.selMix)));
      Object.entries(FXDEFS).forEach(([k, def]) => { if (!def.hidden) add('item', d, 'fx', def.label, { click: () => addEffect(k), drag: { kind: 'fx', type: k } }); });
    }, 'plug', 'presets');
    folder('scores', 0, T('Partiture'), d => {
      add('item', d, 'score', T('Score Logger: recupera ciò che hai suonato'), { click: () => ScoreLog.dump() });
      add('item', d, 'midi', T('Importa MIDI…'), { click: pickMidiFile });
    }, 'score', 'scores');
    folder('samples', 0, T('Campioni'), d => {
      add('item', d, 'plus', T('Carica file audio…'), { click: () => pickAudioFiles() });
      Object.entries(SAMPLES).forEach(([id, s]) => add('item', d, 'wave', s.name, {
        meta: s.buffer.duration.toFixed(1) + ' s', title: T('Clic: nuovo canale Sampler con questo campione'),
        click: () => addChannel('sampler', { name: s.name.replace(/\.[^.]+$/, '').slice(0, 30), sample: id }, true),
      }));
    }, 'pack');
    folder('midi', 0, T('Dispositivi MIDI'), d => {
      add('item', d, 'midi', T('Collega tastiera MIDI'), { click: connectMidi });
      note(d, midiStatus);
    });
    if (window.TreeExtras) window.TreeExtras({ add, folder, note });
    add('folder', 0, 'help', T('Scorciatoie e aiuto'), { click: () => WM.open('help') });
    box.scrollTop = keep;
  },
};

/* ---------- Menu bar ---------- */
function prCmd(code, key) {
  WM.open('piano');
  const done = PR.key({ code, key: key || '', ctrlKey: code.startsWith('Key'), metaKey: false, shiftKey: false });
  if (!done) toast(T('Seleziona prima delle note nel Piano Roll'));
}
const MENUS = {
  file: () => [
    { label: T('Nuovo progetto'), action: newProject },
    { label: T('Apri progetto demo'), action: loadDemo },
    { label: T('Apri…'), key: 'Ctrl+O', action: openProjectDialog },
    { label: T('Salva'), key: 'Ctrl+S', action: saveProject },
    { label: T('Progetti precedenti'), disabled: !readBackups().length, sub: readBackups().map(b => ({
      label: T('{0} · {1} canali · {2}', b.name, b.channels, new Date(b.at).toLocaleString(uiLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
      action: () => restoreBackup(b),
    })) },
    '-',
    { label: T('Importa file audio…'), action: () => pickAudioFiles() },
    { label: T('Importa MIDI…'), action: pickMidiFile },
    '-',
    { label: T('Esporta audio (WAV, FLAC, OGG, tracce)…'), key: 'Ctrl+R', action: exportWav },
    { label: T('Esporta MIDI…'), action: exportMidi },
  ],
  edit: () => [
    { label: T('Annulla'), key: 'Ctrl+Z', disabled: !Hist.undoStack.length, action: () => Hist.undo() },
    { label: T('Ripeti'), key: 'Ctrl+Y', disabled: !Hist.redoStack.length, action: () => Hist.redo() },
    '-',
    { label: T('Seleziona tutte le note'), key: 'Ctrl+A', action: () => prCmd('KeyA') },
    { label: T('Copia note'), key: 'Ctrl+C', action: () => prCmd('KeyC') },
    { label: T('Incolla note'), key: 'Ctrl+V', action: () => prCmd('KeyV') },
    { label: T('Duplica note'), key: 'Ctrl+D', action: () => prCmd('KeyD') },
    { label: T('Elimina note selezionate'), key: T('Canc'), action: () => prCmd('Delete', 'Delete') },
  ],
  add: () => {
    const items = [];
    let group = '';
    for (const [type, def] of Object.entries(INSTRUMENTS)) {
      if (def.hidden) continue;
      if (def.group !== group) { group = def.group; items.push({ title: T(group) }); }
      items.push({ label: type === 'sampler' ? T('Sampler da file audio…') : def.label, action: () => (type === 'sampler' ? pickAudioFiles() : addChannel(type, {}, true)) });
    }
    if (window.NativePlugins) items.push('-', { label: T('Plugin VST3 / AU / CLAP… (dal browser)'), action: () => { ui.treeOpen = ui.treeOpen.concat('plugins'); Tree.render(); toast(T('Scegli un plugin nella cartella Plugin del browser')); } });
    return items;
  },
  patterns: () => {
    const i = proj.patterns.indexOf(curPat());
    return [
      { label: T('Nuovo pattern'), action: addPattern },
      { label: T('Clona pattern'), action: () => clonePattern() },
      { label: T('Rinomina pattern'), action: () => renamePattern(curPat()) },
      { label: T('Colore successivo'), color: COLORS[(COLORS.indexOf(curPat().color) + 1) % COLORS.length], action: () => nextPatternColor(curPat()) },
      '-',
      { label: T('Pattern precedente'), disabled: i <= 0, action: () => stepPattern(-1) },
      { label: T('Pattern successivo'), disabled: i >= proj.patterns.length - 1, action: () => stepPattern(1) },
      '-',
      { label: T('Elimina pattern'), danger: true, disabled: proj.patterns.length < 2, action: () => deletePattern(curPat()) },
    ];
  },
  view: () => [
    { label: T('Playlist in primo piano'), key: 'F5', action: () => WM.blur() },
    { label: T('Channel Rack'), key: 'F6', checked: WM.isOpen('rack'), action: () => WM.toggle('rack') },
    { label: T('Piano Roll'), key: 'F7', checked: WM.isOpen('piano'), action: () => WM.toggle('piano') },
    { label: T('Mixer'), key: 'F9', checked: WM.isOpen('mixer'), action: () => WM.toggle('mixer') },
    { label: T('Browser'), key: 'Alt+F8', checked: ui.browser, action: toggleBrowser },
    { label: T('Impostazioni del canale'), disabled: !ui.selCh, action: () => openEditor(ui.selCh) },
    '-',
    { label: T('Ripristina disposizione finestre'), action: () => WM.resetLayout() },
  ],
  options: () => [
    { label: T('Lingua') + ' · ' + (LANGUAGES.find(l => l[0] === I18N.lang) || ['', 'Italiano'])[1], sub: LANGUAGES.map(([code, name]) => ({ label: name, checked: code === I18N.lang, action: () => { if (code !== I18N.lang) { toast(T('Cambio lingua…')); setLanguage(code); } } })) },
    '-',
    { label: T('Metronomo'), checked: ui.metro, action: () => { ui.metro = !ui.metro; renderTop(); savePrefs(); } },
    { label: T('Metro del progetto: {0}/{1}', proj.ts.num, proj.ts.den), sub: metreMenuItems() },
    { label: T('Arrangiamenti'), sub: [
      ...proj.arrangements.map(a => ({ label: a.name, checked: a.id === proj.arrId, action: () => switchArrangement(a.id) })),
      '-',
      { label: T('Nuovo arrangiamento'), action: () => newArrangement(false) },
      { label: T('Clona l\'arrangiamento'), action: () => newArrangement(true) },
    ] },
    { label: T('Tastiera del computer come pianoforte'), checked: ui.typing, action: toggleTyping },
    { label: T('Ottava della tastiera più bassa'), key: '−', action: () => shiftOctave(-12) },
    { label: T('Ottava della tastiera più alta'), key: '+', action: () => shiftOctave(12) },
    '-',
    { label: T('Registrazione armata'), checked: ui.rec, action: toggleRec },
    { label: T('Registra note (tastiera e MIDI nel pattern)'), checked: ui.recMode !== 'audio', action: () => setRecMode('notes') },
    { label: T('Registra audio (ingresso nella Playlist)'), checked: ui.recMode === 'audio', action: () => setRecMode('audio') },
    '-',
    { label: T('Impostazioni audio…'), action: () => AudioSettings.open() },
    { label: T('Collega tastiera MIDI'), action: connectMidi },
  ],
  tools: () => {
    const ch = chById(ui.selCh);
    return [
      { label: T('Loop Starter…'), action: () => LoopStarter.open() },
      { label: T('Chord Progression Tool…'), action: () => ChordTool.open() },
      { label: T('Rilevamento accordi'), checked: WM.isOpen('chords'), action: () => WM.toggle('chords') },
      { label: T('Score Logger: recupera le note suonate'), disabled: !ch, action: () => ScoreLog.dump() },
      { label: T('Audio Logger: salva gli ultimi 60 secondi'), action: saveAudioLog },
      '-',
      { label: T('Quantizza note'), action: () => { WM.open('piano'); PR.quantize(); } },
      { label: T('Riempi ogni 2 passi'), disabled: !ch, action: () => fillSteps(ch, 2) },
      { label: T('Riempi ogni 4 passi'), disabled: !ch, action: () => fillSteps(ch, 4) },
      { label: T('Svuota il canale nel pattern'), disabled: !ch, action: () => clearChannel(ch) },
      '-',
      { label: T('Torna all\'inizio del brano'), action: () => { Transport.stop(); ui.songPos = 0; onTransportChange(); } },
    ];
  },
  help: () => [
    { label: T('Finestra di benvenuto'), action: () => Welcome.open() },
    { label: T('Scorciatoie e aiuto'), action: () => WM.open('help') },
    { label: T('Informazioni su Ritmo Studio'), action: () => toast(T('Ritmo Studio {0} · DAW gratuita e open source · nessuna affiliazione con Image-Line', '1.5')) },
  ],
};
let openMenuKey = null;
function showMainMenu(btn) {
  const key = btn.dataset.menu;
  $$('.menu-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  btn.setAttribute('aria-expanded', 'true');
  openMenuKey = key;
  menuAt(btn, MENUS[key](), () => { btn.setAttribute('aria-expanded', 'false'); if (openMenuKey === key) openMenuKey = null; });
}

/* ---------- Transport and view helpers ---------- */
function setMode(mode) {
  ui.mode = mode;
  renderTop();
  hint(mode === 'song' ? T('SONG: suona la playlist') : T('PAT: suona il pattern “{0}”', curPat().name));
  Transport.restart();
  PL.draw();
  PR.draw();
}
function onTransportChange() {
  renderTop();
  if (!Transport.playing) Rack.showColumn(-1);
  PL.draw();
  PR.draw();
}
function afterNotesChanged() {
  Rack.render();
  Tree.render();
  PR.draw();
  PL.draw();
}
function onProjectReplaced() {
  if (!proj.patterns.some(p => p.id === ui.selPat)) ui.selPat = proj.patterns[0].id;
  if (!chById(ui.selCh)) ui.selCh = proj.channels[0] ? proj.channels[0].id : null;
  if (ui.editCh && !chById(ui.editCh)) WM.close('inst');
  ui.selMix = clamp(ui.selMix, 0, numInserts());
  PR.sel.clear();
  PL.sel.clear();
  rebuildEngine();
  renderAll();
}
function toggleTyping() { ui.typing = !ui.typing; renderTop(); savePrefs(); hint(ui.typing ? T('Tastiera del computer: suona il canale selezionato') : T('Tastiera del computer: disattivata come pianoforte')); }
function toggleRec() {
  ui.rec = !ui.rec;
  renderTop();
  hint(!ui.rec ? T('Registrazione disattivata')
    : ui.recMode === 'audio' ? T('Registrazione audio armata: premi Play, registra l\'ingresso sulla traccia del mixer selezionata')
      : T('Registrazione armata: avvia in PAT e suona con la tastiera o il MIDI'));
}
function setRecMode(m) {
  ui.recMode = m;
  savePrefs();
  renderTop();
  hint(m === 'audio' ? T('Il tasto Rec registra l\'ingresso audio in una clip della Playlist') : T('Il tasto Rec registra le note nel pattern'));
}
function shiftOctave(d) { ui.kbOct = clamp(ui.kbOct + d, 12, 84); hint(T('Tastiera del computer: da {0} a {1}', noteName(ui.kbOct), noteName(ui.kbOct + 28))); }

/* ---------- Channels ---------- */
function addChannel(type, opts = {}, audition = false) {
  const used = new Set(proj.channels.map(c => c.mixer));
  let mixer = 0;
  for (let i = 1; i <= numInserts(); i++) if (!used.has(i)) { mixer = i; break; }
  const ch = newChannel(type, { mixer, color: COLORS[proj.channels.length % COLORS.length], ...opts });
  proj.channels.push(ch);
  if (mixer && isDefaultInsertName(proj.mixer[mixer].name)) proj.mixer[mixer].name = ch.name;
  ui.selCh = ch.id;
  commit();
  if (!WM.isOpen('rack')) WM.open('rack');
  renderAll();
  $('#rack-rows').scrollTop = 1e6;
  if (audition) {
    audioReady();
    const v = engine.noteOn(ch, ch.root, 0.8);
    setTimeout(() => engine.noteOff(v), 350);
  }
  hint(T('Aggiunto {0} → mixer {1}', ch.name, mixerName(mixer)));
  return ch;
}
function cloneChannel(ch) {
  const c = JSON.parse(JSON.stringify(ch));
  c.id = uid();
  c.name = ch.name + ' 2';
  proj.channels.splice(proj.channels.indexOf(ch) + 1, 0, c);
  ui.selCh = c.id;
  commit();
  renderAll();
}
function deleteChannel(ch) {
  const i = proj.channels.indexOf(ch);
  proj.channels.splice(i, 1);
  proj.patterns.forEach(p => { delete p.notes[ch.id]; });
  engine && engine.removeChan(ch.id);
  if (ui.selCh === ch.id) ui.selCh = (proj.channels[i] || proj.channels[i - 1] || {}).id || null;
  if (ui.editCh === ch.id) WM.close('inst');
  commit();
  renderAll();
  toast(T('{0} eliminato. Ctrl+Z per annullare.', ch.name));
}
function moveChannel(ch, d) {
  const i = proj.channels.indexOf(ch), j = i + d;
  if (j < 0 || j >= proj.channels.length) return;
  proj.channels.splice(i, 1);
  proj.channels.splice(j, 0, ch);
  commit();
  renderAll();
}
function fillSteps(ch, every) {
  const p = curPat(), old = p.notes[ch.id] || [], m = old.length ? old[0].m : ch.root;
  p.notes[ch.id] = [];
  for (let i = 0; i < p.len; i += every) p.notes[ch.id].push({ s: i, l: 1, m, v: 0.8 });
  commit();
  afterNotesChanged();
}
function clearChannel(ch) {
  delete curPat().notes[ch.id];
  PR.sel.clear();
  commit();
  afterNotesChanged();
}
function addEffect(type) {
  const i = ui.selMix, t = proj.mixer[i], k = t.fx.findIndex(s => !s);
  WM.open('mixer');
  if (k < 0) { toast(T('Gli slot di {0} sono tutti occupati', mixerName(i))); return; }
  t.fx[k] = fxSlot(type);
  engine && engine.rebuildFx(i);
  commit();
  Mixer.render();
  toast(T('{0} aggiunto a {1}', FXDEFS[type].label, mixerName(i)));
}

/* ---------- Patterns ---------- */
function selectPattern(id, quiet) {
  ui.selPat = id;
  PR.sel.clear();
  renderTop();
  Tree.render();
  Rack.render();
  PL.renderHeads();
  PR.refreshToolbar();
  PR.draw();
  PL.draw();
  if (!quiet) hint(T('Pattern corrente: {0}', curPat().name));
}
function stepPattern(d) {
  const i = proj.patterns.indexOf(curPat()), j = clamp(i + d, 0, proj.patterns.length - 1);
  if (j !== i) selectPattern(proj.patterns[j].id);
}
function addPattern() {
  const p = newPattern(T('Pattern {0}', proj.patterns.length + 1), COLORS[proj.patterns.length % COLORS.length]);
  proj.patterns.push(p);
  commit();
  selectPattern(p.id);
}
function clonePattern(src = curPat()) {
  const p = JSON.parse(JSON.stringify(src));
  p.id = uid();
  p.name = T('{0} (copia)', src.name);
  p.color = COLORS[(COLORS.indexOf(src.color) + 1) % COLORS.length];
  proj.patterns.splice(proj.patterns.indexOf(src) + 1, 0, p);
  commit();
  selectPattern(p.id);
}
function deletePattern(p) {
  if (proj.patterns.length < 2) { toast(T('Il progetto deve avere almeno un pattern')); return; }
  const i = proj.patterns.indexOf(p);
  proj.patterns.splice(i, 1);
  proj.playlist.clips = proj.playlist.clips.filter(c => c.p !== p.id);
  if (ui.selPat === p.id) ui.selPat = (proj.patterns[i] || proj.patterns[i - 1]).id;
  commit();
  renderAll();
  toast(T('Pattern “{0}” eliminato. Ctrl+Z per annullare.', p.name));
}
function renamePattern(p) {
  const anchor = $(`.pl-pat[data-id="${p.id}"]`) || $('#pat-select');
  inlineEdit(anchor, p.name, v => { p.name = v; commit(); renderAll(); });
}
function nextPatternColor(p) {
  p.color = COLORS[(COLORS.indexOf(p.color) + 1) % COLORS.length];
  commit();
  renderAll();
}
function patternMenu(p, x, y) {
  openMenu(x, y, [
    { title: p.name },
    { label: T('Rinomina'), action: () => renamePattern(p) },
    { label: T('Clona'), action: () => clonePattern(p) },
    { label: T('Colore successivo'), color: COLORS[(COLORS.indexOf(p.color) + 1) % COLORS.length], action: () => nextPatternColor(p) },
    { label: T('Apri nel Piano Roll'), action: () => { selectPattern(p.id); WM.open('piano'); } },
    '-',
    { label: T('Elimina pattern'), danger: true, disabled: proj.patterns.length < 2, action: () => deletePattern(p) },
  ]);
}

/* ---------- Channel settings window ---------- */
function openEditor(id) {
  if (!chById(id)) return;
  ui.editCh = id;
  renderEditor();
  WM.open('inst');
}
function closeEditor() { WM.close('inst'); }
// Channel settings, in tabs like a hardware sampler: the instrument, the sample, envelopes and filter, LFO, and
// the settings every channel has (mixer track, voices, glide, choke groups, arpeggiator, note echo).
const ED_TABS = [['plug', T('Strumento')], ['smp', T('Campione'), true], ['env', T('Inviluppo'), true], ['lfo', 'LFO', true], ['misc', T('Varie')]];
function renderEditor() {
  const ch = chById(ui.editCh);
  if (!ch) { WM.close('inst'); return; }
  const def = INSTRUMENTS[ch.type], body = $('#inst-body'), sampler = ch.type === 'sampler';
  $('#ed-swatch').style.background = ch.color;
  if (document.activeElement !== $('#ed-name')) $('#ed-name').value = ch.name;
  body.textContent = '';
  let tab = ui.edTab || 'plug';
  if (!sampler && ['smp', 'env', 'lfo'].includes(tab)) tab = 'plug';
  const tabs = h('div', 'ed-tabs');
  tabs.setAttribute('role', 'tablist');
  ED_TABS.forEach(([id, label, smpOnly]) => {
    if (smpOnly && !sampler) return;
    const b = h('button', 'ed-tab' + (id === tab ? ' on' : ''), label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(id === tab));
    b.addEventListener('click', () => { ui.edTab = id; renderEditor(); });
    tabs.appendChild(b);
  });
  body.appendChild(tabs);
  const page = h('div', 'ed-page');
  body.appendChild(page);
  const knobFor = (k, size = 34) => {
    const spec = def.params[k];
    return knob({
      spec, value: ch.params[k], size, showLabel: true, showValue: true,
      onInput: v => { ch.params[k] = v; if (sampler) SampleView.redraw(); }, onCommit: commit,
      auto: { kind: 'chParam', ch: ch.id, key: k }, bind: () => (chById(ch.id) === ch ? ch.params[k] : null),
    });
  };
  const selFor = k => {
    const spec = def.params[k], lab = h('label', 'sel-param', spec.label), sel = h('select');
    sel.id = 'ed-' + k;
    spec.options.forEach(([v, l]) => sel.appendChild(new Option(l, v)));
    sel.value = ch.params[k];
    sel.addEventListener('change', () => { ch.params[k] = sel.value; commit(); if (sampler) SampleView.redraw(); });
    lab.appendChild(sel);
    return lab;
  };
  const grid = (keys, cls = 'param-grid') => {
    const g = h('div', cls);
    keys.forEach(k => g.appendChild(def.params[k].select ? selFor(k) : knobFor(k)));
    return g;
  };
  const section = (title, ...nodes) => { const sct = h('div', 'ed-section'); sct.appendChild(h('div', 'ed-field', title)); nodes.forEach(n => sct.appendChild(n)); return sct; };

  if (tab === 'plug') {
    page.appendChild(h('div', 'ed-type', def.label));
    if (sampler) page.appendChild(SampleView.box(ch));
    if (ch.type === 'plugin') page.appendChild(pluginBox('ch:' + ch.id, ch.plugin || {}, ch.name));
    const keys = Object.keys(def.params).filter(k => !def.params[k].tab && !(sampler && ['norm', 'loop', 'ftype', 'lshape'].includes(k)));
    if (keys.length) page.appendChild(grid(keys));
    const kf = h('div', 'ed-field', T('Prova lo strumento'));
    kf.appendChild(miniKeyboard(ch));
    page.appendChild(kf);
  } else if (tab === 'smp') {
    page.appendChild(SampleView.box(ch, true));
    page.appendChild(section(T('Regione e dissolvenze'), grid(['start', 'end', 'fin', 'fout']), grid(['norm'], 'param-grid')));
    page.appendChild(section(T('Loop'), grid(['loop', 'ls', 'le'])));
    page.appendChild(h('p', 'tool-intro', T('Trascina i segni sulla forma d\'onda: verde inizio, rosso fine, arancio il loop. Con il loop attivo il suono dura quanto la nota.')));
  } else if (tab === 'env') {
    const cv = h('canvas', 'env-view');
    page.appendChild(section(T('Volume (attacco, tenuta, decadimento, sustain, rilascio)'), cv, grid(['a', 'h', 'd', 's', 'r'])));
    requestAnimationFrame(() => drawEnvelope(cv, ch.params));
    page.appendChild(section(T('Filtro'), grid(['ftype', 'fcut', 'fres', 'fenv', 'fa', 'fd', 'fs'])));
    page.appendChild(section(T('Intonazione'), grid(['penv', 'pd'])));
  } else if (tab === 'lfo') {
    page.appendChild(section(T('LFO (riparte a ogni nota)'), grid(['lshape', 'lrate', 'lvol', 'lpan', 'lcut', 'lpit'])));
    page.appendChild(h('p', 'tool-intro', T('Volume: tremolo · Pan: movimento stereo · Filtro: richiede un filtro attivo nella scheda Inviluppo · Intonazione: vibrato in semitoni.')));
  } else {
    page.appendChild(miscPage(ch));
  }
}

// The "Varie" tab, shared by every channel type.
function miscPage(ch) {
  const page = h('div', 'ed-misc');
  const changed = () => { normalizeChannelMode(ch); engine && engine.updateChan(ch); commit(); };
  const row = (label, ctl) => { const l = h('label', 'ed-line'); l.append(h('span', null, label), ctl); return l; };
  const select = (id, value, options, onChange) => {
    const sl = h('select');
    sl.id = id;
    options.forEach(([v, l]) => sl.appendChild(new Option(l, v)));
    sl.value = String(value);
    sl.addEventListener('change', () => onChange(sl.value));
    return sl;
  };
  const check = (id, value, onChange) => {
    const c = h('input');
    c.type = 'checkbox';
    c.id = id;
    c.checked = !!value;
    c.addEventListener('change', () => onChange(c.checked));
    return c;
  };
  const group = title => { const g = h('div', 'ed-section'); g.appendChild(h('div', 'ed-field', title)); page.appendChild(g); return g; };

  const io = group(T('Uscita'));
  io.appendChild(row(T('Traccia del mixer'), select('ed-mixer', ch.mixer, Array.from({ length: numInserts() + 1 }, (_, i) => [i, mixerName(i)]), v => { ch.mixer = +v; engine && engine.updateChan(ch); commit(); Rack.render(); })));
  io.appendChild(row(T('Nota dei passi'), select('ed-root', ch.root, Array.from({ length: 73 }, (_, k) => [k + 24, noteName(k + 24)]), v => {
    const old = ch.root;
    ch.root = +v;
    proj.patterns.forEach(p => (p.notes[ch.id] || []).forEach(n => { if (n.m === old) n.m = ch.root; }));
    commit();
    afterNotesChanged();
  })));

  const voices = group(T('Voci'));
  voices.appendChild(row(T('Monofonico'), check('ed-mono', ch.mono, v => { ch.mono = v; changed(); })));
  const porta = knob({
    spec: { label: T('Portamento'), min: 0, max: 2, def: 0, unit: 's' }, value: ch.porta, size: 30, showLabel: true, showValue: true,
    onInput: v => { ch.porta = v; }, onCommit: () => changed(),
  });
  voices.appendChild(porta);
  const groups = [[0, T('Nessuno')], ...Array.from({ length: 16 }, (_, k) => [k + 1, T('Gruppo {0}', k + 1)])];
  voices.appendChild(row(T('Gruppo di taglio'), select('ed-cutgroup', ch.cutGroup, groups, v => { ch.cutGroup = +v; changed(); })));
  voices.appendChild(row(T('Tagliato dal gruppo'), select('ed-cutby', ch.cutBy, groups, v => { ch.cutBy = +v; changed(); })));
  voices.appendChild(h('p', 'tool-intro', T('Esempio: hi-hat chiuso nel gruppo 1, hi-hat aperto “tagliato dal gruppo 1”: il chiuso zittisce l\'aperto.')));

  const TIMES = [[0.5, '1/32'], [0.667, T('1/16 terzina')], [1, '1/16'], [1.333, T('1/8 terzina')], [2, '1/8'], [3, T('1/8 puntato')], [4, '1/4'], [8, '1/2'], [16, T('1 battuta')]];
  const arp = group(T('Arpeggiatore'));
  arp.appendChild(row(T('Attivo'), check('ed-arp', ch.arp.on, v => { ch.arp.on = v; changed(); afterNotesChanged(); })));
  arp.appendChild(row(T('Direzione'), select('ed-arp-dir', ch.arp.dir, [['up', T('Su')], ['down', T('Giù')], ['updown', T('Su e giù')], ['downup', T('Giù e su')], ['random', T('Casuale')]], v => { ch.arp.dir = v; changed(); })));
  arp.appendChild(row(T('Ottave'), select('ed-arp-range', ch.arp.range, [[1, '1'], [2, '2'], [3, '3'], [4, '4']], v => { ch.arp.range = +v; changed(); })));
  arp.appendChild(row(T('Passo'), select('ed-arp-time', ch.arp.time, TIMES, v => { ch.arp.time = +v; changed(); })));
  arp.appendChild(row(T('Ripeti ogni nota'), select('ed-arp-rep', ch.arp.rep, [1, 2, 3, 4, 6, 8].map(n => [n, n + '×']), v => { ch.arp.rep = +v; changed(); })));
  arp.appendChild(knob({ spec: { label: T('Durata note'), min: 0.05, max: 1, def: 0.5, unit: '%' }, value: ch.arp.gate, size: 30, showLabel: true, showValue: true, onInput: v => { ch.arp.gate = v; }, onCommit: () => changed() }));

  const echo = group(T('Eco delle note'));
  echo.appendChild(row(T('Attivo'), check('ed-echo', ch.echo.on, v => { ch.echo.on = v; changed(); })));
  echo.appendChild(row(T('Ripetizioni'), select('ed-echo-count', ch.echo.count, Array.from({ length: 16 }, (_, k) => [k + 1, String(k + 1)]), v => { ch.echo.count = +v; changed(); })));
  echo.appendChild(row(T('Distanza'), select('ed-echo-time', ch.echo.time, TIMES, v => { ch.echo.time = +v; changed(); })));
  echo.appendChild(row(T('Intonazione per eco'), select('ed-echo-pitch', ch.echo.pitch, Array.from({ length: 25 }, (_, k) => [k - 12, (k > 12 ? '+' : '') + (k - 12) + ' st']), v => { ch.echo.pitch = +v; changed(); })));
  echo.appendChild(knob({ spec: { label: T('Ritorno'), min: 0, max: 1, def: 0.6, unit: '%' }, value: ch.echo.fb, size: 30, showLabel: true, showValue: true, onInput: v => { ch.echo.fb = v; }, onCommit: () => changed() }));

  const cf = group(T('Colore'));
  const sw = h('div', 'swatches');
  COLORS.forEach(c => {
    const b = h('button');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', T('Colore {0}', c));
    b.setAttribute('aria-pressed', String(ch.color === c));
    b.addEventListener('click', () => { ch.color = c; commit(); renderAll(); });
    sw.appendChild(b);
  });
  cf.appendChild(sw);

  const acts = h('div', 'ed-actions');
  const mk = (label, cls, fn) => { const b = h('button', 'tbtn small' + cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
  acts.append(
    mk(T('Piano Roll'), '', () => { Rack.select(ch.id); WM.open('piano'); }),
    mk(T('Salva preset'), '', () => saveChannelPreset(ch)),
    mk(T('Clona'), '', () => cloneChannel(ch)),
    mk(T('Elimina canale'), ' danger', () => deleteChannel(ch)),
  );
  page.appendChild(acts);
  return page;
}

// Envelope preview: attack, hold, decay to sustain, a held part, release.
function drawEnvelope(cv, p) {
  const W = cv.clientWidth || 320, H = 70, g = fitCanvas(cv, W, H);
  g.fillStyle = TH.lcd;
  g.fillRect(0, 0, W, H);
  const hold = 0.5, total = Math.max(0.2, p.a + p.h + Math.max(p.d, 0.001) * 1.5 + hold + p.r * 1.5), x = t => 6 + t / total * (W - 12), y = v => H - 6 - v * (H - 12);
  g.strokeStyle = TH.brass;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x(0), y(0));
  g.lineTo(x(p.a), y(1));
  g.lineTo(x(p.a + p.h), y(1));
  let t = p.a + p.h, lvl = 1;
  const dEnd = t + (p.d > 0 ? p.d * 1.5 : 0);
  for (let k = 1; k <= 20 && p.d > 0; k++) { const tt = t + (dEnd - t) * k / 20; lvl = p.s + (1 - p.s) * Math.exp(-(tt - t) / (p.d / 3)); g.lineTo(x(tt), y(lvl)); }
  t = dEnd + hold;
  g.lineTo(x(t), y(lvl));
  for (let k = 1; k <= 20; k++) { const tt = (p.r * 1.5) * k / 20; g.lineTo(x(t + tt), y(lvl * Math.exp(-tt / (p.r / 4)))); }
  g.stroke();
}

// Waveform of the sampler with draggable markers for start, end and the loop.
const SampleView = {
  cv: null, ch: null,
  box(ch, markers) {
    const box = h('div', 'sample-box'), smp = ch.sample && SAMPLES[ch.sample];
    box.appendChild(h('div', 'sample-name', smp ? smp.name + ' · ' + smp.buffer.duration.toFixed(2) + ' s' : T('Nessun campione: trascina qui un suono dal browser o usa Carica')));
    const cv = h('canvas', 'sample-wave');
    box.appendChild(cv);
    this.cv = cv;
    this.ch = ch;
    this.markers = !!markers;
    if (markers && smp) {
      cv.style.cursor = 'ew-resize';
      cv.addEventListener('pointerdown', e => {
        const r = cv.getBoundingClientRect(), pos = k => ch.params[k] * r.width;
        const keys = ['start', 'end', ...(ch.params.loop !== 'off' ? ['ls', 'le'] : [])];
        let best = keys[0], bd = 1e9;
        keys.forEach(k => { const d = Math.abs(pos(k) - (e.clientX - r.left)); if (d < bd) { bd = d; best = k; } });
        cv.setPointerCapture(e.pointerId);
        const move = ev => { ch.params[best] = clamp((ev.clientX - r.left) / r.width, 0, 1); this.redraw(); hint(INSTRUMENTS.sampler.params[best].label + ': ' + Math.round(ch.params[best] * 100) + '%'); };
        const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); commit(); renderEditor(); };
        cv.addEventListener('pointermove', move);
        cv.addEventListener('pointerup', up);
        move(e);
      });
    }
    requestAnimationFrame(() => this.redraw());
    const acts = h('div', 'ed-actions'), b = h('button', 'tbtn small', smp ? T('Sostituisci campione') : T('Carica campione'));
    b.type = 'button';
    b.addEventListener('click', () => pickAudioFiles(ch));
    acts.appendChild(b);
    box.appendChild(acts);
    return box;
  },
  redraw() {
    const cv = this.cv, ch = this.ch;
    if (!cv || !cv.isConnected || !ch) return;
    const smp = ch.sample && SAMPLES[ch.sample], W = cv.clientWidth || 300, H = this.markers ? 90 : 64, g = fitCanvas(cv, W, H), p = ch.params;
    g.fillStyle = TH.lcd;
    g.fillRect(0, 0, W, H);
    if (!smp) return;
    const pk = samplePeaks(smp), rev = p.rev === 'rev';
    g.fillStyle = ch.color;
    for (let x = 0; x < W; x++) {
      const i = Math.floor((rev ? W - 1 - x : x) / W * pk.data.length), a = (pk.data[i] || 0) * (H / 2 - 2);
      g.fillRect(x, H / 2 - a, 1, Math.max(1, a * 2));
    }
    // shade what is not played
    g.fillStyle = TH.outside;
    g.fillRect(0, 0, p.start * W, H);
    g.fillRect(p.end * W, 0, W - p.end * W, H);
    const mark = (v, color) => { g.fillStyle = color; g.fillRect(Math.round(v * W) - 1, 0, 2, H); };
    if (p.loop !== 'off') { g.fillStyle = TH.loopBand; g.fillRect(p.ls * W, 0, (p.le - p.ls) * W, H); mark(p.ls, TH.brass); mark(p.le, TH.brass); }
    mark(p.start, TH.signal);
    mark(p.end, TH.alert);
  },
};
function pluginBox(target, info, title) {
  const box = h('div', 'sample-box');
  box.appendChild(h('div', 'sample-name', [info.name, info.vendor, info.format].filter(Boolean).join(' · ') || T('Plugin')));
  if (window.NativePlugins) {
    const b = h('button', 'tbtn small', T('Apri interfaccia del plugin'));
    b.type = 'button';
    b.addEventListener('click', () => NativePlugins.open(target, title));
    const a = h('button', 'tbtn small', T('Automatizza un parametro…'));
    a.type = 'button';
    a.title = T('Crea una clip di automazione per un parametro del plugin');
    a.addEventListener('click', () => NativePlugins.paramMenu(target, info.name || title));
    const row = h('div', 'ed-actions');
    row.append(b, a);
    box.appendChild(row);
  } else {
    box.appendChild(h('div', 'tree-note', T('I plugin VST3, AU e CLAP suonano solo nell\'app desktop di Ritmo Studio.')));
  }
  return box;
}
function miniKeyboard(ch) {
  const kb = h('div', 'mini-kb'), base = 48, whites = [0, 2, 4, 5, 7, 9, 11], blacks = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];
  for (let o = 0; o < 2; o++) whites.forEach(s => { const k = h('div', 'wk'); k.dataset.m = base + o * 12 + s; kb.appendChild(k); });
  for (let o = 0; o < 2; o++) blacks.forEach(([s, wi]) => {
    const k = h('div', 'bk');
    k.dataset.m = base + o * 12 + s;
    k.style.left = `calc(${((o * 7 + wi + 1) / 14) * 100}% - 2.2%)`;
    k.style.width = '4.4%';
    kb.appendChild(k);
  });
  let cur = null, voice = null;
  const keyAt = e => { const t = document.elementFromPoint(e.clientX, e.clientY); return t && t.closest && t.closest('.mini-kb [data-m]'); };
  const press = k => {
    if (k === cur) return;
    if (cur) { cur.classList.remove('down'); engine.noteOff(voice); }
    cur = k;
    voice = null;
    if (k) { k.classList.add('down'); voice = engine.noteOn(ch, +k.dataset.m, 0.8); hint(ch.name + ': ' + noteName(+k.dataset.m)); }
  };
  kb.addEventListener('pointerdown', e => { audioReady(); kb.setPointerCapture(e.pointerId); press(keyAt(e)); });
  kb.addEventListener('pointermove', e => { if (cur) press(keyAt(e)); });
  const end = () => press(null);
  kb.addEventListener('pointerup', end);
  kb.addEventListener('pointercancel', end);
  return kb;
}

/* ---------- Files ---------- */
let samplerTarget = null;
function pickAudioFiles(ch) {
  samplerTarget = ch || null;
  const inp = $('#file-audio');
  inp.multiple = !ch;
  inp.value = '';
  inp.click();
}
function openProjectDialog() { const i = $('#file-project'); i.value = ''; i.click(); }
async function addAudioFiles(files) {
  for (const f of files) {
    try {
      const id = await addSampleFromFile(f);
      if (samplerTarget && chById(samplerTarget.id)) {
        samplerTarget.sample = id;
        samplerTarget.name = f.name.replace(/\.[^.]+$/, '').slice(0, 30);
        commit();
        renderAll();
        samplerTarget = null;
      } else {
        addChannel('sampler', { name: f.name.replace(/\.[^.]+$/, '').slice(0, 30), sample: id }, true);
      }
    } catch (e) {
      toast(T('Impossibile leggere {0}: formato audio non supportato', f.name));
    }
  }
  samplerTarget = null;
}
function newProject() {
  Transport.stop();
  backupCurrentProject();
  proj = emptyProject(true);
  ui.songPos = 0;
  ui.mode = 'pattern';
  ui.selPat = proj.patterns[0].id;
  ui.selCh = proj.channels[0].id;
  onProjectReplaced();
  commit();
  if (!WM.isOpen('rack')) WM.open('rack');
  toast(T('Nuovo progetto. Il precedente è in File › Progetti precedenti.'));
}
function loadDemo() {
  Transport.stop();
  backupCurrentProject();
  proj = demoProject();
  ui.songPos = 0;
  ui.mode = 'song';
  onProjectReplaced();
  commit();
  toast(T('Progetto demo caricato. Premi Spazio per ascoltarlo.'));
}
async function openProjectFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const p = normalizeProject(data.project || data.proj || data);
    if (data.samples) await restoreSamples(data.samples);
    Transport.stop();
    backupCurrentProject();
    proj = p;
    ui.songPos = 0;
    onProjectReplaced();
    commit();
    toast(T('Progetto aperto: {0}', p.name));
  } catch (e) {
    toast(T('Impossibile aprire il file: {0}', e.message || e));
  }
}
async function restoreBackup(b) {
  try {
    const d = JSON.parse(b.data), p = normalizeProject(d.proj);
    if (d.samples) await restoreSamples(d.samples);
    Transport.stop();
    backupCurrentProject();
    proj = p;
    ui.songPos = 0;
    onProjectReplaced();
    commit();
    toast(T('Ripristinato: {0} ({1} canali)', p.name, p.channels.length));
  } catch (e) { toast(T('Copia non leggibile')); }
}
function saveProject() {
  const data = { app: 'ritmo-studio', version: 1, project: proj, samples: serializeSamples() };
  saveFile(safeName(proj.name) + '.ritmo.json', new Blob([JSON.stringify(data)], { type: 'application/json' }));
}
// Ctrl+R and the toolbar button open the export dialog (formats, separate tracks).
function exportWav() { ExportDialog.open(); }
const isAudioFile = f => (f.type || '').startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a|aiff?)$/i.test(f.name);
function handleFiles(list) {
  const files = Array.from(list || []);
  const json = files.find(f => /\.json$/i.test(f.name));
  if (json) { openProjectFile(json); return; }
  const mid = files.find(f => /\.midi?$/i.test(f.name));
  if (mid) { importMidiFile(mid); return; }
  const audio = files.filter(isAudioFile);
  if (audio.length) addAudioFiles(audio);
  else if (files.length) toast(T('Trascina file audio (WAV, MP3, OGG…) oppure un progetto .json'));
}

/* ---------- Live playing: computer keyboard and MIDI ---------- */
const KEYMAP = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23,
  KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28,
};
const held = new Map();
// Live arpeggiator: while keys are held on a channel with the arpeggiator on, their chord is played as an arpeggio.
const LiveArp = {
  notes: new Map(), ch: null, timer: 0, count: 0,
  add(ch, m, v) {
    if (this.ch !== ch) { this.stop(); this.ch = ch; }
    this.notes.set(m, v);
    if (!this.timer) { this.count = 0; this.next = performance.now(); this.tick(); }
  },
  remove(m) { this.notes.delete(m); if (!this.notes.size) this.stop(); },
  stop() { clearTimeout(this.timer); this.timer = 0; this.notes.clear(); },
  tick() {
    const ch = this.ch, a = ch && ch.arp;
    if (!ch || !a || !a.on || !this.notes.size) { this.stop(); return; }
    const pitches = [...this.notes.keys()].sort((x, y) => x - y), list = [];
    for (let o = 0; o < a.range; o++) pitches.forEach(m => list.push(m + 12 * o));
    const N = list.length, step = Math.floor(this.count / a.rep);
    let i = step % N;
    if (a.dir === 'down') i = N - 1 - i;
    else if (a.dir === 'updown' || a.dir === 'downup') { const per = Math.max(1, 2 * N - 2), k = step % per; i = k < N ? k : per - k; if (a.dir === 'downup') i = N - 1 - i; }
    else if (a.dir === 'random') i = Math.floor(seededRandom(step * 7919 + N) * N);
    const sec = a.time * 60 / proj.bpm / 4, m = list[clamp(i, 0, N - 1)];
    engine.trigger(ch, clamp(m, 0, 127), this.notes.get(pitches[i % pitches.length]) || 0.8, actx.currentTime + 0.005, sec * a.gate);
    this.count++;
    this.next += sec * 1000;
    this.timer = setTimeout(() => this.tick(), Math.max(5, this.next - performance.now()));
  },
};
function liveOn(key, m, v) {
  const ch = chById(ui.selCh);
  if (!ch) { toast(T('Aggiungi o seleziona un canale per suonare')); return; }
  if (held.has(key)) return;
  audioReady();
  // snap to scale: keys and MIDI notes outside the piano roll's scale play the nearest note of the scale
  if (ui.snapLive && proj.scale && proj.scale.type !== 'none') m = snapToScale(m, proj.scale.root, proj.scale.type);
  if (ch.arp && ch.arp.on) {
    held.set(key, { arp: true, m });
    LiveArp.add(ch, m, v);
    ScoreLog.on(key, m, v);
    ChordPanel.update();
    return;
  }
  held.set(key, { voice: engine.noteOn(ch, m, v), m });
  Rec.start(key, ch, m, v);
  ScoreLog.on(key, m, v);
  ChordPanel.update();
  PR.pvKey = m;
  PR.drawKeys();
}
function liveOff(key) {
  const k = held.get(key);
  if (!k) return;
  held.delete(key);
  if (k.arp) { LiveArp.remove(k.m); ScoreLog.off(key); ChordPanel.update(); return; }
  if (engine) engine.noteOff(k.voice);
  Rec.end(key);
  ScoreLog.off(key);
  ChordPanel.update();
  if (PR.pvKey === k.m) { PR.pvKey = null; PR.drawKeys(); }
}
function setMidiStatus(t) { midiStatus = t; Tree.render(); hint(t); }
async function connectMidi() {
  if (!navigator.requestMIDIAccess) { setMidiStatus(T('Questo ambiente non supporta il MIDI: usa l\'app desktop, Chrome o Edge.')); return; }
  try {
    const acc = await navigator.requestMIDIAccess();
    const bind = () => {
      const names = [];
      acc.inputs.forEach(inp => { inp.onmidimessage = onMidi; names.push(inp.name); });
      setMidiStatus(names.length ? T('Collegato: {0}. Suona il canale selezionato.', names.join(', ')) : T('Nessun dispositivo MIDI trovato. Collegalo e riprova.'));
    };
    bind();
    acc.onstatechange = bind;
  } catch (e) {
    setMidiStatus(T('Accesso al MIDI non consentito qui.'));
  }
}
function onMidi(ev) {
  const [st, d1, d2] = ev.data, cmd = st & 0xf0;
  if (cmd === 0x90 && d2 > 0) liveOn('midi' + d1, d1, d2 / 127);
  else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) liveOff('midi' + d1);
}
const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
function onKeyDown(e) {
  if (isTyping(e.target)) { if (e.key === 'Escape') e.target.blur(); return; }
  const mod = e.ctrlKey || e.metaKey;
  if (mod && shortcutKey(e) === 'z') { e.preventDefault(); if (e.shiftKey) Hist.redo(); else Hist.undo(); return; }
  if (mod && shortcutKey(e) === 'y') { e.preventDefault(); Hist.redo(); return; }
  if (mod && shortcutKey(e) === 's') { e.preventDefault(); saveProject(); return; }
  if (mod && shortcutKey(e) === 'o') { e.preventDefault(); openProjectDialog(); return; }
  if (mod && shortcutKey(e) === 'r') { e.preventDefault(); exportWav(); return; }
  if (e.code === 'Space') {
    e.preventDefault();
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    Transport.toggle();
    return;
  }
  if (e.key === 'F8' && e.altKey) { e.preventDefault(); toggleBrowser(); return; }
  const fk = { F5: () => WM.blur(), F6: () => WM.toggle('rack'), F7: () => WM.toggle('piano'), F9: () => WM.toggle('mixer') }[e.key];
  if (fk) { e.preventDefault(); fk(); return; }
  if (e.key === 'Escape') {
    if (menuEl) { closeMenu(); return; }
    if (WM.focused) { WM.close(WM.focused); return; }
    PR.sel.clear();
    PL.sel.clear();
    PR.draw();
    PL.draw();
    return;
  }
  // Shift+Up/Down: step through the sounds of the browser folder into the selected channel
  if (e.shiftKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && WM.focused !== 'piano' && Preview.current) {
    e.preventDefault();
    Preview.step(e.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (WM.focused === 'piano' && PR.key(e)) { e.preventDefault(); return; }
  if (WM.focused !== 'piano' && PL.key(e)) { e.preventDefault(); return; }
  if (mod || e.altKey) return;
  if (shortcutKey(e) === 'l') { setMode(ui.mode === 'pattern' ? 'song' : 'pattern'); return; }
  if (e.code === 'Minus' || e.code === 'Equal') { shiftOctave(e.code === 'Minus' ? -12 : 12); return; }
  if (ui.typing && e.code in KEYMAP) { e.preventDefault(); if (!e.repeat) liveOn(e.code, ui.kbOct + KEYMAP[e.code], 0.8); }
}

/* ---------- Frame loop ---------- */
let lastBig = '', lastSmall = '', wasPlaying = false;
const lit = new Map();
function fmtClock(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return m + ':' + String(sec).padStart(2, '0') + ':' + String(cs).padStart(2, '0');
}
let syncT = 0;
function frame(now) {
  const playing = Transport.playing, pos = playing ? Transport.position() : null;
  const shown = pos != null ? pos : (ui.mode === 'song' ? ui.songPos : 0);
  const ba = barAt(shown, ui.mode === 'song'), bars = ba.bar + ':' + String(ba.beat).padStart(2, '0') + ':' + String(ba.step).padStart(2, '0');
  const clock = fmtClock(shown * 60 / proj.bpm / 4);
  const big = ui.lcdMode === 'bars' ? bars : clock, small = ui.lcdMode === 'bars' ? clock : bars;
  if (big !== lastBig) { $('#lcd-big').textContent = big; lastBig = big; }
  if (small !== lastSmall) { $('#lcd-small').textContent = small; lastSmall = small; }
  if (actx && flashQueue.length) {
    const t = actx.currentTime - (actx.outputLatency || 0);
    for (let i = flashQueue.length - 1; i >= 0; i--) {
      if (flashQueue[i].t > t) continue;
      const el = document.querySelector(`[data-flash="${flashQueue[i].id}"]`);
      flashQueue.splice(i, 1);
      if (el) { el.classList.add('hit'); lit.set(el, now); }
    }
    if (flashQueue.length > 4000) flashQueue.length = 0;
  }
  for (const [el, t0] of lit) if (now - t0 > 90) { el.classList.remove('hit'); lit.delete(el); }
  Rack.showColumn(playing && ui.mode === 'pattern' && pos != null ? Math.floor(pos) : -1);
  if (playing || wasPlaying) { PL.draw(); PR.draw(); }
  wasPlaying = playing;
  Mixer.drawMeters();
  // knobs and faders follow automation clips while the song plays
  if (Automation.moved && now - syncT > 80) { Automation.moved = false; syncT = now; syncBound(); }
  drawScope();
  updateMemory(now);
  requestAnimationFrame(frame);
}
function drawScope() {
  const cv = $('#scope');
  if (!cv.offsetWidth || (!engine && cv._idle)) return;
  const W = cv.clientWidth, H = cv.clientHeight, g = fitCanvas(cv, W, H);
  g.fillStyle = TH.lcd;
  g.fillRect(0, 0, W, H);
  g.fillStyle = TH.lineSoft;
  g.fillRect(0, Math.round(H / 2), W, 1);
  if (!engine) {
    cv._idle = true;
    g.fillStyle = TH.faint;
    g.font = '600 9px ' + TH.label;
    g.fillText(T('OSCILLOSCOPIO'), 6, 12);
    return;
  }
  const s = engine.strips[0];
  s.an[0].getFloatTimeDomainData(s.buf);
  g.strokeStyle = TH.brass;
  g.lineWidth = 1.2;
  g.beginPath();
  const n = s.buf.length;
  for (let x = 0; x < W; x++) {
    const v = s.buf[Math.floor(x / W * n)], y = H / 2 - clamp(v, -1, 1) * (H / 2 - 2);
    if (x) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
}

/* ---------- Wiring ---------- */
function buildStatic() {
  masterKnob = knob({
    spec: { label: T('Volume master'), min: 0, max: 1.25, def: 0.9, unit: '%' }, value: proj.mixer[0].vol, size: 28,
    onInput: v => { proj.mixer[0].vol = v; engine && engine.updateStrip(0); if (WM.isOpen('mixer')) Mixer.render(); },
    onCommit: commit,
  });
  $('#master-knob').appendChild(masterKnob);

  $$('.menu-btn').forEach(btn => {
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => { if (openMenuKey === btn.dataset.menu) closeMenu(); else showMainMenu(btn); });
    btn.addEventListener('pointerenter', () => { if (openMenuKey && openMenuKey !== btn.dataset.menu) showMainMenu(btn); });
  });
  $('#proj-name').addEventListener('change', e => { proj.name = e.target.value.trim() || T('Senza titolo'); commit(); renderTop(); });
  $('#btn-new').addEventListener('click', e => menuAt(e.currentTarget, [
    { label: T('Progetto vuoto'), action: newProject },
    { label: T('Progetto demo'), action: loadDemo },
  ]));
  $('#btn-open').addEventListener('click', openProjectDialog);
  $('#file-project').addEventListener('change', e => { if (e.target.files[0]) openProjectFile(e.target.files[0]); });
  $('#file-audio').addEventListener('change', e => { if (e.target.files.length) addAudioFiles(Array.from(e.target.files)); });
  $('#file-midi').addEventListener('change', e => { if (e.target.files[0]) importMidiFile(e.target.files[0]); });
  $('#rack-loopstarter').addEventListener('click', () => LoopStarter.open());
  $('#btn-save').addEventListener('click', saveProject);
  $('#btn-export').addEventListener('click', exportWav);
  $('#btn-undo').addEventListener('click', () => Hist.undo());
  $('#btn-redo').addEventListener('click', () => Hist.redo());
  $('#btn-patsong').addEventListener('click', () => setMode(ui.mode === 'pattern' ? 'song' : 'pattern'));
  $('#btn-play').addEventListener('click', () => Transport.toggle());
  $('#btn-stop').addEventListener('click', () => Transport.stop());
  $('#btn-rec').addEventListener('click', toggleRec);
  $('#btn-recmode').addEventListener('click', e => menuAt(e.currentTarget, [
    { title: T('Il tasto Rec registra') },
    { label: T('Note nel pattern (tastiera e MIDI)'), checked: ui.recMode !== 'audio', action: () => setRecMode('notes') },
    { label: T('Audio dall\'ingresso nella Playlist'), checked: ui.recMode === 'audio', action: () => setRecMode('audio') },
    '-',
    { label: T('Impostazioni audio…'), action: () => AudioSettings.open() },
  ]));
  $('#btn-metro').addEventListener('click', () => { ui.metro = !ui.metro; renderTop(); savePrefs(); });
  $('#btn-typing').addEventListener('click', toggleTyping);
  $('#lcd').addEventListener('click', () => {
    ui.lcdMode = ui.lcdMode === 'time' ? 'bars' : 'time';
    $('#lcd-unit').textContent = ui.lcdMode === 'time' ? T('B:B:S') : T('M:S:CS');
    lastBig = lastSmall = '';
    savePrefs();
  });
  $('#lcd-unit').textContent = ui.lcdMode === 'time' ? T('B:B:S') : T('M:S:CS');
  const bpm = $('#bpm');
  const setBpm = v => { proj.bpm = clamp(Math.round(v * 1000) / 1000, 40, 300); engine && engine.updateTempo(); };
  bpm.addEventListener('change', () => { setBpm(+bpm.value || proj.bpm); commit(); renderTop(); });
  $('#bpm-label').addEventListener('pointerdown', e => {
    e.preventDefault();
    const lab = e.currentTarget;
    lab.setPointerCapture(e.pointerId);
    let lastY = e.clientY, v = proj.bpm;
    const move = ev => { v += (lastY - ev.clientY) * (ev.shiftKey ? 0.05 : 0.5); lastY = ev.clientY; setBpm(Math.round(v * 10) / 10); bpm.value = proj.bpm.toFixed(3); hint(T('Tempo: {0} BPM', proj.bpm)); };
    const up = () => { lab.removeEventListener('pointermove', move); lab.removeEventListener('pointerup', up); commit(); };
    lab.addEventListener('pointermove', move);
    lab.addEventListener('pointerup', up);
  });
  $('#pat-select').addEventListener('change', e => selectPattern(e.target.value));
  $('#pat-prev').addEventListener('click', () => stepPattern(-1));
  $('#pat-next').addEventListener('click', () => stepPattern(1));
  $('#btn-pat-add').addEventListener('click', addPattern);
  $('#ed-name').addEventListener('change', e => {
    const ch = chById(ui.editCh);
    if (!ch) return;
    ch.name = e.target.value.trim() || ch.name;
    commit();
    renderAll();
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', e => {
    if (isTyping(e.target)) return;
    if (e.code === 'Space') e.preventDefault();
    if (e.code in KEYMAP) liveOff(e.code);
  });
  window.addEventListener('blur', () => { for (const k of Array.from(held.keys())) liveOff(k); });

  let depth = 0, veil = null;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) { veil = h('div', 'drop-veil', T('Rilascia file audio o un progetto')); document.body.appendChild(veil); }
  });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; if (veil) { veil.remove(); veil = null; } } });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    if (veil) { veil.remove(); veil = null; }
    // audio dropped on the playlist grid becomes audio clips at that spot
    const files = Array.from(e.dataTransfer.files || []);
    if (e.target === PL.cv && files.some(isAudioFile)) { PL.dropAudio(files.filter(isAudioFile), e); return; }
    handleFiles(files);
  });

  const unlock = () => audioReady();
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
}

async function init() {
  if (window.ritmoNative && window.ritmoNative.platform === 'darwin') document.documentElement.classList.add('mac-desktop');
  readTheme();
  loadPrefs();
  const saved = loadAutosave();
  if (saved) {
    proj = saved.proj;
    await restoreSamples(saved.samples);
  } else {
    proj = demoProject();
    ui.mode = 'song';
  }
  ui.selPat = proj.patterns[0].id;
  ui.selCh = proj.channels[0] ? proj.channels[0].id : null;
  Hist.init();
  buildStatic();
  WM.init();
  Rack.init();
  PR.init();
  PL.init();
  Mixer.init();
  AutoEditor.init();
  Browser.init();
  $('#app').classList.toggle('hide-browser', !ui.browser);
  renderAll();
  const wins = ui.wins;
  ['rack', 'piano', 'mixer', 'help'].forEach(id => { if (wins[id] && wins[id].open) WM.open(id); });
  // A bare #token in the link opens that window: #piano, #mixer, #rack, #help or #canale.
  const tok = location.hash.slice(1);
  if (tok === 'canale' && ui.selCh) openEditor(ui.selCh);
  else if (['rack', 'piano', 'mixer', 'help', 'loopstarter', 'chordtool', 'chords'].includes(tok)) WM.open(tok);
  else if (!ui.noWelcome) Welcome.open();
  updateStatusRight();
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
