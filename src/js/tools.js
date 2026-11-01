'use strict';
/* Ritmo Studio — creative tools: Loop Starter, Chord Progression Tool, chord detection panel, Score Logger,
   Audio Logger, MIDI import/export and the welcome window. */

function freeInsert() {
  const used = new Set(proj.channels.map(c => c.mixer));
  for (let i = 1; i <= numInserts(); i++) if (!used.has(i)) return i;
  return 0;
}
/** Finds the channel tagged with a Loop Starter role, or creates it. */
function roleChannel(role, type, name, params = {}) {
  let ch = proj.channels.find(c => c.ls === role && c.type === type);
  if (!ch) {
    const mixer = freeInsert();
    ch = newChannel(type, { name, mixer, color: COLORS[proj.channels.length % COLORS.length], params });
    ch.ls = role;
    proj.channels.push(ch);
    if (mixer && isDefaultInsertName(proj.mixer[mixer].name)) proj.mixer[mixer].name = name;
  }
  return ch;
}
const keyName = (root, mode) => (mode === 'minor' ? T('{0} minore', NOTE_NAMES[root]) : T('{0} maggiore', NOTE_NAMES[root]));

/* ---------- Loop Starter ---------- */
const LoopStarter = {
  st: { genre: 'house', root: 9, mode: 'minor', autoTempo: true, patId: null, seeds: {} },
  open() { this.render(); WM.open('loopstarter'); },
  render() {
    const body = $('#loopstarter-body'), st = this.st;
    body.textContent = '';
    body.appendChild(h('p', 'tool-intro', T('Genera un loop di 4 battute con gli strumenti interni: batteria, basso, accordi e melodia nella tonalità scelta. I dadi rigenerano una parte alla volta.')));
    const row = h('div', 'ed-row');
    const lg = h('label', null, T('Genere')), sg = h('select');
    Object.entries(GENRES).forEach(([k, g]) => sg.appendChild(new Option(g.label, k)));
    sg.value = st.genre;
    sg.addEventListener('change', () => { st.genre = sg.value; });
    lg.appendChild(sg);
    const lk = h('label', null, T('Tonalità')), wrap = h('span', 'pair'), sr = h('select'), sm = h('select');
    NOTE_NAMES.forEach((n, i) => sr.appendChild(new Option(n, i)));
    sm.appendChild(new Option(T('minore'), 'minor'));
    sm.appendChild(new Option(T('maggiore'), 'major'));
    sr.value = String(st.root);
    sm.value = st.mode;
    sr.addEventListener('change', () => { st.root = +sr.value; });
    sm.addEventListener('change', () => { st.mode = sm.value; });
    wrap.append(sr, sm);
    lk.appendChild(wrap);
    row.append(lg, lk);
    body.appendChild(row);
    const at = h('label', 'check');
    const cb = h('input');
    cb.type = 'checkbox';
    cb.checked = st.autoTempo;
    cb.addEventListener('change', () => { st.autoTempo = cb.checked; });
    at.append(cb, h('span', null, T('Tempo automatico (BPM e swing del genere)')));
    body.appendChild(at);
    const parts = h('div', 'parts');
    [['drums', T('Batteria'), T('Nuova variazione di batteria')], ['bass', T('Basso'), T('Nuova variazione di basso')], ['chords', T('Accordi'), T('Nuova variazione di accordi')], ['melody', T('Melodia'), T('Nuova variazione di melodia')]].forEach(([k, label, tip]) => {
      const p = h('div', 'part');
      p.appendChild(h('span', 'part-name', label));
      const dice = h('button', 'tbtn small', '🎲 ' + T('Rigenera'));
      dice.type = 'button';
      dice.disabled = !st.patId || !patById(st.patId);
      dice.title = tip;
      dice.addEventListener('click', () => { st.seeds[k] = Date.now() + Math.floor(Math.random() * 1e6); this.build([k]); });
      p.appendChild(dice);
      parts.appendChild(p);
    });
    body.appendChild(parts);
    const acts = h('div', 'ed-actions');
    const go = h('button', 'tbtn', T('Crea loop'));
    go.type = 'button';
    go.addEventListener('click', () => this.create());
    const play = h('button', 'tbtn', T('Ascolta'));
    play.type = 'button';
    play.disabled = !st.patId || !patById(st.patId);
    play.addEventListener('click', () => { selectPattern(st.patId); if (ui.mode !== 'pattern') setMode('pattern'); Transport.restart(); if (!Transport.playing) Transport.play(); });
    acts.append(go, play);
    body.appendChild(acts);
  },
  create() {
    const st = this.st, g = GENRES[st.genre];
    ['drums', 'bass', 'chords', 'melody'].forEach(k => { st.seeds[k] = Date.now() + Math.floor(Math.random() * 1e6); });
    const pat = newPattern(T('Loop {0} {1}', g.label, keyName(st.root, st.mode)), COLORS[proj.patterns.length % COLORS.length]);
    pat.len = 64;
    proj.patterns.push(pat);
    st.patId = pat.id;
    if (st.autoTempo) { proj.bpm = g.bpm; proj.swing = g.swing; engine && engine.updateTempo(); }
    this.build(['drums', 'bass', 'chords', 'melody']);
    selectPattern(pat.id);
    if (ui.mode !== 'pattern') setMode('pattern');
    this.render();
    toast(T('Loop creato: {0}', pat.name) + (st.autoTempo ? ' · ' + g.bpm + ' BPM' : ''));
  },
  build(parts) {
    const st = this.st, g = GENRES[st.genre], pat = patById(st.patId);
    if (!pat) return toast(T('Crea prima un loop'));
    const set = (ch, notes) => { pat.notes[ch.id] = notes; };
    const progR = rng(st.seeds.chords || 1);
    const progs = PROGRESSIONS.filter(p => p.mode === st.mode && p.deg.length === 4);
    const prog = progs[Math.floor(progR() * progs.length)];
    const chords = progressionChords(prog, st.root, st.mode, st.genre === 'lofi' || st.genre === 'hiphop' ? 4 : 3, 4);
    if (parts.includes('drums')) {
      const r = rng(st.seeds.drums || 2);
      const roles = {
        kick: roleChannel('kick', 'kick', T('Cassa')),
        hat: roleChannel('hat', 'hat', T('Hi-hat')),
      };
      const out = { kick: [], snare: [], clap: [], hat: [], ohat: [] };
      for (let b = 0; b < 4; b++) {
        const bar = drumBar(st.genre, r);
        for (const k of Object.keys(bar)) for (const [s, v] of bar[k]) out[k].push({ s: b * SPB + s, l: s % 1 ? 0.25 : 1, m: 60, v });
      }
      if (out.snare.length) roles.snare = roleChannel('snare', 'snare', T('Rullante'));
      if (out.clap.length) roles.clap = roleChannel('clap', 'clap', T('Clap'));
      if (out.ohat.length) roles.ohat = roleChannel('ohat', 'ohat', T('Hi-hat aperto'));
      for (const [k, ch] of Object.entries(roles)) set(ch, out[k]);
    }
    if (parts.includes('bass')) {
      const is808 = ['trap', 'hiphop', 'dnb'].includes(st.genre);
      const ch = is808 ? roleChannel('bass', 'bass808', T('Basso 808'), { decay: 1.1, glide: 0.25, drive: 0.4 })
        : roleChannel('bass', 'synth', T('Basso synth'), { w1: 'sawtooth', w2: 'square', mix: 0.4, oct2: -1, cut: 700, res: 4, env: 0.5, a: 0.003, d: 0.25, s: 0.4, r: 0.08, gain: 0.7 });
      set(ch, bassLine(chords, { style: g.bass, octave: is808 ? 1 : 2, seed: st.seeds.bass }));
    }
    if (parts.includes('chords')) {
      const type = g.chordInst;
      const params = type === 'synth' ? { w1: 'sawtooth', w2: 'sawtooth', det: 18, cut: 2400, env: 0.3, a: 0.004, d: 0.18, s: 0.25, r: 0.12, gain: 0.45 } : {};
      const ch = roleChannel('chords', type, type === 'epiano' ? T('Piano elettrico') : type === 'pluck' ? T('Pluck accordi') : type === 'synth' ? T('Stab') : T('Pad'));
      const notes = [];
      let prev = null;
      chords.forEach((c, i) => {
        const v = voiceLead(c.notes, prev, 62);
        prev = v;
        const o = i * SPB;
        const hits = g.keys === 'stab' ? [[2, 1], [6, 1], [10, 1], [14, 1]] : g.keys === 'hold' ? [[0, 16]] : [[0, 16]];
        for (const [s, l] of hits) for (const m of v) notes.push({ s: o + s, l, m, v: 0.72 });
      });
      set(ch, notes);
    }
    if (parts.includes('melody')) {
      const ch = roleChannel('melody', 'pluck', T('Melodia'), { bright: 0.6, decay: 1.2 });
      set(ch, riffMachine({ steps: 64, root: st.root, type: st.mode, base: 72, density: st.genre === 'lofi' ? 0.4 : 0.55, chords, seed: st.seeds.melody }));
    }
    commit();
    renderAll();
    if (parts.length === 1) hint(T('Nuova variazione: {0}', ({ drums: T('batteria'), bass: T('basso'), chords: T('accordi ({0})', chords.map(c => c.name).join(' – ')), melody: T('melodia') })[parts[0]]));
  },
};

