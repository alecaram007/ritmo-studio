'use strict';
/* Ritmo Studio — the browser's own content: folders from the disk, search, favourites, sound preview, presets,
   and dragging items onto the rack, the playlist and the mixer.
   Folders come from the desktop app (window.ritmoFiles), from the File System Access API in Chromium browsers,
   or, as a last resort, from a folder chosen with a file input for the current session only. */

const AUDIO_RE = /\.(wav|wave|aif|aiff|flac|ogg|mp3|m4a)$/i;
const fileKind = name => (AUDIO_RE.test(name) ? 'audio' : /\.midi?$/i.test(name) ? 'midi' : /\.json$/i.test(name) ? 'project' : 'other');

/* ---------- Folders ---------- */
const Files = {
  mode: window.ritmoFiles ? 'desktop' : (window.showDirectoryPicker ? 'fsa' : 'input'),
  roots: [],          // [{ id, name }]
  handles: new Map(), // fsa: id -> directory handle; input: id -> Map(rel -> File)
  cache: new Map(),   // folder key -> entries
  loading: new Set(),
  async init() {
    if (this.mode === 'desktop') this.roots = (await ritmoFiles.roots()).map(r => ({ id: r.path, name: r.name }));
    else if (this.mode === 'fsa') {
      for (const r of await idbAll()) { this.handles.set(r.id, r.handle); this.roots.push({ id: r.id, name: r.name }); }
    }
    Tree.render();
  },
  async add() {
    try {
      if (this.mode === 'desktop') {
        const added = await ritmoFiles.pick();
        added.forEach(r => { if (!this.roots.some(x => x.id === r.path)) this.roots.push({ id: r.path, name: r.name }); });
      } else if (this.mode === 'fsa') {
        const h = await window.showDirectoryPicker({ id: 'ritmo-samples', mode: 'read' });
        const id = 'fsa:' + uid();
        this.handles.set(id, h);
        this.roots.push({ id, name: h.name });
        await idbPut({ id, name: h.name, handle: h });
      } else {
        const inp = h('input');
        inp.type = 'file';
        inp.webkitdirectory = true;
        inp.multiple = true;
        inp.addEventListener('change', () => {
          const files = Array.from(inp.files || []);
          if (!files.length) return;
          const id = 'mem:' + uid(), map = new Map();
          files.forEach(f => map.set(f.webkitRelativePath.split('/').slice(1).join('/'), f));
          this.handles.set(id, map);
          this.roots.push({ id, name: T('{0} (sessione)', files[0].webkitRelativePath.split('/')[0]) });
          ui.treeOpen = ui.treeOpen.concat('disk', 'disk:' + id);
          Tree.render();
        });
        inp.click();
        return;
      }
    } catch (e) {
      // embedded pages may not open the folder picker: fall back to a folder chosen for this session
      if (e && e.name === 'SecurityError' && this.mode === 'fsa') { this.mode = 'input'; return this.add(); }
      if (e && e.name !== 'AbortError') toast(T('Cartella non aggiunta: {0}', e.message || e));
      return;
    }
    ui.treeOpen = ui.treeOpen.concat('disk');
    savePrefs();
    Tree.render();
  },
  async remove(root) {
    this.roots = this.roots.filter(r => r !== root);
    this.handles.delete(root.id);
    [...this.cache.keys()].forEach(k => { if (k.startsWith(root.id)) this.cache.delete(k); });
    if (this.mode === 'desktop') await ritmoFiles.remove(root.id);
    else if (this.mode === 'fsa') await idbDelete(root.id);
    Tree.render();
  },
  // Entries of a folder: { name, dir, key, root, rel, path? }
  key: (root, rel) => root + '|' + rel,
  join: (a, b) => (a ? a + '/' + b : b),
  async list(rootId, rel, dirPath) {
    const k = this.key(rootId, rel);
    if (this.cache.has(k)) return this.cache.get(k);
    let out = [];
    if (this.mode === 'desktop') {
      out = (await ritmoFiles.list(dirPath || rootId)).map(e => ({ name: e.name, dir: e.dir, root: rootId, rel: this.join(rel, e.name), path: e.path }));
    } else if (rootId.startsWith('mem:')) {
      const map = this.handles.get(rootId), seen = new Map(), prefix = rel ? rel + '/' : '';
      for (const p of map.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length), first = rest.split('/')[0];
        if (!first || first.startsWith('.')) continue;
        if (!seen.has(first)) seen.set(first, rest.includes('/'));
      }
      out = [...seen].map(([name, dir]) => ({ name, dir, root: rootId, rel: this.join(rel, name) }));
    } else {
      let dir = this.handles.get(rootId);
      if ((await dir.queryPermission({ mode: 'read' })) !== 'granted' && (await dir.requestPermission({ mode: 'read' })) !== 'granted') throw new Error(T('permesso negato'));
      for (const part of rel ? rel.split('/') : []) dir = await dir.getDirectoryHandle(part);
      for await (const [name, hd] of dir.entries()) if (!name.startsWith('.')) out.push({ name, dir: hd.kind === 'directory', root: rootId, rel: this.join(rel, name) });
    }
    out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
    this.cache.set(k, out);
    return out;
  },
  // Lists a folder in the background and redraws the tree when it arrives.
  request(rootId, rel, dirPath) {
    const k = this.key(rootId, rel);
    if (this.cache.has(k) || this.loading.has(k)) return;
    this.loading.add(k);
    this.list(rootId, rel, dirPath).catch(e => { this.cache.set(k, []); toast(T('Cartella non leggibile: {0}', e.message || e)); })
      .finally(() => { this.loading.delete(k); Tree.render(); });
  },
  async read(e) {
    if (this.mode === 'desktop') return new Uint8Array(await ritmoFiles.read(e.path));
    if (e.root.startsWith('mem:')) return new Uint8Array(await this.handles.get(e.root).get(e.rel).arrayBuffer());
    let dir = this.handles.get(e.root);
    const parts = e.rel.split('/'), name = parts.pop();
    for (const part of parts) dir = await dir.getDirectoryHandle(part);
    return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
  },
  // Search file names in every added folder (all words must match).
  async search(q, limit = 300) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    if (this.mode === 'desktop') return (await ritmoFiles.search(q, limit)).map(f => ({ name: f.name, dir: false, root: f.root, rel: f.path.slice(f.root.length + 1), path: f.path }));
    const out = [];
    for (const r of this.roots) {
      for (const f of await this.index(r.id)) {
        const low = f.name.toLowerCase();
        if (words.every(w => low.includes(w))) out.push(f);
        if (out.length >= limit) return out;
      }
    }
    return out;
  },
  indexes: new Map(),
  async index(rootId) {
    if (this.indexes.has(rootId)) return this.indexes.get(rootId);
    const out = [];
    if (rootId.startsWith('mem:')) {
      for (const rel of this.handles.get(rootId).keys()) out.push({ name: rel.split('/').pop(), dir: false, root: rootId, rel });
    } else {
      const walk = async (dir, rel) => {
        for await (const [name, hd] of dir.entries()) {
          if (name.startsWith('.') || out.length > 40000) continue;
          const r = this.join(rel, name);
          if (hd.kind === 'directory') await walk(hd, r);
          else out.push({ name, dir: false, root: rootId, rel: r });
        }
      };
      try { await walk(this.handles.get(rootId), ''); } catch (e) { /* permission not granted yet */ }
    }
    this.indexes.set(rootId, out);
    return out;
  },
  siblings(e) {
    const rel = e.rel.includes('/') ? e.rel.slice(0, e.rel.lastIndexOf('/')) : '';
    return (this.cache.get(this.key(e.root, rel)) || []).filter(x => !x.dir && fileKind(x.name) === 'audio');
  },
};

