'use strict';
/* Ritmo Studio — audio in and out: the export dialog (WAV, FLAC, OGG, separate tracks), the audio settings window,
   and audio recording from the sound card input into audio clips on the playlist.
   The desktop app's native engine provides FLAC, OGG and device selection (see native.js: NativeIO);
   in a browser the Web Audio engine renders WAV and records from the microphone. */

function addSampleFromBytes(name, u8, buffer) {
  const id = uid();
  SAMPLES[id] = { name, data: bytesToB64(u8), buffer };
  return id;
}

/* ---------- Export ---------- */
const ExportDialog = {
  open() {
    WM.open('export');
    this.render();
  },
  opts() {
    return { what: ui.mode === 'song' ? 'song' : 'pattern', format: 'wav', bits: 24, quality: 6, stems: false, master: true, ...(ui.exportOpts || {}) };
  },
  render() {
    const o = this.opts(), body = $('#export-body'), native = !!window.NativeIO;
    body.textContent = '';
    const grid = h('div', 'form-grid');
    const sel = (label, value, options, onChange) => {
      const s = h('select');
      options.forEach(([v, l, dis]) => { const op = new Option(l, v); op.disabled = !!dis; s.appendChild(op); });
      s.value = String(value);
      s.addEventListener('change', () => onChange(s.value));
      grid.append(h('span', null, label), s);
      return s;
    };
    const set = patch => { ui.exportOpts = { ...this.opts(), ...patch }; savePrefs(); this.render(); };
    sel(T('Cosa'), o.what, [['song', T('Il brano (Playlist)')], ['pattern', T('Il pattern “{0}”', curPat().name)]], v => set({ what: v }));
    sel(T('Formato'), o.format, [['wav', 'WAV'], ['flac', T('FLAC (senza perdita)'), !native], ['ogg', T('OGG Vorbis (compresso)'), !native]], v => set({ format: v, bits: v === 'flac' ? Math.min(24, o.bits) : o.bits }));
    if (o.format === 'ogg') sel(T('Qualità'), o.quality, Array.from({ length: 11 }, (_, q) => [q, q === 6 ? T('{0} (consigliata) · circa {1} kbps', q, [64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 500][q]) : T('{0} · circa {1} kbps', q, [64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 500][q])]), v => set({ quality: +v }));
    else sel(T('Risoluzione'), o.bits, [['16', '16 bit (CD)'], ['24', '24 bit'], ['32', T('32 bit in virgola mobile'), o.format === 'flac']], v => set({ bits: +v }));
    body.appendChild(grid);
    const stems = h('label', 'check');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.checked = o.stems;
    cb.addEventListener('change', () => set({ stems: cb.checked }));
    stems.append(cb, T('Tracce separate: un file per ogni traccia del mixer usata (dopo il fader)'));
    body.appendChild(stems);
    if (o.stems) {
      const m = h('label', 'check'), cb2 = h('input');
      cb2.type = 'checkbox';
      cb2.checked = o.master;
      cb2.addEventListener('change', () => set({ master: cb2.checked }));
      m.append(cb2, T('Includi anche il mix completo (Master)'));
      body.appendChild(m);
      const used = [...usedTracks()].filter(i => i > 0).sort((a, b) => a - b);
      body.appendChild(h('p', 'tool-intro', used.length ? T('Tracce: {0}', used.map(i => insName(i)).join(', ')) : T('Nessuna traccia del mixer riceve suono.')));
    }
    if (!native) body.appendChild(h('p', 'tool-intro', T('FLAC e OGG sono disponibili nell\'app desktop. Nel browser le tracce separate arrivano in un unico archivio ZIP.')));
    const act = h('div', 'form-actions'), go = h('button', 'tbtn', T('Esporta…'));
    go.type = 'button';
    go.addEventListener('click', () => this.run());
    act.appendChild(go);
    body.appendChild(act);
  },
  async run() {
    const o = this.opts();
    if (o.what !== (ui.mode === 'song' ? 'song' : 'pattern')) setMode(o.what);
    const stems = o.stems ? [...usedTracks()].filter(i => i > 0).sort((a, b) => a - b) : [];
    if (o.stems && !stems.length) { toast(T('Nessuna traccia del mixer da esportare')); return; }
    WM.close('export');
    if (Transport.playing) Transport.stop();
    if (window.NativeIO) { await NativeIO.render(o, stems); return; }
    await webExport(o, stems);
  },
};