/* ---------- Chord Progression Tool ---------- */
const ChordTool = {
  st: { root: 0, mode: 'major', prog: 0, size: 3, perBar: 1, octave: 4, voice: true, chordCh: '', bass: true, bassCh: '' },
  open() { this.render(); WM.open('chordtool'); },
  chords() {
    const st = this.st, prog = PROGRESSIONS[st.prog];
    return progressionChords({ deg: prog.deg }, st.root, st.mode, st.size, st.octave);
  },
  render() {
    const body = $('#chordtool-body'), st = this.st;
    body.textContent = '';
    const sel = (label, opts, value, onChange) => {
      const l = h('label', null, label), s = h('select');
      opts.forEach(([v, t]) => s.appendChild(new Option(t, v)));
      s.value = String(value);
      s.addEventListener('change', () => { onChange(s.value); this.render(); });
      l.appendChild(s);
      return l;
    };
    const r1 = h('div', 'ed-row');
    r1.append(
      sel(T('Tonica'), NOTE_NAMES.map((n, i) => [i, n]), st.root, v => { st.root = +v; }),
      sel(T('Modo'), [['major', T('Maggiore')], ['minor', T('Minore')]], st.mode, v => { st.mode = v; const p = PROGRESSIONS.findIndex(x => x.mode === v); if (PROGRESSIONS[st.prog].mode !== v) st.prog = p; }),
    );
    body.appendChild(r1);
    body.appendChild(sel(T('Progressione'), PROGRESSIONS.map((p, i) => [i, p.label + (p.mode !== st.mode ? ' · ' + (p.mode === 'minor' ? T('minore') : T('maggiore')) : '')]), st.prog, v => { st.prog = +v; }));
    const r2 = h('div', 'ed-row');
    r2.append(
      sel(T('Accordi'), [[3, T('Triadi')], [4, T('Settime')], [5, T('None')]], st.size, v => { st.size = +v; }),
      sel(T('Ritmo'), [[1, T('1 accordo per battuta')], [2, T('2 accordi per battuta')], [0.5, T('1 accordo ogni 2 battute')]], st.perBar, v => { st.perBar = +v; }),
    );
    body.appendChild(r2);
    const r3 = h('div', 'ed-row');
    r3.append(
      sel(T('Ottava'), [[3, '3'], [4, '4'], [5, '5']], st.octave, v => { st.octave = +v; }),
      sel(T('Voicing'), [['1', T('Voice leading')], ['0', T('Posizione fondamentale')]], st.voice ? '1' : '0', v => { st.voice = v === '1'; }),
    );
    body.appendChild(r3);
    const chans = proj.channels.map(c => [c.id, c.name]);
    if (!st.chordCh || !chById(st.chordCh)) st.chordCh = ui.selCh || (chans[0] && chans[0][0]) || '';
    const r4 = h('div', 'ed-row');
    r4.append(
      sel(T('Canale accordi'), chans, st.chordCh, v => { st.chordCh = v; }),
      sel(T('Canale basso'), [['', T('— nessun basso —')], ...chans], st.bass ? st.bassCh : '', v => { st.bassCh = v; st.bass = !!v; }),
    );
    body.appendChild(r4);
    const chips = h('div', 'chord-chips');
    this.chords().forEach(c => {
      const b = h('button', 'chip chord-chip', c.name || '?');
      b.type = 'button';
      b.title = T('Ascolta {0}', c.name);
      b.addEventListener('click', () => {
        const ch = chById(st.chordCh);
        if (!ch) return;
        audioReady();
        const toks = c.notes.map(m => engine.noteOn(ch, m, 0.75));
        setTimeout(() => toks.forEach(t => engine.noteOff(t)), 700);
      });
      chips.appendChild(b);
    });
    body.appendChild(chips);
    const go = h('button', 'tbtn', T('Inserisci nel pattern “{0}”', curPat().name));
    go.type = 'button';
    go.addEventListener('click', () => this.insert());
    const acts = h('div', 'ed-actions');
    acts.appendChild(go);
    body.appendChild(acts);
  },
  insert() {
    const st = this.st, ch = chById(st.chordCh), p = curPat();
    if (!ch) return toast(T('Scegli il canale per gli accordi'));
    const chords = this.chords(), len = spb() / st.perBar, notes = [];
    let prev = null;
    chords.forEach((c, i) => {
      const v = st.voice ? voiceLead(c.notes, prev, 12 * (st.octave + 1) + 4) : c.notes;
      prev = v;
      for (const m of v) notes.push({ s: i * len, l: len, m, v: 0.75 });
    });
    p.notes[ch.id] = notes;
    const total = chords.length * len;
    if (p.len < total) p.len = Math.min(512, Math.ceil(total / spb() - 1e-9) * spb());
    const bch = st.bass && chById(st.bassCh);
    if (bch) p.notes[bch.id] = bassLine(chords, { stepsPerChord: len, style: len >= 16 ? 'house' : 'root', octave: 2 });
    commit();
    afterNotesChanged();
    toast(bch ? T('Progressione inserita: {0} + basso', chords.map(c => c.name).join(' – ')) : T('Progressione inserita: {0}', chords.map(c => c.name).join(' – ')));
  },
};