// IndexedDB keeps the folder handles of the File System Access API between sessions.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('ritmo-studio-folders', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('roots', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbAll() { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('roots').objectStore('roots').getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); } catch (e) { return []; } }
async function idbPut(v) { try { const db = await idb(); db.transaction('roots', 'readwrite').objectStore('roots').put(v); } catch (e) { /* not persisted */ } }
async function idbDelete(id) { try { const db = await idb(); db.transaction('roots', 'readwrite').objectStore('roots').delete(id); } catch (e) { /* ignore */ } }

/* ---------- Samples from files ---------- */
const sampleByFile = new Map(); // file key -> sample id
async function sampleFromEntry(e) {
  const k = Files.key(e.root, e.rel);
  const known = sampleByFile.get(k);
  if (known && SAMPLES[known]) return known;
  const u8 = await Files.read(e);
  const buffer = await decodeBytes(u8.slice());
  const id = addSampleFromBytes(e.name, u8, buffer);
  sampleByFile.set(k, id);
  return id;
}
const baseName = n => n.replace(/\.[^.]+$/, '').slice(0, 30);
async function entryToNewChannel(e) {
  try { const id = await sampleFromEntry(e); addChannel('sampler', { name: baseName(e.name), sample: id }, true).sampleNamed = true; }
  catch (err) { toast(T('Impossibile leggere {0}', e.name)); }
}
async function entryToChannel(e, ch) {
  try {
    const id = await sampleFromEntry(e);
    if (ch.type !== 'sampler') replaceChannel(ch, 'sampler', true);
    ch.sample = id;
    if (!ch.name || ch.name === INSTRUMENTS.sampler.label || ch.sampleNamed) { ch.name = baseName(e.name); ch.sampleNamed = true; }
    commit();
    renderAll();
    hint(ch.name + ': ' + e.name);
  } catch (err) { toast(T('Impossibile leggere {0}', e.name)); }
}
async function entryToPlaylist(e, t, s) {
  try { const id = await sampleFromEntry(e); PL.addAudioClip(id, t, s); commit(); PL.renderPatterns(); PL.draw(); }
  catch (err) { toast(T('Impossibile leggere {0}', e.name)); }
}

