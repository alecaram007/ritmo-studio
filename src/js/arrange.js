'use strict';
/* Ritmo Studio — arrangement tools used by the playlist: processed audio clips (pitch, reverse, time-stretch),
   rendering clips and patterns to audio, editing the song timeline (space, markers, metre) and several arrangements. */

/* ---------- Processed audio clips ---------- */
// A clip with pitch, reverse or stretch plays a processed copy of its sample, computed once and cached.
const DERIVED = new Map();
function clipKey(c) {
  const st = c.stretch && Math.abs(c.stretch - 1) > 1e-4 ? +c.stretch : 1;
  if (!c.smp || !(c.pitch || c.rev || st !== 1)) return null;
  return c.smp + '~' + (c.pitch || 0) + (c.rev ? 'r' : 'f') + st.toFixed(4);
}
function clipSample(c) {
  const smp = SAMPLES[c.smp], key = clipKey(c);
  if (!key || !smp || !smp.buffer) return smp;
  let d = DERIVED.get(key);
  if (!d || d.src !== smp.buffer) {
    d = { id: key, name: smp.name, src: smp.buffer, buffer: processAudio(smp.buffer, c.pitch || 0, !!c.rev, c.stretch || 1) };
    DERIVED.set(key, d);
    if (DERIVED.size > 32) DERIVED.delete(DERIVED.keys().next().value);
  }
  return d;
}
// The processed copy as a WAV file, for the native engine.
function derivedData(d) {
  if (!d.data) d.data = bytesToB64(new Uint8Array(wavArrayBuffer(d.buffer, d.buffer.length, 24)));
  return d.data;
}
// Pitch in semitones keeps the duration; stretch changes the duration (×) and keeps the pitch.
function processAudio(buf, semis, rev, stretch) {
  const sr = buf.sampleRate, P = Math.pow(2, semis / 12), stretchBy = stretch || 1;
  let ch = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  if (rev) ch = ch.map(d => Float32Array.from(d).reverse());
  if (Math.abs(stretchBy * P - 1) > 1e-4) ch = wsola(ch, stretchBy * P, sr);
  if (Math.abs(P - 1) > 1e-4) ch = ch.map(d => resample(d, P));
  const out = new AudioBuffer({ length: Math.max(1, ch[0].length), numberOfChannels: ch.length, sampleRate: sr });
  ch.forEach((d, i) => out.getChannelData(i).set(d.subarray(0, out.length)));
  return out;
}
function resample(d, rate) {
  const n = Math.floor(d.length / rate), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * rate, k = x | 0, f = x - k; o[i] = d[k] + ((k + 1 < d.length ? d[k + 1] : 0) - d[k]) * f; }
  return o;
}
// Time-stretch without changing the pitch (WSOLA): 46 ms Hann frames overlapped by half, each shifted by up to
// ±10 ms to where it best continues the previous frame. The search runs on a 4× decimated mono mix.
function wsola(ch, factor, sr) {
  const N = 2 * Math.round(sr * 0.023), Hs = N / 2, Ha = Hs / factor, tol = Math.round(sr * 0.01), D = 4;
  const len = ch[0].length, outLen = Math.max(1, Math.ceil(len * factor));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const mono = new Float32Array(Math.ceil(len / D) + 2);
  for (let i = 0, k = 0; i < len; i += D, k++) { let s = 0; for (const d of ch) s += d[i]; mono[k] = s; }
  const out = ch.map(() => new Float32Array(outLen + N)), wsum = new Float32Array(outLen + N), L = Math.floor(Hs / D);
  let prev = 0;
  for (let k = 0, op = 0; op < outLen; k++, op += Hs) {
    let pos = Math.round(k * Ha);
    if (k > 0) {
      const want = ((prev + Hs) / D) | 0, lo = Math.max(0, pos - tol), hi = Math.min(len - N, pos + tol);
      let best = pos, bestC = -Infinity;
      for (let c = lo; c <= hi; c += D) {
        const a = (c / D) | 0;
        let acc = 0;
        for (let i = 0; i < L; i++) acc += mono[a + i] * mono[want + i];
        if (acc > bestC) { bestC = acc; best = c; }
      }
      pos = best;
    }
    if (pos >= len) break;
    for (let j = 0; j < ch.length; j++) {
      const src = ch[j], dst = out[j], n = Math.min(N, len - pos);
      for (let i = 0; i < n; i++) dst[op + i] += src[pos + i] * win[i];
    }
    for (let i = 0; i < N; i++) wsum[op + i] += win[i];
    prev = pos;
  }
  // the overlapped windows add up to 1 except at the very edges, where they are evened out
  for (const d of out) for (let i = 0; i < outLen; i++) if (wsum[i] < 0.999) d[i] /= Math.max(0.1, wsum[i]);
  return out.map(d => d.subarray(0, outLen));
}
const stepSec = () => 60 / proj.bpm / 4;
const clipSteps = c => { const s = clipSample(c); return s && s.buffer ? Math.max(1, Math.ceil(s.buffer.duration / stepSec() - 1e-6)) : c.l; };