/* ---------- Chord detection panel ---------- */
const ChordPanel = {
  update() {
    if (!WM.isOpen('chords')) return;
    let notes = [], source = '';
    if (held.size) { notes = [...held.values()].map(k => k.m); source = T('Tastiera / MIDI'); }
    else if (PR.sel.size > 1) { notes = [...PR.sel].map(n => n.m); source = T('Note selezionate nel Piano Roll'); }
    $('#chords-name').textContent = notes.length ? (detectChord(notes) || '—') : '—';
    $('#chords-notes').textContent = notes.length ? [...new Set(notes)].sort((a, b) => a - b).map(noteName).join(' · ') : T('Suona un accordo con la tastiera o il MIDI, oppure seleziona delle note nel Piano Roll.');
    $('#chords-source').textContent = source;
  },
};

/* ---------- Score Logger: every note played live, kept for 10 minutes ---------- */
const ScoreLog = {
  events: [], open: new Map(),
  on(key, m, v) { this.open.set(key, { m, v, t0: performance.now() }); },
  off(key) {
    const e = this.open.get(key);
    if (!e) return;
    this.open.delete(key);
    e.t1 = performance.now();
    this.events.push(e);
    const old = performance.now() - 10 * 60 * 1000;
    while (this.events.length && this.events[0].t0 < old) this.events.shift();
  },
  dump() {
    const ch = chById(ui.selCh);
    if (!ch) return toast(T('Seleziona il canale in cui recuperare le note'));
    if (!this.events.length) return toast(T('Nessuna nota suonata negli ultimi 10 minuti'));
    // the last phrase: notes after the last pause longer than 8 seconds
    let i = this.events.length - 1;
    while (i > 0 && this.events[i].t0 - this.events[i - 1].t1 < 8000) i--;
    const phrase = this.events.slice(i), t0 = phrase[0].t0, sps = proj.bpm / 60 * 4 / 1000;
    const notes = phrase.map(e => ({ s: Math.round((e.t0 - t0) * sps * 4) / 4, l: Math.max(0.25, Math.round((e.t1 - e.t0) * sps * 4) / 4), m: e.m, v: e.v }));
    const p = curPat();
    (p.notes[ch.id] = p.notes[ch.id] || []).push(...notes);
    PR.sel = new Set(notes);
    commit();
    afterNotesChanged();
    WM.open('piano');
    toast(T('Score Logger: {0} note recuperate in {1}', notes.length, ch.name));
  },
};