/* ---------- Preview ---------- */
const Preview = {
  current: null,   // the last audio entry clicked in the browser
  playing: false,
  src: null,
  async play(e) {
    this.stop();
    this.current = e;
    this.playing = true;
    Browser.renderBar();
    const vol = ui.previewVol ?? 0.8;
    try {
      if (window.NativeAudio && Files.mode === 'desktop' && e.path) { ritmoNative.send({ t: 'preview', path: e.path, vol }); return; }
      const id = await sampleFromEntry(e), c = audioReady(), g = c.createGain(), src = c.createBufferSource();
      if (this.current !== e) return;
      src.buffer = SAMPLES[id].buffer;
      g.gain.value = vol;
      src.connect(g); g.connect(c.destination);
      src.onended = () => { if (this.src === src) { this.src = null; this.playing = false; Browser.renderBar(); } };
      src.start();
      this.src = src;
      this.gain = g;
    } catch (err) { this.playing = false; Browser.renderBar(); toast(T('Anteprima non disponibile: {0}', e.name)); }
  },
  stop() {
    if (this.src) { try { this.src.stop(); } catch (e) { /* ended */ } this.src = null; }
    if (window.NativeAudio && this.playing) ritmoNative.send({ t: 'previewStop' });
    this.playing = false;
    Browser.renderBar();
  },
  setVolume(v) {
    ui.previewVol = v;
    savePrefs();
    if (this.gain) this.gain.gain.value = v;
    if (window.NativeAudio) ritmoNative.send({ t: 'previewVol', vol: v });
  },
  // Shift+Up/Down: the next or previous sound of the same folder goes into the selected channel, and plays.
  step(d) {
    const e = this.current;
    if (!e) return false;
    const list = Files.siblings(e), i = list.findIndex(x => x.rel === e.rel);
    const next = list[clamp(i + d, 0, list.length - 1)];
    if (!next || next === list[i]) return true;
    this.play(next);
    const ch = chById(ui.selCh);
    if (ch && ch.type === 'sampler') entryToChannel(next, ch);
    Tree.render();
    return true;
  },
};