/* ---------- Rendering to audio ---------- */
// Renders a pattern, or the clips of a stand-in project, through the whole mixer: exactly as long as the music.
async function renderToBuffer(o) {
  if (window.NativeIO && NativeIO.renderData) {
    const b64 = await NativeIO.renderData(o);
    if (!b64) throw new Error(T('il motore audio non ha risposto'));
    const u8 = b64ToBytes(b64);
    return { u8, buffer: await decodeBytes(u8) };
  }
  const { buf } = await renderOffline(null, { ...o, tail: false });
  return { u8: new Uint8Array(wavArrayBuffer(buf, buf.length, 24)), buffer: buf };
}
// The current project with only these clips on the playlist, moved to start at the top.
function projectWithClips(clips, from) {
  const tracks = proj.playlist.tracks.map(t => ({ ...t, mute: false }));
  return { ...proj, playlist: { tracks, clips: clips.map(c => ({ ...c, s: c.s - from, mu: false })) }, markers: [], loop: null };
}
let arrRendering = false;
async function withRender(label, fn) {
  if (arrRendering) { toast(T('Un rendering è già in corso')); return; }
  arrRendering = true;
  hint(label + '…');
  try { await fn(); } catch (e) { console.warn(e); toast(T('Rendering non riuscito: {0}', e && e.message ? e.message : e)); } finally { arrRendering = false; }
}
// Consolidate: the clips become one audio clip (through the mixer, so it goes straight to the master).
function consolidateClips(list, replace = true) {
  list = list.filter(c => !c.a && !c.mu);
  if (!list.length) { toast(T('Seleziona clip di pattern o audio da consolidare')); return; }
  const from = Math.min(...list.map(c => c.s)), to = Math.max(...list.map(c => c.s + c.l)), t = Math.min(...list.map(c => c.t));
  const name = (list.length === 1 && list[0].p && patById(list[0].p) ? patById(list[0].p).name : T('Consolidato')) + '.wav';
  return withRender(T('Rendering in audio'), async () => {
    const { u8, buffer } = await renderToBuffer({ mode: 'song', project: projectWithClips(list, from) });
    const id = addSampleFromBytes(name, u8, buffer);
    if (replace) list.forEach(c => PL.removeClip(c));
    const c = { id: uid(), smp: id, t, s: from, l: to - from, mx: 0, gain: 1 };
    proj.playlist.clips.push(c);
    PL.select([c]);
    commit();
    PL.renderPatterns(); PL.draw(); Tree.render();
    toast(replace ? T('Clip sostituite da una clip audio') : T('Clip audio creata'));
  });
}
// A pattern rendered once (with its mixer effects) as an audio clip on a free track at the song position.
function renderPatternToClip(p) {
  return withRender(T('Rendering del pattern “{0}”', p.name), async () => {
    const { u8, buffer } = await renderToBuffer({ mode: 'pattern', pattern: p.id });
    const id = addSampleFromBytes(p.name + '.wav', u8, buffer), l = patLen(p), s = barAt(ui.songPos || 0).barStart;
    let t = proj.playlist.tracks.findIndex((_, i) => !proj.playlist.clips.some(c => c.t === i && c.s < s + l && c.s + c.l > s));
    if (t < 0) t = 0;
    const c = { id: uid(), smp: id, t, s, l, mx: 0, gain: 1 };
    proj.playlist.clips.push(c);
    PL.select([c]);
    commit();
    if (ui.mode !== 'song') setMode('song');
    PL.renderPatterns(); PL.draw(); Tree.render();
    toast(T('Pattern renderizzato in una clip audio sulla {0}', proj.playlist.tracks[t].name));
  });
}