async function webExport(o, stems) {
  hint(ui.mode === 'song' ? T('Rendering della playlist in corso…') : T('Rendering del pattern “{0}” in corso…', curPat().name));
  $('#btn-export').disabled = true;
  try {
    const name = safeName(proj.name), bits = o.bits || 16;
    if (!stems.length) {
      const { buf, frames, seconds } = await renderOffline();
      await saveFile(name + '.wav', encodeWav(buf, frames, bits));
      hint(T('Esportati {0} s di audio', seconds.toFixed(1)));
      return;
    }
    const tracks = o.master ? [0, ...stems] : stems, files = [];
    // an OfflineAudioContext holds at most 32 channels: render the tracks sixteen at a time
    for (let k = 0; k < tracks.length; k += 16) {
      const part = tracks.slice(k, k + 16);
      const { buf, frames } = await renderOffline(part);
      for (let j = 0; j < part.length; j++) {
        const i = part[j], label = i === 0 ? 'Master' : String(i).padStart(3, '0') + ' ' + safeName(proj.mixer[i].name);
        files.push({ name: name + ' - ' + label + '.wav', u8: new Uint8Array(await encodeWav(buf, frames, bits, [j * 2, j * 2 + 1]).arrayBuffer()) });
      }
      hint(T('Tracce pronte: {0} di {1}', files.length, tracks.length));
    }
    await saveFile(name + ' - ' + T('tracce') + '.zip', zipMany(files));
  } catch (e) {
    toast(e.message || String(e));
  } finally {
    $('#btn-export').disabled = false;
  }
}

/* ---------- Audio settings ---------- */
const AudioSettings = {
  open() {
    WM.open('audio');
    this.render();
    if (window.NativeIO) NativeIO.getDevices().then(d => { this.devices = d; this.render(); });
  },
  devices: null,
  render() {
    const body = $('#audio-body');
    if (!body) return;
    body.textContent = '';
    if (!window.NativeIO) {
      body.appendChild(h('p', 'tool-intro', T('Nel browser l\'audio esce dal dispositivo predefinito del sistema. Per scegliere la scheda audio, la frequenza e il buffer usa l\'app desktop.')));
      const g = h('div', 'form-grid');
      g.append(h('span', null, T('Frequenza')), h('b', null, actx ? actx.sampleRate + ' Hz' : T('audio spento')));
      g.append(h('span', null, T('Latenza')), h('b', null, actx ? Math.round(((actx.baseLatency || 0) + (actx.outputLatency || 0)) * 1000) + ' ms' : '—'));
      g.append(h('span', null, T('Ingresso')), h('b', null, T('microfono del browser (chiede il permesso alla prima registrazione)')));
      body.appendChild(g);
      return;
    }
    const d = this.devices;
    if (!d) { body.appendChild(h('p', 'tool-intro', T('Leggo le schede audio…'))); return; }
    const g = h('div', 'form-grid');
    const sel = (label, value, options, onChange) => {
      const s = h('select');
      options.forEach(([v, l]) => s.appendChild(new Option(l, v)));
      s.value = String(value);
      s.addEventListener('change', () => onChange(s.value));
      g.append(h('span', null, label), s);
    };
    const apply = async patch => { this.devices = await NativeIO.setDevice(patch); if (this.devices && this.devices.error) toast(T('Scheda audio: {0}', this.devices.error)); this.render(); };
    const type = d.types.find(t => t.name === d.type) || d.types[0] || { outputs: [], inputs: [] };
    sel(T('Driver'), d.type, d.types.map(t => [t.name, t.name]), v => apply({ type: v }));
    sel(T('Uscita'), d.output, type.outputs.map(n => [n, n]), v => apply({ output: v }));
    sel(T('Ingresso'), d.input || '', [['', T('(nessuno)')], ...type.inputs.map(n => [n, n])], v => apply({ input: v, inputsOn: !!v }));
    sel(T('Frequenza'), d.sampleRate, d.sampleRates.map(r => [r, r + ' Hz']), v => apply({ sampleRate: +v }));
    sel(T('Buffer'), d.bufferSize, d.bufferSizes.map(b => [b, T('{0} campioni · {1} ms', b, (b / d.sampleRate * 1000).toFixed(1))]), v => apply({ bufferSize: +v }));
    body.appendChild(g);
    body.appendChild(h('p', 'tool-intro', T('Latenza complessiva: {0} ms.', Math.round(d.latency * 1000)) + ' ' + (d.inputsOn ? T('Ingressi attivi: {0}', d.inputChannels.slice(0, 8).join(', ')) : T('Ingressi spenti: scegli un ingresso per registrare.'))));
  },
};