/* ---------- Presets ---------- */
const PRESET_KEY = 'ritmo-studio/presets-v1';
const Presets = {
  list: [], // [{ kind, name }]
  async init() { this.list = await this.backendList(); Tree.render(); },
  async backendList() {
    if (window.ritmoFiles) return ritmoFiles.presets.list();
    const all = this.localAll();
    return Object.keys(all).map(k => { const [kind, ...n] = k.split(':'); return { kind, name: n.join(':') }; }).sort((a, b) => a.name.localeCompare(b.name));
  },
  localAll() { try { return JSON.parse(storeGet(PRESET_KEY) || '{}') || {}; } catch (e) { return {}; } },
  async save(kind, name, data) {
    const json = JSON.stringify(data);
    if (window.ritmoFiles) name = await ritmoFiles.presets.save(kind, name, json);
    else {
      const all = this.localAll();
      all[kind + ':' + name] = data;
      try { storeSet(PRESET_KEY, JSON.stringify(all)); } catch (e) { toast(T('Spazio del browser esaurito: preset non salvato')); return; }
    }
    this.list = await this.backendList();
    ui.treeOpen = ui.treeOpen.concat('presets', 'presets/' + kind);
    Tree.render();
    toast(T('Preset salvato: {0}', name));
  },
  async read(kind, name) {
    if (window.ritmoFiles) return JSON.parse(await ritmoFiles.presets.read(kind, name));
    return this.localAll()[kind + ':' + name];
  },
  async remove(kind, name) {
    if (window.ritmoFiles) await ritmoFiles.presets.remove(kind, name);
    else { const all = this.localAll(); delete all[kind + ':' + name]; storeSet(PRESET_KEY, JSON.stringify(all)); }
    this.list = await this.backendList();
    Tree.render();
  },
  of(kind) { return this.list.filter(p => p.kind === kind); },
  // What a preset keeps of a channel: the instrument and its settings, its plug-in state and its sample.
  channelData(ch) {
    const d = { type: ch.type, params: ch.params, mono: ch.mono, porta: ch.porta, cutGroup: ch.cutGroup, cutBy: ch.cutBy, arp: ch.arp, echo: ch.echo, color: ch.color, root: ch.root };
    if (ch.plugin) { d.plugin = ch.plugin; if (ch.pluginState) d.pluginState = ch.pluginState; }
    if (ch.sample && SAMPLES[ch.sample]) d.sample = { name: SAMPLES[ch.sample].name, data: SAMPLES[ch.sample].data };
    return JSON.parse(JSON.stringify(d));
  },
  async applyChannel(d, ch, name) {
    if (d.sample && d.sample.data) {
      const u8 = b64ToBytes(d.sample.data);
      d = { ...d, sampleId: addSampleFromBytes(d.sample.name, u8, await decodeBytes(u8.slice())) };
    }
    const fields = { params: { ...defaults(INSTRUMENTS[d.type].params), ...d.params }, mono: d.mono, porta: d.porta, cutGroup: d.cutGroup, cutBy: d.cutBy, arp: d.arp, echo: d.echo, root: d.root ?? 60 };
    if (!ch) {
      ch = addChannel(d.type, { name, color: d.color, plugin: d.plugin, sample: d.sampleId || null }, false);
      if (d.plugin && window.NE) NE.openOnLoad.add('ch:' + ch.id);
    } else {
      ch.type = d.type;
      ch.sample = d.sampleId || ch.sample;
      if (d.plugin) ch.plugin = d.plugin; else delete ch.plugin;
      ch.name = name;
    }
    Object.assign(ch, fields);
    if (d.pluginState) ch.pluginState = d.pluginState;
    normalizeChannelMode(ch);
    engine && engine.updateChan(ch);
    commit();
    renderAll();
    if (ui.editCh === ch.id) renderEditor();
    hint(T('Preset caricato: {0}', name));
  },
  slotData(slot) { return JSON.parse(JSON.stringify({ type: slot.type, params: slot.params, mix: slot.mix, plugin: slot.plugin, state: slot.state })); },
  trackData(t) { return JSON.parse(JSON.stringify({ fx: t.fx, eq: t.eq, width: t.width, phase: t.phase, swap: t.swap, vol: t.vol, pan: t.pan })); },
  applySlot(d, i, k) {
    const slot = { type: d.type, on: true, params: { ...(FXDEFS[d.type] ? defaults(FXDEFS[d.type].params) : {}), ...d.params } };
    if (d.mix != null) slot.mix = d.mix;
    if (d.plugin) { slot.plugin = d.plugin; if (d.state) slot.state = d.state; if (window.NE) NE.openOnLoad.add('fx:' + i + ':' + k); }
    Mixer.setSlot(i, k, slot);
  },
  applyTrack(d, i) {
    const t = proj.mixer[i];
    t.fx = Array.from({ length: FX_SLOTS }, (_, k) => (d.fx && d.fx[k] ? JSON.parse(JSON.stringify(d.fx[k])) : null));
    Object.assign(t, { eq: { ...t.eq, ...(d.eq || {}) }, width: d.width ?? 1, phase: !!d.phase, swap: !!d.swap, vol: d.vol ?? t.vol, pan: d.pan ?? 0 });
    engine && engine.rebuildFx(i);
    engine && engine.updateStrip(i);
    commit();
    Mixer.render();
  },
};
function uniquePresetName(kind, name) {
  let n = name, k = 2;
  while (Presets.list.some(p => p.kind === kind && p.name === n)) n = name + ' ' + k++;
  return n;
}
async function saveChannelPreset(ch) { await Presets.save('channel', uniquePresetName('channel', ch.name), Presets.channelData(ch)); }
async function saveSlotPreset(i, k) { const s = proj.mixer[i].fx[k]; if (s) await Presets.save('effect', uniquePresetName('effect', (s.plugin && s.plugin.name) || FXDEFS[s.type].label), Presets.slotData(s)); }
async function saveTrackPreset(i) { await Presets.save('mixer', uniquePresetName('mixer', proj.mixer[i].name), Presets.trackData(proj.mixer[i])); }