/* ---------- Clip editing ---------- */
function splitClip(c, at) {
  if (at <= c.s || at >= c.s + c.l) return null;
  const right = { ...c, id: uid(), s: at, l: c.s + c.l - at, o: (c.o || 0) + (at - c.s) };
  c.l = at - c.s;
  if (c.smp) { right.fin = 0; c.fout = 0; }
  proj.playlist.clips.push(right);
  return right;
}
function nextCopyName(name) {
  const base = name.replace(/ #\d+$/, '');
  let k = 2;
  while (proj.patterns.some(p => p.name === base + ' #' + k)) k++;
  return base + ' #' + k;
}
// Make unique: the clip gets its own copy of the pattern, so editing it leaves the other clips alone.
function makeUnique(c) {
  const p = patById(c.p);
  if (!p) return;
  const q = JSON.parse(JSON.stringify(p));
  q.id = uid();
  q.name = nextCopyName(p.name);
  proj.patterns.splice(proj.patterns.indexOf(p) + 1, 0, q);
  c.p = q.id;
  commit();
  selectPattern(q.id, true);
  renderAll();
  hint(T('“{0}”: pattern unico per questa clip', q.name));
}
// Merge pattern clips: one new pattern holding what the selected clips play, where they play it.
function mergePatternClips(list) {
  list = list.filter(c => c.p && patById(c.p));
  if (list.length < 2) { toast(T('Seleziona almeno due clip di pattern')); return; }
  const from = Math.min(...list.map(c => c.s)), to = Math.max(...list.map(c => c.s + c.l));
  if (to - from > 512) { toast(T('Le clip coprono più di 512 passi: troppo per un pattern solo')); return; }
  const first = patById(list[0].p), base = T('{0} unito', first.name.replace(/ #\d+$/, ''));
  const q = newPattern(proj.patterns.some(p => p.name === base) ? nextCopyName(base) : base, first.color);
  q.len = Math.ceil(to - from);
  for (const c of list) {
    const p = patById(c.p), L = patLen(p), off = c.o || 0;
    for (const [chId, notes] of Object.entries(p.notes)) {
      const dst = q.notes[chId] = q.notes[chId] || [];
      for (let rep = 0; rep * L < c.l + off; rep++) {
        for (const n of notes) {
          const local = rep * L + n.s - off;
          if (local < 0 || local >= c.l) continue;
          dst.push({ ...n, s: c.s - from + local, l: Math.min(n.l, c.l - local) });
        }
      }
    }
  }
  proj.patterns.push(q);
  const t = Math.min(...list.map(c => c.t));
  list.forEach(c => PL.removeClip(c));
  const c = { id: uid(), p: q.id, t, s: from, l: to - from };
  proj.playlist.clips.push(c);
  PL.select([c]);
  commit();
  selectPattern(q.id, true);
  renderAll();
  toast(T('{0} clip unite nel pattern “{1}”', list.length, q.name));
}
// Fades of two overlapping audio clips on one track become a crossfade over the overlap.
function crossfadeNext(c) {
  const d = nextOverlap(c);
  if (!d) return;
  const ov = c.s + c.l - d.s;
  c.fout = ov; d.fin = ov;
  commit();
  PL.draw();
  hint(T('Dissolvenza incrociata di {0} passi', ov));
}
const nextOverlap = c => proj.playlist.clips.filter(d => d !== c && d.smp && d.t === c.t && d.s > c.s && d.s < c.s + c.l).sort((a, b) => a.s - b.s)[0] || null;
// Fit to tempo: stretch the sample to the nearest whole number of quarter notes at the project tempo.
function fitToTempo(c) {
  const smp = SAMPLES[c.smp];
  if (!smp || !smp.buffer) return;
  const dur = smp.buffer.duration, beats = Math.max(1, Math.round(dur * proj.bpm / 60));
  c.stretch = beats * 60 / proj.bpm / dur;
  c.o = 0;
  c.l = beats * 4;
  commit();
  PL.draw();
  hint(T('Clip adattata al tempo: {0} quarti a {1} BPM', beats, proj.bpm));
}

/* ---------- Song timeline: space, markers, metre ---------- */
function insertSpace(at, len) {
  for (const c of [...proj.playlist.clips]) splitClip(c, at);
  for (const c of proj.playlist.clips) if (c.s >= at) c.s += len;
  for (const m of proj.markers) if (m.s >= at) m.s += len;
  if (proj.loop && proj.loop.s >= at) { proj.loop.s += len; proj.loop.e += len; }
  commit();
  PL.draw();
  hint(T('Inserito spazio: {0} passi alla posizione {1}', len, barAt(at).bar));
}
function deleteSpace(at, len) {
  const end = at + len;
  for (const c of [...proj.playlist.clips]) { splitClip(c, at); }
  for (const c of [...proj.playlist.clips]) { splitClip(c, end); }
  proj.playlist.clips = proj.playlist.clips.filter(c => !(c.s >= at && c.s < end));
  for (const c of proj.playlist.clips) if (c.s >= end) c.s -= len;
  proj.markers = proj.markers.filter(m => !(m.s >= at && m.s < end));
  for (const m of proj.markers) if (m.s >= end) m.s -= len;
  if (proj.loop) { if (proj.loop.s >= end) { proj.loop.s -= len; proj.loop.e -= len; } else if (proj.loop.e > at) delete proj.loop; }
  PL.sel.clear();
  commit();
  PL.draw();
  hint(T('Eliminato spazio: {0} passi', len));
}
const METRES = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8], [2, 2], [3, 2], [7, 16]];
function addMarker(s, act = '', extra = {}) {
  const name = act === 'ts' ? extra.num + '/' + extra.den : T('Marcatore {0}', proj.markers.filter(m => m.act !== 'ts').length + 1);
  const m = { id: uid(), s: Math.max(0, Math.round(s)), name, act, ...extra };
  proj.markers = normalizeMarkers([...proj.markers.filter(k => !(act === 'ts' && k.act === 'ts' && k.s === m.s)), m]);
  commit();
  PL.draw();
  PR.draw();
  return proj.markers.find(k => k.id === m.id);
}
function renameMarker(m, rect) {
  inlineEdit({ getBoundingClientRect: () => rect }, m.name, v => { m.name = v.slice(0, 40); commit(); PL.draw(); });
}
function markerMenu(m, x, y) {
  const acts = Object.entries(MARKER_ACTS).filter(([k]) => k !== 'ts');
  openMenu(x, y, [
    { title: (m.name || T('Marcatore')) + ' · ' + T('battuta {0}', barAt(m.s).bar) },
    { label: T('Vai al marcatore'), action: () => { ui.songPos = m.s; if (ui.mode !== 'song') setMode('song'); else Transport.restart(); onTransportChange(); } },
    { label: T('Rinomina…'), action: () => renameMarker(m, { left: x, top: y, width: 160, height: 24 }) },
    m.act === 'ts'
      ? { label: T('Metro: {0}', m.num + '/' + m.den), sub: METRES.map(([n, d]) => ({ label: n + '/' + d, checked: m.num === n && m.den === d, action: () => { m.num = n; m.den = d; m.name = n + '/' + d; commit(); PL.draw(); PR.draw(); } })) }
      : { label: T('Azione: {0}', T(MARKER_ACTS[m.act])), sub: acts.map(([k, l]) => ({ label: T(l), checked: m.act === k, action: () => { m.act = k; commit(); PL.draw(); } })) },
    '-',
    { label: T('Elimina il marcatore'), danger: true, action: () => { proj.markers = proj.markers.filter(k => k !== m); commit(); PL.draw(); PR.draw(); } },
  ]);
}
function setProjectMetre(num, den) {
  proj.ts = { num, den };
  commit();
  renderAll();
  hint(T('Metro del progetto: {0}', num + '/' + den));
}
function metreMenuItems() {
  return METRES.map(([n, d]) => ({ label: n + '/' + d, checked: proj.ts.num === n && proj.ts.den === d, action: () => setProjectMetre(n, d) }));
}

/* ---------- Arrangements ---------- */
const curArrangement = () => proj.arrangements.find(a => a.id === proj.arrId);
function switchArrangement(id) {
  const target = proj.arrangements.find(a => a.id === id), cur = curArrangement();
  if (!target || target === cur) return;
  if (Transport.playing) Transport.stop();
  cur.playlist = proj.playlist; cur.markers = proj.markers; cur.loop = proj.loop || null;
  proj.playlist = normalizePlaylist(target.playlist, proj);
  proj.markers = normalizeMarkers(target.markers);
  if (target.loop) proj.loop = target.loop; else delete proj.loop;
  target.playlist = null; target.markers = []; target.loop = null;
  proj.arrId = target.id;
  ui.songPos = 0;
  PL.sel.clear();
  commit();
  rebuildEngine();
  renderAll();
  hint(T('Arrangiamento: {0}', target.name));
}
function newArrangement(clone) {
  const cur = curArrangement(), id = uid();
  const playlist = clone ? JSON.parse(JSON.stringify(proj.playlist)) : { tracks: proj.playlist.tracks.map(t => ({ name: t.name, mute: false, color: t.color, h: t.h, sub: t.sub })), clips: [] };
  if (clone) playlist.clips.forEach(c => { c.id = uid(); });
  const name = clone ? cur.name.replace(/ #\d+$/, '') + ' #' + (proj.arrangements.length + 1) : T('Arrangiamento {0}', proj.arrangements.length + 1);
  proj.arrangements.splice(proj.arrangements.indexOf(cur) + 1, 0, { id, name, playlist, markers: clone ? JSON.parse(JSON.stringify(proj.markers)) : [], loop: clone && proj.loop ? { ...proj.loop } : null });
  switchArrangement(id);
}
function deleteArrangement() {
  if (proj.arrangements.length < 2) return;
  const cur = curArrangement(), i = proj.arrangements.indexOf(cur), next = proj.arrangements[i + 1] || proj.arrangements[i - 1];
  switchArrangement(next.id);
  proj.arrangements = proj.arrangements.filter(a => a !== cur);
  commit();
  renderAll();
  toast(T('Arrangiamento “{0}” eliminato (Ctrl+Z per annullare)', cur.name));
}
function arrangementMenu(anchor) {
  const cur = curArrangement();
  menuAt(anchor, [
    { title: T('Arrangiamenti') },
    ...proj.arrangements.map(a => ({ label: a.name, checked: a === cur, action: () => switchArrangement(a.id) })),
    '-',
    { label: T('Nuovo arrangiamento'), action: () => newArrangement(false) },
    { label: T('Clona questo arrangiamento'), action: () => newArrangement(true) },
    { label: T('Rinomina…'), action: () => inlineEdit(anchor, cur.name, v => { cur.name = v.slice(0, 40); commit(); PL.renderTitle(); }) },
    { label: T('Elimina questo arrangiamento'), danger: true, disabled: proj.arrangements.length < 2, action: deleteArrangement },
  ]);
}
