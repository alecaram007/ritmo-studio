'use strict';
/* Ritmo Studio — music theory: scales, chords, chord detection, voice leading, progressions,
   melody / bass / drum generators (Riff Machine, Loop Starter) and Standard MIDI Files. */

const SCALES = {
  none: { label: T('Nessuna'), steps: null },
  major: { label: T('Maggiore'), steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: T('Minore naturale'), steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { label: T('Minore armonica'), steps: [0, 2, 3, 5, 7, 8, 11] },
  melodic: { label: T('Minore melodica'), steps: [0, 2, 3, 5, 7, 9, 11] },
  dorian: { label: T('Dorica'), steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: T('Frigia'), steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: T('Lidia'), steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: T('Misolidia'), steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { label: T('Locria'), steps: [0, 1, 3, 5, 6, 8, 10] },
  pentaMaj: { label: T('Pentatonica maggiore'), steps: [0, 2, 4, 7, 9] },
  pentaMin: { label: T('Pentatonica minore'), steps: [0, 3, 5, 7, 10] },
  blues: { label: T('Blues'), steps: [0, 3, 5, 6, 7, 10] },
};

const CHORDS = {
  maj: { label: T('Maggiore'), iv: [0, 4, 7], sym: '' },
  min: { label: T('Minore'), iv: [0, 3, 7], sym: 'm' },
  dim: { label: T('Diminuito'), iv: [0, 3, 6], sym: 'dim' },
  aug: { label: T('Aumentato'), iv: [0, 4, 8], sym: 'aug' },
  sus2: { label: 'Sus2', iv: [0, 2, 7], sym: 'sus2' },
  sus4: { label: 'Sus4', iv: [0, 5, 7], sym: 'sus4' },
  pow: { label: T('Bicordo (5)'), iv: [0, 7, 12], sym: '5' },
  six: { label: T('Sesta'), iv: [0, 4, 7, 9], sym: '6' },
  min6: { label: T('Minore sesta'), iv: [0, 3, 7, 9], sym: 'm6' },
  dom7: { label: T('Settima'), iv: [0, 4, 7, 10], sym: '7' },
  maj7: { label: T('Settima maggiore'), iv: [0, 4, 7, 11], sym: 'maj7' },
  min7: { label: T('Minore settima'), iv: [0, 3, 7, 10], sym: 'm7' },
  minMaj7: { label: T('Minore settima maggiore'), iv: [0, 3, 7, 11], sym: 'm(maj7)' },
  m7b5: { label: T('Semidiminuito'), iv: [0, 3, 6, 10], sym: 'm7b5' },
  dim7: { label: T('Settima diminuita'), iv: [0, 3, 6, 9], sym: 'dim7' },
  add9: { label: 'Add9', iv: [0, 4, 7, 14], sym: 'add9' },
  madd9: { label: T('Minore add9'), iv: [0, 3, 7, 14], sym: 'madd9' },
  dom9: { label: T('Nona'), iv: [0, 4, 7, 10, 14], sym: '9' },
  maj9: { label: T('Nona maggiore'), iv: [0, 4, 7, 11, 14], sym: 'maj9' },
  min9: { label: T('Minore nona'), iv: [0, 3, 7, 10, 14], sym: 'm9' },
  dom11: { label: T('Undicesima'), iv: [0, 7, 10, 14, 17], sym: '11' },
  min11: { label: T('Minore undicesima'), iv: [0, 3, 7, 10, 14, 17], sym: 'm11' },
  dom13: { label: T('Tredicesima'), iv: [0, 4, 7, 10, 14, 21], sym: '13' },
};

const pc = m => ((m % 12) + 12) % 12;
const pcName = p => NOTE_NAMES[pc(p)];
const scaleSteps = (type) => (SCALES[type] && SCALES[type].steps) || null;
function inScale(m, root, type) {
  const st = scaleSteps(type);
  return !st || st.includes(pc(m - root));
}
/** Moves a note to the nearest pitch of the scale (ties go up). */
function snapToScale(m, root, type) {
  const st = scaleSteps(type);
  if (!st) return m;
  for (let d = 0; d < 12; d++) {
    if (st.includes(pc(m + d - root))) return m + d;
    if (st.includes(pc(m - d - root))) return m - d;
  }
  return m;
}

/** Chord notes for a clicked pitch. topDown: the clicked note is the top voice. */
function buildChord(m, type, topDown) {
  const iv = CHORDS[type] ? CHORDS[type].iv : [0];
  const notes = iv.map(i => m + i);
  if (!topDown) return notes;
  return notes.map((n, i) => (i === 0 ? n : n - 12 * Math.ceil((n - m + 0.5) / 12))).sort((a, b) => a - b);
}

/** Diatonic chord on the scale degree of the clicked note: stacked thirds inside the scale. */
function diatonicChord(m, root, type, size = 3) {
  const st = scaleSteps(type) || SCALES.major.steps;
  const base = snapToScale(m, root, type === 'none' ? 'major' : type);
  const deg = st.indexOf(pc(base - root));
  const n = st.length, out = [];
  for (let k = 0; k < size; k++) {
    const idx = deg + k * 2, oct = Math.floor(idx / n);
    out.push(base - st[deg] + st[idx % n] + 12 * oct);
  }
  return out;
}

/** Name of the chord made by a set of MIDI notes, e.g. "Am7" or "C/E"; '' when none matches. */
function detectChord(notes) {
  const uniq = [...new Set(notes)].sort((a, b) => a - b);
  if (uniq.length < 2) return uniq.length ? noteName(uniq[0]) : '';
  const pcs = [...new Set(uniq.map(pc))];
  const bass = pc(uniq[0]);
  let best = null;
  for (const root of pcs) {
    const set = new Set(pcs.map(p => pc(p - root)));
    for (const [key, ch] of Object.entries(CHORDS)) {
      if (key === 'pow') continue;
      const tpl = new Set(ch.iv.map(pc));
      let hit = 0, miss = 0;
      for (const i of tpl) if (set.has(i)) hit++; else miss++;
      const extra = [...set].filter(i => !tpl.has(i)).length;
      if (!tpl.has(0) || !set.has(0)) continue;
      const score = hit * 3 - miss * 4 - extra * 3 + (root === bass ? 1 : 0) - tpl.size * 0.1;
      if (!best || score > best.score) best = { score, root, key, complete: miss === 0 && extra === 0 };
    }
  }
  if (!best || best.score < 4) return pcs.length === 2 ? pcName(uniq[0]) + ' + ' + pcName(uniq[1]) : '';
  const name = NOTE_NAMES[best.root] + CHORDS[best.key].sym;
  return (best.root !== bass ? name + '/' + NOTE_NAMES[bass] : name) + (best.complete ? '' : ' ' + T('(parziale)'));
}

/** Picks the inversion of `notes` closest to the previous chord, keeping it near `center`. */
function voiceLead(notes, prev, center = 60) {
  const cands = [];
  const sorted = [...notes].sort((a, b) => a - b);
  for (let inv = 0; inv < sorted.length; inv++) {
    const v = sorted.map((n, i) => (i < inv ? n + 12 : n)).sort((a, b) => a - b);
    for (const shift of [-24, -12, 0, 12]) cands.push(v.map(n => n + shift));
  }
  const cost = v => {
    const mid = v.reduce((a, b) => a + b, 0) / v.length;
    let c = Math.abs(mid - center) * 0.6;
    if (prev && prev.length) for (const n of v) c += Math.min(...prev.map(p => Math.abs(p - n)));
    return c;
  };
  return cands.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

const PROGRESSIONS = [
  { label: T('I – V – vi – IV (pop)'), mode: 'major', deg: [0, 4, 5, 3] },
  { label: 'vi – IV – I – V', mode: 'major', deg: [5, 3, 0, 4] },
  { label: T('I – vi – IV – V (anni ’50)'), mode: 'major', deg: [0, 5, 3, 4] },
  { label: T('ii – V – I (jazz)'), mode: 'major', deg: [1, 4, 0, 0] },
  { label: 'I – IV – V – IV', mode: 'major', deg: [0, 3, 4, 3] },
  { label: T('I – V – vi – iii – IV – I – IV – V (Canone)'), mode: 'major', deg: [0, 4, 5, 2, 3, 0, 3, 4] },
  { label: T('i – VI – III – VII (epico)'), mode: 'minor', deg: [0, 5, 2, 6] },
  { label: 'i – iv – v – i', mode: 'minor', deg: [0, 3, 4, 0] },
  { label: 'i – VII – VI – VII', mode: 'minor', deg: [0, 6, 5, 6] },
  { label: T('i – VI – VII – i (trap)'), mode: 'minor', deg: [0, 5, 6, 0] },
  { label: T('i – iv – VI – v (lo-fi)'), mode: 'minor', deg: [0, 3, 5, 4] },
  { label: T('ii – v – i (minore)'), mode: 'minor', deg: [1, 4, 0, 0] },
];

/** Chords (root position) of a progression in a key: [{ root, notes, name }]. */
function progressionChords(prog, keyRoot, mode, size = 3, octave = 4) {
  const type = mode === 'minor' ? 'minor' : 'major';
  const base = 12 * (octave + 1) + keyRoot;
  return prog.deg.map(d => {
    const st = SCALES[type].steps;
    const rootMidi = base + st[d % 7];
    const notes = diatonicChord(rootMidi, keyRoot, type, size);
    return { root: rootMidi, notes, name: detectChord(notes).replace(' ' + T('(parziale)'), '') };
  });
}

/* ---------- generators (seedable randomness keeps the dice reproducible per part) ---------- */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

/** Riff Machine: a melody over `steps` steps inside the scale, with chord tones on strong beats. */
function riffMachine({ steps = 64, root = 9, type = 'minor', base = 72, density = 0.55, chords = null, seed = Date.now() }) {
  const r = rng(seed);
  const st = scaleSteps(type) || SCALES.minor.steps;
  const degreeToMidi = d => base - 12 + root + st[((d % st.length) + st.length) % st.length] + 12 * Math.floor(d / st.length);
  const phrase = [];
  let deg = st.length + Math.floor(r() * 3);
  const half = Math.min(steps, 32);
  for (let s = 0; s < half;) {
    const strong = s % 4 === 0;
    const len = pick(r, strong ? [2, 2, 3, 4] : [1, 2, 2]);
    if (r() < density || strong) {
      deg += pick(r, [-2, -1, -1, 0, 1, 1, 2, 3, -3]);
      deg = clamp(deg, st.length - 2, st.length * 2 + 2);
      let m = degreeToMidi(deg);
      if (chords && strong) {
        const ch = chords[Math.floor(s / SPB) % chords.length];
        const tones = ch.notes.map(pc);
        if (!tones.includes(pc(m))) m = m + [0, -1, 1, -2, 2].find(d => tones.includes(pc(m + d))) || m;
      }
      phrase.push({ s, l: Math.min(len, half - s), m, v: strong ? 0.85 : 0.65 + r() * 0.15 });
    }
    s += len;
  }
  const out = phrase.slice();
  for (let rep = half; rep < steps; rep += half) {
    phrase.forEach((n, i) => {
      const last = rep + half >= steps && i >= phrase.length - 2;
      out.push({ ...n, s: n.s + rep, m: last ? n.m + pick(r, [0, -2, 2, -1]) : n.m });
    });
  }
  return out.filter(n => n.s < steps);
}

/** Bass line following chord roots. */
function bassLine(chords, { stepsPerChord = 16, style = 'root', octave = 2, seed = Date.now() }) {
  const r = rng(seed), out = [];
  chords.forEach((c, i) => {
    const root = 12 * (octave + 1) + pc(c.root), o = i * stepsPerChord;
    const rhythms = {
      root: [[0, stepsPerChord]],
      offbeat: [[2, 2], [6, 2], [10, 2], [14, 2]],
      house: [[0, 3], [3, 1], [6, 2], [10, 2], [14, 2]],
      trap: [[0, 6], [7, 3], [10, 4], [14, 2]],
      boom: [[0, 5], [7, 2], [10, 4]],
      eighth: [[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]],
    }[style] || [[0, stepsPerChord]];
    for (const [s, l] of rhythms) {
      if (s >= stepsPerChord) continue;
      const up = style !== 'root' && r() < 0.18 ? 12 : 0;
      out.push({ s: o + s, l: Math.min(l, stepsPerChord - s), m: root + up, v: s === 0 ? 0.9 : 0.75 });
    }
  });
  return out;
}

const GENRES = {
  house: { label: T('House'), bpm: 124, swing: 0.1, bass: 'offbeat', chordInst: 'synth', keys: 'stab' },
  techno: { label: T('Techno'), bpm: 130, swing: 0, bass: 'eighth', chordInst: 'pad', keys: 'pad' },
  trap: { label: T('Trap'), bpm: 140, swing: 0, bass: 'trap', chordInst: 'pad', keys: 'pad' },
  hiphop: { label: T('Hip Hop (boom bap)'), bpm: 90, swing: 0.35, bass: 'boom', chordInst: 'epiano', keys: 'hold' },
  lofi: { label: T('Lo-fi'), bpm: 78, swing: 0.45, bass: 'root', chordInst: 'epiano', keys: 'hold' },
  reggaeton: { label: T('Reggaeton'), bpm: 95, swing: 0, bass: 'house', chordInst: 'pluck', keys: 'stab' },
  dnb: { label: T('Drum & Bass'), bpm: 174, swing: 0, bass: 'root', chordInst: 'pad', keys: 'pad' },
};

/** Drum parts for one bar, by genre: { kick, snare, clap, hat, ohat } as arrays of [step, velocity]. */
function drumBar(genre, r) {
  const v = (lo, hi) => lo + r() * (hi - lo);
  const g = {
    house: () => ({ kick: [0, 4, 8, 12], clap: [4, 12], hat: [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15].filter(() => r() > 0.1), ohat: [2, 6, 10, 14] }),
    techno: () => ({ kick: [0, 4, 8, 12], clap: r() > 0.5 ? [4, 12] : [12], hat: [...Array(16).keys()], ohat: [2, 6, 10, 14] }),
    trap: () => ({ kick: [0, ...(r() > 0.5 ? [7] : [6]), 10, ...(r() > 0.6 ? [13] : [])], snare: [8], hat: [...Array(16).keys()], roll: r() > 0.4 ? pick(r, [6, 14, 15]) : -1 }),
    hiphop: () => ({ kick: [0, ...(r() > 0.5 ? [7, 10] : [6, 10])], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ohat: r() > 0.6 ? [14] : [] }),
    lofi: () => ({ kick: [0, r() > 0.5 ? 10 : 9], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14].filter(() => r() > 0.15) }),
    reggaeton: () => ({ kick: [0, 4, 8, 12], snare: [3, 6, 11, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14] }),
    dnb: () => ({ kick: [0, 10, ...(r() > 0.5 ? [11] : [])], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], ohat: r() > 0.5 ? [7] : [] }),
  }[genre]();
  const steps = (list, lo, hi) => list.map(s => [s, v(lo, hi)]);
  const out = { kick: steps(g.kick, 0.85, 1), hat: steps(g.hat, 0.4, 0.75) };
  if (g.snare) out.snare = steps(g.snare, 0.8, 0.95);
  if (g.clap) out.clap = steps(g.clap, 0.75, 0.9);
  if (g.ohat && g.ohat.length) out.ohat = steps(g.ohat, 0.5, 0.7);
  if (g.roll != null && g.roll >= 0) out.hat.push(...[0.5, 0.66, 0.83].map((f, i) => [g.roll + f, 0.35 + i * 0.1]));
  return out;
}

/* ---------- Standard MIDI Files ---------- */
function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
/** tracks: [{ name, channel, notes: [{ s, l, m, v }] }] in steps (sixteenths). Returns a type-1 SMF. */
function writeMidi(tracks, bpm, ppq = 96, ts = { num: 4, den: 4 }) {
  const tps = ppq / 4;
  const chunk = (type, body) => {
    const len = body.length;
    return [...type].map(c => c.charCodeAt(0)).concat([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], body);
  };
  const tempo = Math.round(60000000 / bpm);
  const meta = [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255, 0, 0xff, 0x58, 4, ts.num, Math.round(Math.log2(ts.den)), 24, 8, 0, 0xff, 0x2f, 0];
  const chunks = [chunk('MThd', [0, 1, 0, tracks.length + 1, (ppq >> 8) & 255, ppq & 255]), chunk('MTrk', meta)];
  for (const t of tracks) {
    const ev = [];
    for (const n of t.notes) {
      const on = Math.round(n.s * tps), off = Math.max(on + 1, Math.round((n.s + n.l) * tps));
      ev.push({ tick: on, data: [0x90 | t.channel, n.m & 127, Math.max(1, Math.round(n.v * 127))] });
      ev.push({ tick: off, data: [0x80 | t.channel, n.m & 127, 0] });
    }
    ev.sort((a, b) => a.tick - b.tick || (a.data[0] & 0xf0) - (b.data[0] & 0xf0));
    const name = [...new TextEncoder().encode(t.name)];
    const body = [0, 0xff, 0x03, ...vlq(name.length), ...name];
    let last = 0;
    for (const e of ev) { body.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
    body.push(0, 0xff, 0x2f, 0);
    chunks.push(chunk('MTrk', body));
  }
  return new Uint8Array(chunks.flat());
}
/** Parses an SMF into { bpm, tracks: [{ name, channel, notes: [{ s, l, m, v }] }] } with positions in steps. */
function readMidi(u8) {
  let p = 0;
  const str = n => { const s = String.fromCharCode(...u8.subarray(p, p + n)); p += n; return s; };
  const u32 = () => { const v = (u8[p] << 24) | (u8[p + 1] << 16) | (u8[p + 2] << 8) | u8[p + 3]; p += 4; return v >>> 0; };
  const u16 = () => { const v = (u8[p] << 8) | u8[p + 1]; p += 2; return v; };
  const readVlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  if (str(4) !== 'MThd') throw new Error(T('non è un file MIDI'));
  const hlen = u32(); u16(); const ntr = u16(); const div = u16(); p += hlen - 6;
  if (div & 0x8000) throw new Error(T('formato temporale SMPTE non supportato'));
  const tps = div / 4;
  let bpm = 120, ts = null;
  const tracks = [];
  for (let t = 0; t < ntr && p < u8.length; t++) {
    if (str(4) !== 'MTrk') break;
    const end = u32() + p;
    let tick = 0, status = 0, name = '';
    const open = new Map(), notes = [], chans = new Map();
    while (p < end) {
      tick += readVlq();
      let b = u8[p];
      if (b & 0x80) { status = b; p++; } else b = status;
      const type = status & 0xf0, chn = status & 0x0f;
      if (status === 0xff) {
        const mt = u8[p++], len = readVlq();
        if (mt === 0x51 && len === 3) bpm = 60000000 / ((u8[p] << 16) | (u8[p + 1] << 8) | u8[p + 2]);
        if (mt === 0x58 && len >= 2 && !ts) ts = { num: u8[p], den: Math.pow(2, u8[p + 1]) };
        if (mt === 0x03) name = new TextDecoder().decode(u8.subarray(p, p + len));
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        p += readVlq();
      } else if (type === 0x90 || type === 0x80) {
        const note = u8[p++], vel = u8[p++], key = chn * 128 + note;
        if (type === 0x90 && vel > 0) { open.set(key, { tick, vel, chn }); }
        else if (open.has(key)) {
          const o = open.get(key); open.delete(key);
          notes.push({ s: o.tick / tps, l: Math.max(0.25, (tick - o.tick) / tps), m: note, v: o.vel / 127, chn: o.chn });
          chans.set(o.chn, (chans.get(o.chn) || 0) + 1);
        }
      } else if (type === 0xc0 || type === 0xd0) p += 1;
      else p += 2;
    }
    p = end;
    if (notes.length) {
      const channel = [...chans.entries()].sort((a, b) => b[1] - a[1])[0][0];
      tracks.push({ name: name || T('Traccia {0}', tracks.length + 1), channel, notes });
    }
  }
  return { bpm, tracks, ts };
}