/* ---------- Browser panel: search box, preview bar, drag and drop ---------- */
const Browser = {
  query: '',
  results: null,
  init() {
    const q = $('#br-search');
    let t = 0;
    q.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => this.search(q.value), 180);
    });
    q.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { q.value = ''; this.search(''); q.blur(); } });
    $('#br-add').addEventListener('click', () => Files.add());
    $('#pv-play').addEventListener('click', () => (Preview.playing ? Preview.stop() : Preview.current && Preview.play(Preview.current)));
    const vol = $('#pv-vol');
    vol.value = String(ui.previewVol ?? 0.8);
    vol.addEventListener('input', () => Preview.setVolume(+vol.value));
    this.renderBar();
    // drops of browser items on the rack, the playlist and the mixer
    const accept = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('application/x-ritmo');
    const read = e => { try { return JSON.parse(e.dataTransfer.getData('application/x-ritmo')); } catch (err) { return null; } };
    const zone = (el, fn) => {
      el.addEventListener('dragover', e => { if (accept(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
      el.addEventListener('drop', e => { if (!accept(e)) return; e.preventDefault(); e.stopPropagation(); const d = read(e); if (d) fn(d, e); });
    };
    zone($('#rack-rows'), (d, e) => {
      const row = e.target.closest('.ch-row'), ch = row && chById(row.dataset.id);
      if (d.kind === 'file') { if (ch) entryToChannel(d.entry, ch); else entryToNewChannel(d.entry); }
      else if (d.kind === 'inst') (ch ? replaceChannel(ch, d.type) : addChannel(d.type, {}, true));
      else if (d.kind === 'plugin' && window.NativePlugins) NativePlugins.addInstrument(d.plugin);
      else if (d.kind === 'preset' && d.preset.kind === 'channel') Presets.read('channel', d.preset.name).then(p => Presets.applyChannel(p, ch || null, d.preset.name));
    });
    zone($('#pl-canvas'), (d, e) => {
      if (d.kind !== 'file') return;
      const { x, y } = PL.pt(e);
      entryToPlaylist(d.entry, PL.rowAt(y), PL.snap(x / PL.sw));
    });
    zone($('#mx-strips'), (d, e) => {
      const st = e.target.closest('.strip');
      if (!st) return;
      const i = +st.dataset.i, k = proj.mixer[i].fx.findIndex(s => !s);
      if (k < 0) { toast(T('Gli slot di {0} sono tutti occupati', mixerName(i))); return; }
      ui.selMix = i;
      if (d.kind === 'fx') Mixer.setSlot(i, k, fxSlot(d.type));
      else if (d.kind === 'plugin' && window.NativePlugins) NativePlugins.addEffect(d.plugin, i, k);
      else if (d.kind === 'preset' && d.preset.kind === 'effect') Presets.read('effect', d.preset.name).then(p => Presets.applySlot(p, i, k));
      else if (d.kind === 'preset' && d.preset.kind === 'mixer') Presets.read('mixer', d.preset.name).then(p => Presets.applyTrack(p, i));
    });
    zone($('#mx-side'), (d, e) => {
      const row = e.target.closest('.slot'), i = ui.selMix;
      const k = row ? Array.from(row.parentElement.children).indexOf(row) : proj.mixer[i].fx.findIndex(s => !s);
      if (k < 0) return;
      if (d.kind === 'fx') Mixer.setSlot(i, k, fxSlot(d.type));
      else if (d.kind === 'plugin' && window.NativePlugins) NativePlugins.addEffect(d.plugin, i, k);
      else if (d.kind === 'preset' && d.preset.kind === 'effect') Presets.read('effect', d.preset.name).then(p => Presets.applySlot(p, i, k));
    });
    zone($('#inst-body'), d => { const ch = chById(ui.editCh); if (ch && d.kind === 'file') entryToChannel(d.entry, ch); });
    Files.init();
    Presets.init();
  },
  async search(q) {
    this.query = q.trim();
    if (!this.query) { this.results = null; Tree.render(); return; }
    const words = this.query.toLowerCase().split(/\s+/);
    const hit = s => words.every(w => s.toLowerCase().includes(w));
    const r = { inst: [], fx: [], plugins: [], presets: [], files: [], project: [] };
    Object.entries(INSTRUMENTS).forEach(([t, d]) => { if (!d.hidden && hit(d.label)) r.inst.push(t); });
    Object.entries(FXDEFS).forEach(([t, d]) => { if (!d.hidden && hit(d.label)) r.fx.push(t); });
    if (window.NE && NE.plugins) r.plugins = NE.plugins.filter(p => hit(p.name + ' ' + (p.vendor || ''))).slice(0, 100);
    r.presets = Presets.list.filter(p => hit(p.name));
    proj.channels.forEach(ch => { if (hit(ch.name)) r.project.push({ kind: 'ch', ch }); });
    proj.patterns.forEach(p => { if (hit(p.name)) r.project.push({ kind: 'pat', p }); });
    this.results = r;
    Tree.render();
    try { r.files = await Files.search(this.query); } catch (e) { r.files = []; }
    if (this.results === r) Tree.render();
  },
  renderBar() {
    const bar = $('#pv-bar');
    if (!bar) return;
    const e = Preview.current;
    $('#pv-name').textContent = e ? e.name : T('Clic su un suono per ascoltarlo');
    $('#pv-play').textContent = Preview.playing ? '■' : '▶';
    $('#pv-play').disabled = !e;
    $('#pv-play').setAttribute('aria-label', Preview.playing ? T('Ferma l\'anteprima') : T('Ascolta'));
  },
  isStarred(key) { return (ui.starred || []).some(s => s.key === key); },
  toggleStar(item) {
    const list = ui.starred || [];
    ui.starred = this.isStarred(item.key) ? list.filter(s => s.key !== item.key) : list.concat(item);
    savePrefs();
    Tree.render();
  },
  // Right-click menu of a file in the browser.
  fileMenu(e, x, y) {
    const ch = chById(ui.selCh), kind = fileKind(e.name), key = Files.key(e.root, e.rel);
    const items = [{ title: e.name }];
    if (kind === 'audio') {
      items.push(
        { label: T('Ascolta'), action: () => Preview.play(e) },
        { label: T('Apri in un nuovo canale'), action: () => entryToNewChannel(e) },
        { label: ch ? T('Carica nel canale selezionato ({0})', ch.name) : T('Carica nel canale selezionato'), disabled: !ch, action: () => entryToChannel(e, ch) },
        { label: T('Aggiungi alla Playlist come clip audio'), action: () => entryToPlaylist(e, 0, ui.songPos || 0) },
      );
    } else if (kind === 'midi') items.push({ label: T('Importa MIDI'), action: async () => importMidiFile(new File([await Files.read(e)], e.name)) });
    else if (kind === 'project') items.push({ label: T('Apri progetto'), action: async () => openProjectFile(new File([await Files.read(e)], e.name)) });
    items.push('-', { label: this.isStarred(key) ? T('Togli dai preferiti') : T('Aggiungi ai preferiti'), action: () => this.toggleStar({ key, name: e.name, entry: e }) });
    if (Files.mode === 'desktop' && e.path) items.push({ label: T('Mostra nel Finder'), action: () => ritmoFiles.reveal(e.path) });
    openMenu(x, y, items);
  },
};

// Opening a file entry from the tree: audio previews, MIDI imports, projects open.
function openEntry(e) {
  const kind = fileKind(e.name);
  if (kind === 'audio') { if (ui.previewAuto !== false) Preview.play(e); else Preview.current = e; Browser.renderBar(); }
  else if (kind === 'midi') Files.read(e).then(u8 => importMidiFile(new File([u8], e.name)));
  else if (kind === 'project') Files.read(e).then(u8 => openProjectFile(new File([u8], e.name)));
}
