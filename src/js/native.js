'use strict';
/* Ritmo Studio — native engine bridge.
   Inside the desktop app (window.ritmoNative comes from the Electron preload) every sound comes from the native
   engine, which also hosts VST3, AU, LV2 and CLAP plug-ins. This file swaps the Web Audio engine for a client of it.
   In a plain browser it does nothing and the Web Audio engine stays in charge. */

const NE = {
  active: !!window.ritmoNative,
  connected: false, sampleRate: 0, bufferSize: 0, device: '',
  plugins: [], scan: null,
  pos: 0, posTime: 0, playing: false,
  meters: [], scope: new Float32Array(96),
  lastSent: '', sentSamples: new Set(), loaded: new Set(), openOnLoad: new Set(),
  waiting: new Map(),
};

if (NE.active) {
  const N = window.ritmoNative;
  const send = msg => N.send(msg);
  const request = (msg, type, timeout = 5000) => new Promise(resolve => {
    const req = uid();
    NE.waiting.set(req, { type, resolve });
    send({ ...msg, req });
    setTimeout(() => { if (NE.waiting.has(req)) { NE.waiting.delete(req); resolve(null); } }, timeout);
  });

  // The Web Audio clock is not used, but parts of the UI read it for timing and display.
  actx = {
    get currentTime() { return performance.now() / 1000; },
    get sampleRate() { return NE.sampleRate || 48000; },
    state: 'running', baseLatency: 0,
    get outputLatency() { return NE.bufferSize && NE.sampleRate ? NE.bufferSize / NE.sampleRate : 0; },
    resume() {},
  };
  audioReady = () => actx;

  /* ---------- project sync: send whatever changed, without the bulky plug-in states the engine already has ---------- */
  // P: the project to send, normally the current one (a stand-in with other clips when rendering parts to audio).
  function wireProject(P = proj) {
    const real = proj;
    proj = P;
    try { return wireOf(P); } finally { proj = real; }
  }
  function wireOf(proj) {
    const chans = proj.channels.map(ch => (ch.type === 'plugin' && NE.loaded.has('ch:' + ch.id) ? { ...ch, pluginState: undefined } : ch));
    const mixer = proj.mixer.map((t, i) => ({
      ...t,
      fx: t.fx.map((s, k) => (s && s.type === 'plugin' && NE.loaded.has('fx:' + i + ':' + k) ? { ...s, state: undefined } : s)),
    }));
    // automation clips carry the range of their knob, so the engine maps the 0..1 curve like the UI does
    const automation = proj.automation.map(a => { const sp = Automation.spec(a.target); return { ...a, spec: sp && !sp.select ? { min: sp.min, max: sp.max, log: !!sp.log, step: sp.step || 0 } : null }; });
    // arpeggiator and note echo are sent already applied, so the engine plays exactly what the web engine would
    const busy = proj.channels.filter(ch => (ch.arp && ch.arp.on) || (ch.echo && ch.echo.on));
    const patterns = busy.length ? proj.patterns.map(p => {
      const notes = { ...p.notes };
      busy.forEach(ch => { if (notes[ch.id]) notes[ch.id] = expandNotes(p, ch); });
      return { ...p, notes };
    }) : proj.patterns;
    // tracks carry their group's mute; audio clips with pitch, reverse or stretch name their processed copy
    const tracks = proj.playlist.tracks.map((t, i) => ({ ...t, mute: trackMuted(i) }));
    const clips = proj.playlist.clips.map(c => { const d = c.smp && clipKey(c) ? clipSample(c) : null; return d && d.id ? { ...c, smp: d.id } : c; });
    return { ...proj, channels: chans, mixer, automation, patterns, playlist: { tracks, clips }, seq: seqInfo(), arrangements: undefined };
  }
  function sendSamples(P) {
    const ids = [...P.channels.map(ch => ch.sample), ...P.playlist.clips.map(c => c.smp)];
    for (const id of ids) {
      if (id && SAMPLES[id] && !NE.sentSamples.has(id)) {
        NE.sentSamples.add(id);
        send({ t: 'sample', id, name: SAMPLES[id].name, data: SAMPLES[id].data });
      }
    }
    for (const c of P.playlist.clips) {
      const d = c.smp && clipKey(c) ? clipSample(c) : null;
      if (d && d.id && !NE.sentSamples.has(d.id)) {
        NE.sentSamples.add(d.id);
        send({ t: 'sample', id: d.id, name: d.name, data: derivedData(d) });
      }
    }
  }
  function syncNow(force) {
    if (!NE.connected || !proj) return;
    sendSamples(proj);
    const msg = { t: 'project', project: wireProject(), ui: { mode: ui.mode, pattern: curPat().id, metro: ui.metro } };
    const s = JSON.stringify(msg);
    if (!force && s === NE.lastSent) return;
    NE.lastSent = s;
    send(msg);
  }
  setInterval(() => syncNow(false), 40);
  send({ t: 'init' });  // the engine may already be running (page reload): ask it to introduce itself again

  /* ---------- engine facade used by the rack, piano roll, mixer and keyboard ---------- */
  const strips = Array.from({ length: MAX_INSERTS + 1 }, (_, i) => ({
    level: [0, 0],
    buf: new Float32Array(96),
    meter() {
      const m = NE.meters[i];
      if (m) { this.level[0] = Math.max(m[0], this.level[0]); this.level[1] = Math.max(m[1], this.level[1]); NE.meters[i] = null; }
      this.level[0] *= 0.93;
      this.level[1] *= 0.93;
      return this.level;
    },
    an: [{ getFloatTimeDomainData(buf) { buf.set(NE.scope.subarray(0, buf.length)); } }],
  }));
  engine = {
    native: true, strips,
    noteOn(ch, m, v) { if (!ch) return null; send({ t: 'noteOn', ch: ch.id, m, v }); return { ch: ch.id, m }; },
    noteOff(tok) { if (tok) send({ t: 'noteOff', ch: tok.ch, m: tok.m }); },
    trigger(ch, m, v, t, dur) { const tok = this.noteOn(ch, m, v); setTimeout(() => this.noteOff(tok), Math.max(80, (dur || 0.15) * 1000)); return null; },
    chan() {}, updateChan() {}, updateAllChans() {}, removeChan() {}, updateStrip() {}, rebuildFx() {}, updateFx() {}, updateTempo() {},
    routes() {}, stopClips() {}, playClip() {},
    panic() { send({ t: 'panic' }); },
    dispose() {},
  };
  rebuildEngine = () => syncNow(true);

  const loopLen = () => (ui.mode === 'pattern' ? patLen(curPat()) : Math.max(spb(), songLen()));
  Object.assign(Transport, {
    playing: false,
    play() {
      if (this.playing) return;
      // Rec set to audio: the engine records its input while it plays, from the song position
      const recording = AudioRec.wanted();
      if (recording && ui.mode !== 'song') setMode('song');
      syncNow(true);
      const from = ui.mode === 'song' ? (ui.songPos || songStart()) : 0;
      if (recording) {
        const insert = recordTarget(), input = proj.mixer[insert].input || 1;
        NE.rec = { insert, from };
        send({ t: 'recStart', from, input, req: 'rec' });
        hint(T('Registrazione audio su {0}… premi Stop per finire', mixerName(insert)));
      } else send({ t: 'play', from });
      this.playing = true;
      NE.pos = from;
      NE.posTime = performance.now();
      onTransportChange();
    },
    stop() {
      if (!this.playing) { if (ui.songPos) { ui.songPos = 0; onTransportChange(); } return; }
      send({ t: 'stop' });
      this.playing = false;
      Rec.flush();
      onTransportChange();
    },
    restart() { if (this.playing) { send({ t: 'stop' }); this.playing = false; this.play(); } },
    tick() {},
    position() {
      if (!this.playing) return null;
      const L = loopLen();
      const p = NE.pos + (performance.now() - NE.posTime) / 1000 * proj.bpm / 60 * 4;
      return L > 0 ? p % L : p;
    },
  });

  /* ---------- plug-in states (kept in the project so saves and reopenings restore them) ---------- */
  async function refreshPluginStates() {
    const hasPlugins = proj.channels.some(c => c.type === 'plugin') || proj.mixer.some(t => t.fx.some(s => s && s.type === 'plugin'));
    if (!hasPlugins || !NE.connected) return;
    const res = await request({ t: 'getStates' }, 'states');
    if (!res) return;
    for (const [key, b64] of Object.entries(res.states || {})) {
      const [kind, a, b] = key.split(':');
      if (kind === 'ch') { const ch = chById(a); if (ch) ch.pluginState = b64; }
      else if (kind === 'fx') { const s = proj.mixer[+a] && proj.mixer[+a].fx[+b]; if (s && s.type === 'plugin') s.state = b64; }
    }
  }
  setInterval(() => { refreshPluginStates().then(() => autosave()); }, 20000);

  const webSaveProject = saveProject;
  saveProject = async function () { await refreshPluginStates(); webSaveProject(); };

  const FORMAT_NAMES = { wav: T('Audio WAV'), flac: T('Audio FLAC'), ogg: T('Audio OGG Vorbis') };
  window.NativeIO = {
    async render(o, stems) {
      const ext = o.format || 'wav';
      const path = await N.saveDialog({
        title: stems.length ? T('Esporta le tracce separate (nome di base dei file)') : T('Esporta il brano'),
        defaultPath: safeName(proj.name) + '.' + ext, filters: [{ name: FORMAT_NAMES[ext], extensions: [ext] }],
      });
      if (!path) return;
      syncNow(true);
      hint(ui.mode === 'song' ? T('Rendering della playlist in corso…') : T('Rendering del pattern “{0}” in corso…', curPat().name));
      $('#btn-export').disabled = true;
      const res = await request({
        t: 'render', path, mode: ui.mode, pattern: curPat().id, format: ext, bits: o.bits, quality: o.quality,
        stems: stems.map(i => ({ i, name: proj.mixer[i].name })), master: o.master,
        // the whole song is exported even while a loop region is set, as in the browser
        project: ui.mode === 'song' && proj.loop ? wireProject({ ...proj, loop: undefined }) : undefined,
      }, 'renderDone', 60 * 60 * 1000);
      $('#btn-export').disabled = false;
      if (res && res.ok) { hint(T('Esportato: {0} s · {1} file in {2}', res.seconds.toFixed(1), res.files, res.path.replace(/[^/\\]+$/, ''))); toast(res.files > 1 ? T('{0} file esportati', res.files) : T('Brano esportato')); }
      else toast(res && res.error ? T('Esportazione non riuscita: {0}', res.error) : T('Esportazione non riuscita'));
    },
    // A pattern, or a stand-in project's clips, rendered without a file: the engine answers with a WAV in base64.
    async renderData(o) {
      syncNow(true);
      if (o.project) sendSamples(o.project);
      const res = await request({
        t: 'render', data: true, tail: false, mode: o.mode || 'song', pattern: o.pattern || curPat().id,
        project: o.project ? wireProject(o.project) : undefined,
      }, 'renderDone', 10 * 60 * 1000);
      if (!res || !res.ok || !res.data) throw new Error(res && res.error ? res.error : T('nessun audio ricevuto'));
      return res.data;
    },
    getDevices: () => request({ t: 'getDevices' }, 'devices', 10000),
    setDevice: patch => request({ t: 'setDevice', ...patch }, 'devices', 15000),
  };
  // inputs of the open sound card, in stereo pairs, for the mixer's input selector
  window.NativeAudio = {
    inputs() {
      const ins = NE.inputs || [], out = [];
      for (let k = 0; k < ins.length; k += 2) out.push({ id: k / 2 + 1, name: ins[k] + (ins[k + 1] ? ' - ' + ins[k + 1] : '') });
      return out;
    },
    inputName(id) { const x = this.inputs().find(p => p.id === id); return x ? x.name : T('Ingresso {0}', id); },
    outputName() { return NE.device || T('Uscita audio'); },
  };

  window.NativeTools = {
    async audioLog() {
      const path = await N.saveDialog({ title: T('Audio Logger: ultimi 60 secondi'), defaultPath: safeName(proj.name) + ' - audio logger.wav', filters: [{ name: T('Audio WAV'), extensions: ['wav'] }] });
      if (!path) return;
      const res = await request({ t: 'audioLog', path }, 'audioLogDone');
      if (res && res.ok) toast(T('Audio Logger: salvati {0} secondi', res.seconds.toFixed(1)));
      else toast(T('Audio Logger vuoto: suona qualcosa e riprova'));
    },
  };

  window.NativePlugins = {
    open(target, title) { send({ t: 'openEditor', target, title }); },
    scan(mode) { send({ t: 'scan', mode }); },
    addInstrument(p) {
      const ch = addChannel('plugin', { name: p.name.slice(0, 30), plugin: { id: p.id, name: p.name, vendor: p.vendor, format: p.format } });
      NE.openOnLoad.add('ch:' + ch.id);
      hint(T('Carico {0}…', p.name));
    },
    addEffect(p, i = ui.selMix, k = proj.mixer[i].fx.findIndex(s => !s)) {
      const t = proj.mixer[i];
      WM.open('mixer');
      if (k < 0) { toast(T('Gli slot di {0} sono tutti occupati', mixerName(i))); return; }
      t.fx[k] = { type: 'plugin', on: true, params: {}, plugin: { id: p.id, name: p.name, vendor: p.vendor, format: p.format } };
      NE.openOnLoad.add('fx:' + i + ':' + k);
      commit();
      Mixer.render();
      hint(T('Carico {0} su {1}…', p.name, mixerName(i)));
    },
    // Automatable parameters of a loaded plug-in: pick one to create an automation clip for it.
    async paramMenu(target, label) {
      const res = await request({ t: 'params', target }, 'params', 8000);
      if (!res || !res.list || !res.list.length) { toast(T('Il plugin non è caricato o non ha parametri automatizzabili')); return; }
      const items = [{ title: T('{0} · {1} parametri', label, res.list.length) }];
      res.list.slice(0, 400).forEach(p => items.push({ label: p.name || T('Parametro {0}', p.i), action: () => createAutomation({ kind: 'plugin', target, pid: p.i, name: label, pname: p.name, value: p.value }) }));
      openMenu(lastPointer.x, lastPointer.y, items);
    },
  };
  const lastPointer = { x: 200, y: 120 };
  window.addEventListener('pointerdown', e => { lastPointer.x = e.clientX; lastPointer.y = e.clientY; }, true);

  updateStatusRight = function () {
    $('#sys-audio').textContent = NE.connected && NE.sampleRate
      ? (NE.sampleRate / 1000).toFixed(1).replace('.', ',') + ' kHz · ' + NE.bufferSize
      : T('avvio…');
  };
  const refreshTree = () => { if (proj) Tree.render(); };

  /* ---------- messages from the engine ---------- */
  N.onMessage(msg => {
    switch (msg.t) {
      case 'ready':
        NE.connected = true;
        NE.loaded.clear();
        NE.sentSamples.clear();
        NE.lastSent = '';
        syncNow(true);
        send({ t: 'scan', mode: 'list' });
        if (msg.audioError) toast(T('Scheda audio: {0}', msg.audioError));
        updateStatusRight();
        break;
      case 'device':
        NE.sampleRate = msg.sampleRate;
        NE.bufferSize = msg.bufferSize;
        NE.device = msg.name;
        NE.inputs = msg.inputs || [];
        updateStatusRight();
        if (WM.isOpen('mixer')) Mixer.render();
        break;
      case 'recDone': {
        const r = NE.rec;
        NE.rec = null;
        if (!msg.ok) { toast(msg.error || T('Registrazione non riuscita')); break; }
        const u8 = b64ToBytes(msg.data);
        decodeBytes(u8).then(buffer => placeRecording(T('Registrazione {0}', new Date().toLocaleTimeString().slice(0, 5)) + '.wav', u8, buffer, msg.from, msg.latency, r ? r.insert : recordTarget()))
          .catch(() => toast(T('La registrazione non si può leggere')));
        break;
      }
      case 'status': {
        NE.meters = msg.meters || [];
        if (msg.scope) NE.scope.set(msg.scope.slice(0, 96));
        if (Transport.playing && msg.playing) { NE.pos = msg.pos; NE.posTime = performance.now(); }
        // automation clips moved these knobs in the engine: show it (no undo step)
        for (const [id, v] of msg.auto || []) {
          const a = Automation.byId(id);
          if (!a) continue;
          const tg = a.target, ch = tg.ch && chById(tg.ch), tr = proj.mixer[tg.ins];
          switch (tg.kind) {
            case 'chVol': if (ch) ch.vol = v; break;
            case 'chPan': if (ch) ch.pan = v; break;
            case 'chParam': if (ch) ch.params[tg.key] = v; break;
            case 'mixVol': if (tr) tr.vol = v; break;
            case 'mixPan': if (tr) tr.pan = v; break;
            case 'fxParam': { const sl = tr && tr.fx[tg.slot]; if (sl) sl.params[tg.key] = v; break; }
            case 'plugin': tg.value = v; break;
          }
          Automation.moved = true;
        }
        const now = performance.now();
        for (const id of msg.flash || []) {
          const el = document.querySelector(`[data-flash="${id}"]`);
          if (el) { el.classList.add('hit'); lit.set(el, now); }
        }
        break;
      }
      case 'scanStart':
        NE.scan = { done: 0, total: msg.total, current: '' };
        refreshTree();
        break;
      case 'scanProgress':
        NE.scan = { done: msg.done, total: msg.total, current: msg.current };
        hint(T('Scansione plugin: {0}/{1} — {2}', msg.done, msg.total, msg.current));
        if (msg.done % 10 === 0 || msg.done === msg.total) refreshTree();
        break;
      case 'plugins':
        NE.plugins = msg.list || [];
        NE.scan = null;
        if (msg.scanned != null) toast(T('Plugin trovati: {0}', NE.plugins.length));
        refreshTree();
        break;
      case 'pluginLoaded':
        NE.loaded.add(msg.target);
        hint(T('Caricato: {0}', msg.name));
        if (NE.openOnLoad.delete(msg.target)) NativePlugins.open(msg.target, msg.name);
        if (proj && ui.editCh) renderEditor();
        break;
      case 'pluginError':
        toast(msg.error);
        NE.openOnLoad.delete(msg.target);
        break;
      case 'previewEnd':
        Preview.playing = false;
        Browser.renderBar();
        if (!msg.ok) toast(T('Questo file non si può ascoltare'));
        break;
      case 'sampleLoaded':
        if (!msg.ok) toast(T('Il motore non riesce a leggere un campione audio'));
        break;
      case 'renderProgress':
        hint(T('Rendering: {0}%', msg.progress));
        break;
      case 'paused':
        if (Transport.playing) { Transport.playing = false; Rec.flush(); }
        ui.songPos = msg.pos;
        onTransportChange();
        hint(T('Pausa al marcatore: premi Play per continuare'));
        break;
      case 'engineExit':
        NE.connected = false;
        if (Transport.playing) { Transport.playing = false; onTransportChange(); }
        toast(T('Il motore audio si è riavviato'));
        break;
      case 'engineFailed':
        NE.connected = false;
        toast(T('Il motore audio non parte: {0}', msg.error || T('errore sconosciuto')));
        break;
    }
    if (msg.req && NE.waiting.has(msg.req)) {
      const w = NE.waiting.get(msg.req);
      if (w.type === msg.t) { NE.waiting.delete(msg.req); w.resolve(msg); }
    }
  });
}