/* ---------- Audio recording ---------- */
// The take lands as an audio clip at the song position where recording started, on the selected mixer track.
function recordTarget() {
  let i = ui.selMix > 0 ? ui.selMix : proj.mixer.findIndex((t, k) => k > 0 && t.input);
  if (i <= 0) i = freeInsert() || 1;
  const t = proj.mixer[i];
  if (!t.input) t.input = 1;
  if (isDefaultInsertName(t.name)) t.name = T('Registrazione');
  return i;
}
async function placeRecording(name, u8, buffer, fromStep, latency, insert) {
  const id = addSampleFromBytes(name, u8, buffer);
  const sd = 60 / proj.bpm / 4, lat = Math.max(0, latency || 0) / sd;
  const tracks = proj.playlist.tracks, s = fromStep;
  const l = Math.max(1, Math.ceil(buffer.duration / sd - lat));
  let t = tracks.findIndex((_, k) => !proj.playlist.clips.some(c => c.t === k && c.s < s + l && c.s + c.l > s));
  if (t < 0) { tracks.push({ name: T('Traccia {0}', tracks.length + 1), mute: false }); t = tracks.length - 1; }
  proj.playlist.clips.push({ id: uid(), smp: id, t, s, l, o: lat, mx: insert, gain: 1 });
  commit();
  PL.renderHeads();
  PL.draw();
  Tree.render();
  toast(T('Registrazione aggiunta alla Playlist: {0} s su {1}', buffer.duration.toFixed(1), mixerName(insert)));
}

const AudioRec = {
  active: null,
  wanted() { return ui.rec && ui.recMode === 'audio'; },
  // Web Audio: capture the microphone while the song plays.
  async startWeb() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
    catch (e) { toast(T('Microfono non disponibile: {0}', e.message || e.name)); return false; }
    const c = audioReady(), src = c.createMediaStreamSource(stream), sp = c.createScriptProcessor(4096, 2, 2), chunks = [[], []];
    sp.onaudioprocess = e => { for (let k = 0; k < 2; k++) chunks[k].push(new Float32Array(e.inputBuffer.getChannelData(Math.min(k, e.inputBuffer.numberOfChannels - 1)))); };
    src.connect(sp);
    const mute = c.createGain();
    mute.gain.value = 0;
    sp.connect(mute);
    mute.connect(c.destination);
    this.active = { stream, src, sp, mute, chunks, from: ui.mode === 'song' ? ui.songPos : 0, insert: recordTarget(), latency: (c.baseLatency || 0) + (c.outputLatency || 0) + 4096 / c.sampleRate };
    return true;
  },
  async stopWeb() {
    const r = this.active;
    if (!r) return;
    this.active = null;
    r.sp.onaudioprocess = null;
    try { r.src.disconnect(); r.sp.disconnect(); r.mute.disconnect(); } catch (e) { /* ignore */ }
    r.stream.getTracks().forEach(t => t.stop());
    const n = r.chunks[0].reduce((a, b) => a + b.length, 0);
    if (!n) return;
    const buffer = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: actx.sampleRate });
    for (let k = 0; k < 2; k++) { let o = 0; for (const ch of r.chunks[k]) { buffer.getChannelData(k).set(ch, o); o += ch.length; } }
    const u8 = new Uint8Array(await encodeWav(buffer, n, 16).arrayBuffer());
    await placeRecording(T('Registrazione {0}', new Date().toLocaleTimeString().slice(0, 5)) + '.wav', u8, buffer, r.from, r.latency, r.insert);
  },
};

// In a browser, the transport arms the microphone before playing when Rec is set to audio.
if (!window.ritmoNative) {
  const play = Transport.play, stop = Transport.stop;
  Transport.play = function () {
    if (AudioRec.wanted() && !this.playing && !AudioRec.active) {
      if (ui.mode !== 'song') setMode('song');
      AudioRec.startWeb().then(ok => { if (ok) { play.call(this); hint(T('Registrazione audio in corso… premi Stop per finire')); } });
      return;
    }
    play.call(this);
  };
  Transport.stop = function () {
    const was = this.playing;
    stop.call(this);
    if (was && AudioRec.active) AudioRec.stopWeb();
  };
}