/* ---------- Audio Logger: the last 60 seconds of the master ---------- */
async function saveAudioLog() {
  if (engine && engine.native) return NativeTools.audioLog();
  const buf = engine && engine.loggedAudio ? engine.loggedAudio() : null;
  if (!buf) return toast(T('Audio Logger vuoto: suona qualcosa e riprova'));
  await saveFile(safeName(proj.name) + ' - ' + T('ultimi {0} s', Math.round(buf.duration)) + '.wav', encodeWav(buf));
}

/* ---------- MIDI files ---------- */
function exportMidi() {
  const tracks = [];
  const add = (ch, notes) => { if (notes.length) tracks.push({ name: ch.name, channel: ['kick', 'snare', 'clap', 'hat', 'ohat', 'tom', 'cowbell', 'crash'].includes(ch.type) ? 9 : tracks.length % 9, notes }); };
  if (ui.mode === 'song' && proj.playlist.clips.length) {
    for (const ch of proj.channels) {
      const notes = [];
      for (const c of proj.playlist.clips) {
        if (c.mu || (proj.playlist.tracks[c.t] || {}).mute) continue;
        const p = patById(c.p);
        if (!p) continue;
        const L = patLen(p), off = c.o || 0;
        for (const n of p.notes[ch.id] || []) {
          if (n.mu) continue;
          for (let k = 0; k * L < c.l + off; k++) {
            const local = k * L + n.s - off;
            if (local >= 0 && local < c.l) notes.push({ ...n, s: c.s + local });
          }
        }
      }
      add(ch, notes.sort((a, b) => a.s - b.s));
    }
  } else {
    const p = curPat();
    for (const ch of proj.channels) add(ch, (p.notes[ch.id] || []).filter(n => !n.mu));
  }
  if (!tracks.length) return toast(T('Nessuna nota da esportare'));
  saveFile(safeName(proj.name) + '.mid', new Blob([writeMidi(tracks, proj.bpm, 96, proj.ts)], { type: 'audio/midi' }));
}
const GM_DRUMS = { 35: 'kick', 36: 'kick', 37: 'snare', 38: 'snare', 40: 'snare', 39: 'clap', 42: 'hat', 44: 'hat', 46: 'ohat', 49: 'crash', 57: 'crash', 51: 'crash', 41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom', 50: 'tom', 56: 'cowbell' };
async function importMidiFile(file) {
  try {
    const midi = readMidi(new Uint8Array(await file.arrayBuffer()));
    if (!midi.tracks.length) return toast(T('Il file MIDI non contiene note'));
    const pat = newPattern('MIDI ' + file.name.replace(/\.midi?$/i, '').slice(0, 24), COLORS[proj.patterns.length % COLORS.length]);
    let end = 16;
    for (const t of midi.tracks) {
      if (t.channel === 9) {
        const byType = {};
        for (const n of t.notes) { const type = GM_DRUMS[n.m] || 'tom'; (byType[type] = byType[type] || []).push(n); }
        for (const [type, notes] of Object.entries(byType)) {
          const mixer = freeInsert();
          const ch = newChannel(type, { name: INSTRUMENTS[type].label, mixer, color: COLORS[proj.channels.length % COLORS.length] });
          proj.channels.push(ch);
          pat.notes[ch.id] = notes.map(n => ({ s: n.s, l: Math.min(n.l, 1), m: ch.root, v: n.v }));
        }
      } else {
        const mixer = freeInsert();
        const ch = newChannel('synth', { name: t.name.slice(0, 30), mixer, color: COLORS[proj.channels.length % COLORS.length] });
        proj.channels.push(ch);
        pat.notes[ch.id] = t.notes.map(n => ({ s: n.s, l: n.l, m: n.m, v: n.v }));
      }
      for (const n of t.notes) end = Math.max(end, n.s + n.l);
    }
    pat.len = Math.min(512, Math.ceil(end / spb() - 1e-9) * spb());
    proj.patterns.push(pat);
    proj.bpm = clamp(Math.round(midi.bpm * 10) / 10, 40, 300);
    if (midi.ts && midi.ts.num >= 1 && midi.ts.num <= 16 && [2, 4, 8, 16].includes(midi.ts.den)) proj.ts = { num: midi.ts.num, den: midi.ts.den };
    engine && engine.updateTempo();
    commit();
    selectPattern(pat.id);
    renderAll();
    toast(T('MIDI importato: {0} tracce, {1} BPM', midi.tracks.length, proj.bpm));
  } catch (e) {
    toast(T('Impossibile leggere il MIDI: {0}', e.message || e));
  }
}

/* ---------- Welcome window ---------- */
const Welcome = {
  render() {
    const body = $('#welcome-body');
    body.textContent = '';
    const big = (label, sub, fn) => {
      const b = h('button', 'welcome-btn');
      b.type = 'button';
      b.append(h('b', null, label), h('span', null, sub));
      b.addEventListener('click', () => { WM.close('welcome'); fn(); });
      return b;
    };
    const grid = h('div', 'welcome-grid');
    grid.append(
      big(T('Riprendi'), T('{0} · {1} canali', proj.name, proj.channels.length), () => {}),
      big(T('Nuovo progetto'), T('Kit base: cassa, clap, hi-hat, rullante'), newProject),
      big(T('Loop Starter'), T('Un’idea pronta per genere e tonalità'), () => LoopStarter.open()),
      big(T('Progetto demo'), T('“Mezzanotte”, 16 battute'), loadDemo),
      big(T('Apri progetto…'), T('File {0}', '.ritmo.json'), openProjectDialog),
      big(T('Importa MIDI…'), T('File {0} o {1}', '.mid', '.midi'), pickMidiFile),
    );
    body.appendChild(grid);
    const tips = h('ul', 'welcome-tips');
    [T('Spazio avvia e ferma; F6, F7 e F9 aprono Channel Rack, Piano Roll e Mixer.'),
     T('Nel Piano Roll: strumenti Disegna, Pennello, Cancella, Muta, Taglia e Seleziona; Chord Stamp e scale.'),
     T('Strumenti › Score Logger recupera le note che hai suonato anche senza registrare.'),
     T('Strumenti › Audio Logger salva gli ultimi 60 secondi del master.')]
      .forEach(t => tips.appendChild(h('li', null, t)));
    body.appendChild(tips);
    const lab = h('label', 'check'), cb = h('input');
    cb.type = 'checkbox';
    cb.checked = !!ui.noWelcome;
    cb.addEventListener('change', () => { ui.noWelcome = cb.checked; savePrefs(); });
    lab.append(cb, h('span', null, T('Non mostrare all’avvio')));
    body.appendChild(lab);
  },
  open() { this.render(); WM.open('welcome'); },
};
function pickMidiFile() { const i = $('#file-midi'); i.value = ''; i.click(); }
