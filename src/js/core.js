'use strict';
/* Ritmo Studio — core: helpers, instrument and effect catalog, data model, demo song, undo history, persistence */

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 10);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const dbToGain = db => Math.pow(10, db / 20);
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = m => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const isBlack = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const alphaHex = a => Math.round(clamp(a, 0, 1) * 255).toString(16).padStart(2, '0');
const safeName = s => (s || T('progetto')).replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || T('progetto');

const SPB = 16;          // steps (sixteenth notes) per bar
const NUM_INSERTS = 125; // mixer inserts, plus the master at index 0 and the current-channel view
const MAX_INSERTS = 125;
const FX_SLOTS = 10;
const COLORS = ['#e8b55e', '#5ccab6', '#e7795b', '#8fa7f4', '#d682c6', '#9dcb6c', '#ead27c', '#6cc0e2', '#e48d98', '#b39cec', '#7fd5a2', '#f0a56c'];

/* ---------- Parameter specs ---------- */
function P(label, min, max, def, o = {}) { return { label, min, max, def, ...o }; }
function S(label, options, def) { return { label, options, def, select: true }; }
const WAVES = [['sine', T('Sinusoide')], ['triangle', T('Triangolo')], ['sawtooth', T('Dente di sega')], ['square', T('Quadra')]];
const defaults = spec => Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, v.def]));

const INSTRUMENTS = {
  kick: { label: T('Cassa'), group: TM('Batteria'), glyph: 'K', params: {
    tune: P(T('Intonazione'), -12, 12, 0, { unit: 'st', step: 1 }), decay: P(T('Decadimento'), 0.1, 1.6, 0.5, { unit: 's' }),
    punch: P(T('Punch'), 0, 1, 0.55), click: P(T('Click'), 0, 1, 0.3), drive: P(T('Saturazione'), 0, 1, 0.15) } },
  snare: { label: T('Rullante'), group: TM('Batteria'), glyph: 'SN', params: {
    tune: P(T('Intonazione'), -12, 12, 0, { unit: 'st', step: 1 }), decay: P(T('Decadimento'), 0.05, 0.8, 0.22, { unit: 's' }),
    tone: P(T('Corpo'), 0, 1, 0.45), snappy: P(T('Cordiera'), 0, 1, 0.7) } },
  clap: { label: T('Clap'), group: TM('Batteria'), glyph: 'CP', params: {
    tone: P(T('Tono'), 600, 4000, 1300, { unit: 'Hz', log: true }), decay: P(T('Coda'), 0.05, 1, 0.28, { unit: 's' }),
    spread: P(T('Apertura'), 0.004, 0.03, 0.011, { unit: 's' }) } },
  hat: { label: T('Hi-hat chiuso'), group: TM('Batteria'), glyph: 'HH', params: {
    tone: P(T('Brillantezza'), 0, 1, 0.6), decay: P(T('Decadimento'), 0.02, 0.4, 0.07, { unit: 's' }) } },
  ohat: { label: T('Hi-hat aperto'), group: TM('Batteria'), glyph: 'OH', mono: true, params: {
    tone: P(T('Brillantezza'), 0, 1, 0.55), decay: P(T('Decadimento'), 0.1, 1.5, 0.42, { unit: 's' }) } },
  tom: { label: T('Tom'), group: TM('Batteria'), glyph: 'T', params: {
    tune: P(T('Intonazione'), -12, 12, 0, { unit: 'st', step: 1 }), decay: P(T('Decadimento'), 0.1, 1.2, 0.4, { unit: 's' }),
    sweep: P(T('Glissato'), 0, 1, 0.5) } },
  cowbell: { label: T('Campanaccio'), group: TM('Batteria'), glyph: 'CB', params: {
    tune: P(T('Intonazione'), -12, 12, 0, { unit: 'st', step: 1 }), decay: P(T('Decadimento'), 0.05, 1, 0.3, { unit: 's' }) } },
  crash: { label: T('Piatto'), group: TM('Batteria'), glyph: 'CR', mono: true, params: {
    tone: P(T('Brillantezza'), 0, 1, 0.4), decay: P(T('Decadimento'), 0.3, 4, 1.8, { unit: 's' }) } },
  bass808: { label: T('Basso 808'), group: TM('Synth'), glyph: '808', melodic: true, mono: true, params: {
    decay: P(T('Decadimento'), 0.2, 4, 1.2, { unit: 's' }), glide: P(T('Glissato'), 0, 1, 0.3),
    drive: P(T('Saturazione'), 0, 1, 0.3), tone: P(T('Tono'), 200, 8000, 2400, { unit: 'Hz', log: true }) } },
  synth: { label: T('Synth sottrattivo'), group: TM('Synth'), glyph: 'SY', melodic: true, params: {
    w1: S(T('Onda 1'), WAVES, 'sawtooth'), w2: S(T('Onda 2'), WAVES, 'square'),
    mix: P(T('Miscela osc'), 0, 1, 0.35), det: P(T('Detune'), 0, 50, 8, { unit: 'ct' }), oct2: P(T('Ottava osc 2'), -2, 2, 0, { step: 1 }),
    cut: P(T('Cutoff'), 60, 18000, 2200, { unit: 'Hz', log: true }), res: P(T('Risonanza'), 0, 18, 3, { step: 0.1 }), env: P(T('Inv. filtro'), 0, 1, 0.4),
    a: P(T('Attacco'), 0.001, 2, 0.005, { unit: 's', log: true }), d: P(T('Decadimento'), 0.01, 3, 0.35, { unit: 's', log: true }),
    s: P(T('Sustain'), 0, 1, 0.6), r: P(T('Rilascio'), 0.01, 4, 0.25, { unit: 's', log: true }), gain: P(T('Livello'), 0, 1, 0.6) } },
  pad: { label: T('Pad'), group: TM('Synth'), glyph: 'PD', melodic: true, params: {
    det: P(T('Detune'), 0, 60, 22, { unit: 'ct' }), cut: P(T('Cutoff'), 100, 12000, 1600, { unit: 'Hz', log: true }), res: P(T('Risonanza'), 0, 12, 1, { step: 0.1 }),
    a: P(T('Attacco'), 0.01, 4, 0.9, { unit: 's', log: true }), s: P(T('Sustain'), 0, 1, 0.8), r: P(T('Rilascio'), 0.05, 6, 1.6, { unit: 's', log: true }),
    gain: P(T('Livello'), 0, 1, 0.45) } },
  pluck: { label: T('Pluck'), group: TM('Synth'), glyph: 'PL', melodic: true, params: {
    bright: P(T('Brillantezza'), 0, 1, 0.6), decay: P(T('Decadimento'), 0.2, 6, 1.6, { unit: 's' }), gain: P(T('Livello'), 0, 1, 0.7) } },
  epiano: { label: T('E-Piano FM'), group: TM('Synth'), glyph: 'EP', melodic: true, params: {
    ratio: P(T('Rapporto FM'), 0.5, 8, 1, { step: 0.5 }), index: P(T('Indice FM'), 0, 10, 2.2, { step: 0.1 }),
    decay: P(T('Decadimento'), 0.2, 6, 1.8, { unit: 's' }), r: P(T('Rilascio'), 0.02, 3, 0.35, { unit: 's' }),
    trem: P(T('Tremolo'), 0, 1, 0.2), gain: P(T('Livello'), 0, 1, 0.55) } },
  // Each param has a tab: 'smp' sample, 'env' envelopes and filter, 'lfo' modulation (see the channel settings window)
  sampler: { label: T('Sampler'), group: TM('Campionatore'), glyph: 'SA', melodic: true, params: {
    pitch: P(T('Intonazione'), -24, 24, 0, { unit: 'st', step: 1 }), gain: P(T('Livello'), 0, 1.5, 1),
    cut: S(T('Durata'), [['full', T('Intero campione')], ['note', T('Segue la nota')]], 'full'),
    rev: S(T('Direzione'), [['fwd', T('Avanti')], ['rev', T('Al contrario')]], 'fwd'),
    start: P(T('Inizio'), 0, 1, 0, { unit: '%', tab: 'smp' }), end: P(T('Fine'), 0, 1, 1, { unit: '%', tab: 'smp' }),
    fin: P(T('Dissolvenza in entrata'), 0, 2, 0, { unit: 's', tab: 'smp' }), fout: P(T('Dissolvenza in uscita'), 0, 2, 0, { unit: 's', tab: 'smp' }),
    norm: S(T('Normalizza'), [['off', T('No')], ['on', T('Sì')]], 'off'),
    loop: S(T('Loop'), [['off', T('Nessuno')], ['fwd', T('In avanti')], ['ping', T('Ping-pong')]], 'off'),
    ls: P(T('Inizio loop'), 0, 1, 0, { unit: '%', tab: 'smp' }), le: P(T('Fine loop'), 0, 1, 1, { unit: '%', tab: 'smp' }),
    a: P(T('Attacco'), 0, 4, 0.002, { unit: 's', tab: 'env' }), h: P(T('Tenuta'), 0, 4, 0, { unit: 's', tab: 'env' }),
    d: P(T('Decadimento'), 0, 8, 0, { unit: 's', tab: 'env' }), s: P(T('Sustain'), 0, 1, 1, { tab: 'env' }),
    r: P(T('Rilascio'), 0.005, 8, 0.05, { unit: 's', tab: 'env' }),
    ftype: S(T('Filtro'), [['off', T('Spento')], ['lp', T('Passa-basso')], ['lp24', T('Passa-basso 24 dB')], ['hp', T('Passa-alto')], ['bp', T('Passa-banda')], ['notch', T('Elimina banda')]], 'off'),
    fcut: P(T('Cutoff'), 20, 20000, 20000, { unit: 'Hz', log: true, tab: 'env' }), fres: P(T('Risonanza'), 0, 18, 0.7, { step: 0.1, tab: 'env' }),
    fenv: P(T('Inviluppo filtro'), -1, 1, 0, { tab: 'env' }), fa: P(T('Attacco filtro'), 0.001, 4, 0.01, { unit: 's', log: true, tab: 'env' }),
    fd: P(T('Decadimento filtro'), 0.01, 8, 0.3, { unit: 's', log: true, tab: 'env' }), fs: P(T('Sustain filtro'), 0, 1, 0, { tab: 'env' }),
    penv: P(T('Inviluppo intonazione'), -24, 24, 0, { unit: 'st', step: 0.1, tab: 'env' }), pd: P(T('Durata intonazione'), 0.005, 2, 0.1, { unit: 's', log: true, tab: 'env' }),
    lshape: S(T('Forma LFO'), [['sine', T('Sinusoide')], ['triangle', T('Triangolo')], ['square', T('Quadra')], ['sawtooth', T('Dente di sega')]], 'sine'),
    lrate: P(T('Velocità LFO'), 0.05, 20, 4, { unit: 'Hz', log: true, tab: 'lfo' }), lvol: P(T('LFO → volume'), 0, 1, 0, { tab: 'lfo' }),
    lpan: P(T('LFO → pan'), 0, 1, 0, { tab: 'lfo' }), lcut: P(T('LFO → filtro'), 0, 1, 0, { tab: 'lfo' }),
    lpit: P(T('LFO → intonazione'), 0, 2, 0, { unit: 'st', step: 0.01, tab: 'lfo' }) } },
  supersaw: { label: T('Supersaw'), group: TM('Synth'), glyph: 'SS', melodic: true, params: {
    voices: P(T('Voci'), 1, 9, 7, { step: 1 }), det: P(T('Detune'), 0, 100, 25, { unit: 'ct' }), mix: P(T('Voci laterali'), 0, 1, 0.6),
    width: P(T('Ampiezza stereo'), 0, 1, 0.8), cut: P(T('Cutoff'), 100, 18000, 6000, { unit: 'Hz', log: true }), res: P(T('Risonanza'), 0, 18, 1, { step: 0.1 }),
    env: P(T('Inv. filtro'), 0, 1, 0.2), a: P(T('Attacco'), 0.001, 2, 0.01, { unit: 's', log: true }), d: P(T('Decadimento'), 0.01, 3, 0.4, { unit: 's', log: true }),
    s: P(T('Sustain'), 0, 1, 0.75), r: P(T('Rilascio'), 0.01, 4, 0.35, { unit: 's', log: true }), gain: P(T('Livello'), 0, 1, 0.5) } },
  acid: { label: T('Acid Bass (303)'), group: TM('Synth'), glyph: '303', melodic: true, mono: true, legato: true, params: {
    wave: S(T('Onda'), [['sawtooth', T('Dente di sega')], ['square', T('Quadra')]], 'sawtooth'), cut: P(T('Cutoff'), 60, 8000, 500, { unit: 'Hz', log: true }),
    res: P(T('Risonanza'), 0, 30, 18, { step: 0.1 }), env: P(T('Inv. filtro'), 0, 1, 0.6), decay: P(T('Decadimento'), 0.05, 2, 0.35, { unit: 's' }),
    accent: P(T('Accento'), 0, 1, 0.5), glide: P(T('Slide'), 0.005, 0.5, 0.08, { unit: 's', log: true }), gain: P(T('Livello'), 0, 1, 0.6) } },
  fm4: { label: T('FM a 4 operatori'), group: TM('Synth'), glyph: 'FM', melodic: true, params: {
    alg: S(T('Algoritmo'), [['stack', T('4→3→2→1 (catena)')], ['branch', '3+4→2→1'], ['pairs', T('4→3 e 2→1')], ['triple', '4→1,2,3'], ['add', T('Additivo')]], 'stack'),
    r1: P(T('Rapporto 1'), 0.25, 16, 1, { step: 0.25 }), r2: P(T('Rapporto 2'), 0.25, 16, 2, { step: 0.25 }),
    r3: P(T('Rapporto 3'), 0.25, 16, 3, { step: 0.25 }), r4: P(T('Rapporto 4'), 0.25, 16, 1, { step: 0.25 }),
    i2: P(T('Indice 2'), 0, 12, 2, { step: 0.1 }), i3: P(T('Indice 3'), 0, 12, 1, { step: 0.1 }), i4: P(T('Indice 4'), 0, 12, 0.5, { step: 0.1 }),
    mdec: P(T('Decad. modulatori'), 0.02, 4, 0.6, { unit: 's', log: true }), msus: P(T('Sustain modulatori'), 0, 1, 0.3),
    a: P(T('Attacco'), 0.001, 2, 0.003, { unit: 's', log: true }), d: P(T('Decadimento'), 0.01, 4, 0.8, { unit: 's', log: true }),
    s: P(T('Sustain'), 0, 1, 0.4), r: P(T('Rilascio'), 0.01, 4, 0.3, { unit: 's', log: true }), gain: P(T('Livello'), 0, 1, 0.5) } },
  organ: { label: T('Organo'), group: TM('Synth'), glyph: 'OR', melodic: true, params: {
    b1: P("16'", 0, 1, 1), b2: P("5⅓'", 0, 1, 1), b3: P("8'", 0, 1, 1), b4: P("4'", 0, 1, 0), b5: P("2⅔'", 0, 1, 0),
    b6: P("2'", 0, 1, 0), b7: P("1⅗'", 0, 1, 0), b8: P("1⅓'", 0, 1, 0), b9: P("1'", 0, 1, 0),
    perc: P(T('Percussione'), 0, 1, 0.3), vib: P(T('Vibrato'), 0, 1, 0.3), click: P(T('Click'), 0, 1, 0.3), gain: P(T('Livello'), 0, 1, 0.45) } },
  // Third-party plug-ins (VST3, AU, LV2, CLAP) hosted by the native engine of the desktop app.
  plugin: { label: T('Plugin'), group: TM('Plugin'), glyph: 'VST', melodic: true, hidden: true, params: {} },
};

const FXDEFS = {
  eq: { label: T('EQ a 3 bande'), params: {
    low: P(T('Bassi'), -18, 18, 0, { unit: 'dB' }), mid: P(T('Medi'), -18, 18, 0, { unit: 'dB' }),
    midf: P(T('Freq. medi'), 150, 6000, 1000, { unit: 'Hz', log: true }), high: P(T('Alti'), -18, 18, 0, { unit: 'dB' }) } },
  filter: { label: T('Filtro'), params: {
    type: S(T('Tipo'), [['lowpass', T('Passa-basso')], ['highpass', T('Passa-alto')], ['bandpass', T('Passa-banda')]], 'lowpass'),
    freq: P(T('Frequenza'), 20, 20000, 8000, { unit: 'Hz', log: true }), q: P(T('Risonanza'), 0.1, 18, 0.7, { step: 0.1 }) } },
  comp: { label: T('Compressore'), params: {
    thr: P(T('Soglia'), -60, 0, -18, { unit: 'dB' }), ratio: P(T('Rapporto'), 1, 20, 4, { unit: ':1' }),
    att: P(T('Attacco'), 0.001, 0.3, 0.01, { unit: 's', log: true }), rel: P(T('Rilascio'), 0.02, 1, 0.2, { unit: 's', log: true }),
    makeup: P(T('Guadagno'), 0, 24, 4, { unit: 'dB' }) } },
  limiter: { label: T('Limiter'), params: {
    gain: P(T('Guadagno'), 0, 18, 3, { unit: 'dB' }), ceil: P(T('Soglia'), -12, 0, -1, { unit: 'dB' }) } },
  dist: { label: T('Distorsione'), params: {
    drive: P(T('Drive'), 0, 1, 0.4), tone: P(T('Tono'), 500, 12000, 5000, { unit: 'Hz', log: true }),
    mix: P(T('Mix'), 0, 1, 1), out: P(T('Uscita'), 0, 1.5, 0.8) } },
  delay: { label: T('Delay'), params: {
    time: S(T('Tempo'), [['0.25', '1/16'], ['0.5', '1/8'], ['0.333', T('1/8 terzina')], ['0.75', T('1/8 puntato')], ['1', '1/4'], ['1.5', T('1/4 puntato')], ['2', '1/2']], '0.75'),
    pp: S(T('Stereo'), [['on', T('Ping-pong')], ['off', T('Normale')]], 'on'),
    fb: P(T('Feedback'), 0, 0.92, 0.38), tone: P(T('Tono'), 400, 12000, 4000, { unit: 'Hz', log: true }), mix: P(T('Mix'), 0, 1, 0.3) } },
  reverb: { label: T('Riverbero'), params: {
    size: P(T('Durata'), 0.3, 8, 2.2, { unit: 's' }), damp: P(T('Smorzamento'), 1000, 16000, 6000, { unit: 'Hz', log: true }),
    pre: P(T('Pre-delay'), 0, 0.15, 0.02, { unit: 's' }), mix: P(T('Mix'), 0, 1, 0.25) } },
  chorus: { label: T('Chorus'), params: {
    rate: P(T('Velocità'), 0.05, 5, 0.8, { unit: 'Hz', log: true }), depth: P(T('Profondità'), 0, 1, 0.5), mix: P(T('Mix'), 0, 1, 0.45) } },
  phaser: { label: T('Phaser'), params: {
    rate: P(T('Velocità'), 0.05, 8, 0.5, { unit: 'Hz', log: true }), depth: P(T('Profondità'), 0, 1, 0.6),
    freq: P(T('Frequenza'), 200, 4000, 800, { unit: 'Hz', log: true }), stages: S(T('Stadi'), [['4', '4'], ['6', '6'], ['8', '8'], ['12', '12']], '6'),
    fb: P(T('Feedback'), 0, 0.9, 0.4), mix: P(T('Mix'), 0, 1, 0.5) } },
  flanger: { label: T('Flanger'), params: {
    rate: P(T('Velocità'), 0.05, 5, 0.25, { unit: 'Hz', log: true }), depth: P(T('Profondità'), 0, 5, 2, { unit: 'ms' }),
    delay: P(T('Ritardo'), 0.5, 10, 2.5, { unit: 'ms' }), fb: P(T('Feedback'), -0.95, 0.95, 0.5), mix: P(T('Mix'), 0, 1, 0.5) } },
  bitcrush: { label: T('Bitcrusher'), params: {
    bits: P(T('Bit'), 1, 16, 8, { step: 1 }), down: P(T('Riduzione campioni'), 1, 32, 4, { step: 1 }), mix: P(T('Mix'), 0, 1, 1) } },
  width: { label: T('Stereo (ampiezza)'), params: { width: P(T('Ampiezza'), 0, 2, 1.4), gain: P(T('Uscita'), 0, 1.5, 1) } },
  gate: { label: T('Gate ritmico'), params: {
    pattern: S(T('Schema'), [['8', T('Ottavi')], ['16', T('Sedicesimi')], ['dot', T('Puntato')], ['tranceA', T('Trance A')], ['tranceB', T('Trance B')], ['stutter', T('Stutter')]], '16'),
    depth: P(T('Profondità'), 0, 1, 1), smooth: P(T('Morbidezza'), 0.001, 0.05, 0.004, { unit: 's', log: true }), mix: P(T('Mix'), 0, 1, 1) } },
  tremolo: { label: T('Tremolo / Auto-pan'), params: {
    mode: S(T('Modo'), [['trem', T('Tremolo')], ['pan', T('Auto-pan')]], 'trem'), shape: S(T('Forma'), [['sine', T('Sinusoide')], ['triangle', T('Triangolo')], ['square', T('Quadra')]], 'sine'),
    rate: P(T('Velocità'), 0.1, 20, 4, { unit: 'Hz', log: true }), depth: P(T('Profondità'), 0, 1, 0.6) } },
  ducker: { label: T('Sidechain (ducking)'), params: {
    src: P(T('Traccia sorgente'), 1, MAX_INSERTS, 1, { step: 1, track: true }), thr: P(T('Soglia'), -60, 0, -30, { unit: 'dB' }),
    range: P(T('Riduzione'), 0, 40, 18, { unit: 'dB' }), att: P(T('Attacco'), 0.001, 0.1, 0.005, { unit: 's', log: true }),
    rel: P(T('Rilascio'), 0.02, 1, 0.2, { unit: 's', log: true }) } },
  plugin: { label: T('Plugin'), hidden: true, params: {} },
};

/* ---------- Data model ---------- */
let proj = null;
const SAMPLES = {}; // id -> { name, data (base64 of the original file), buffer, rev }
const ui = {
  browser: true, wins: { rack: { open: true } },
  treeOpen: ['project', 'project/patterns', 'instruments', 'instruments/Batteria', 'instruments/Synth'],
  selCh: null, selPat: null, editCh: null, selMix: 1,
  mode: 'pattern', songPos: 0, lcdMode: 'time', typing: true,
  prSnap: 1, prZoom: 1, plSnap: 16, plZoom: 1, lastLen: 1, ghost: true,
  metro: false, rec: false, kbOct: 48,
};

function newChannel(type, o = {}) {
  return {
    id: uid(), type, name: o.name || INSTRUMENTS[type].label,
    color: o.color || COLORS[0], vol: o.vol ?? 0.78, pan: o.pan ?? 0,
    mute: false, solo: false, mixer: o.mixer ?? 0, root: o.root ?? 60,
    params: { ...defaults(INSTRUMENTS[type].params), ...(o.params || {}) },
    sample: o.sample || null,
    ...(o.plugin ? { plugin: o.plugin } : {}),
    mono: false, porta: 0, cutGroup: 0, cutBy: 0, arp: { ...ARP_DEFAULT }, echo: { ...ECHO_DEFAULT },
  };
}
// Channel settings shared by every instrument (the "misc" tab): voices, glide, choke groups, arpeggiator, note echo.
const ARP_DEFAULT = { on: false, dir: 'up', range: 1, time: 1, gate: 0.5, rep: 1 };
const ECHO_DEFAULT = { on: false, count: 3, time: 3, fb: 0.6, pitch: 0 };
function normalizeChannelMode(ch) {
  ch.mono = !!ch.mono;
  ch.porta = clamp(+ch.porta || 0, 0, 2);
  ch.cutGroup = clamp(ch.cutGroup | 0, 0, 16);
  ch.cutBy = clamp(ch.cutBy | 0, 0, 16);
  ch.arp = { ...ARP_DEFAULT, ...(ch.arp || {}) };
  ch.arp.range = clamp(ch.arp.range | 0 || 1, 1, 4);
  ch.arp.time = clamp(+ch.arp.time || 1, 0.25, 16);
  ch.arp.gate = clamp(+ch.arp.gate || 0.5, 0.05, 1);
  ch.arp.rep = clamp(ch.arp.rep | 0 || 1, 1, 8);
  ch.echo = { ...ECHO_DEFAULT, ...(ch.echo || {}) };
  ch.echo.count = clamp(ch.echo.count | 0, 1, 16);
  ch.echo.time = clamp(+ch.echo.time || 3, 0.25, 32);
  ch.echo.fb = clamp(+ch.echo.fb, 0, 1);
  ch.echo.pitch = clamp(+ch.echo.pitch || 0, -12, 12);
  return ch;
}

/* Notes a channel actually plays in a pattern: its arpeggiator and note echo applied to the written notes.
   Both audio engines play these, so the result is the same everywhere. Cached on the input data. */
const _expandCache = new WeakMap();
function expandNotes(p, ch) {
  const notes = p.notes[ch.id] || [];
  if (!(ch.arp && ch.arp.on) && !(ch.echo && ch.echo.on)) return notes;
  const key = JSON.stringify([ch.arp, ch.echo, p.len]) + JSON.stringify(notes);
  const c = _expandCache.get(notes);
  if (c && c.key === key) return c.out;
  // slide notes only bend the notes around them: they are neither arpeggiated nor echoed
  let out = notes.filter(n => !n.mu && !n.slide);
  const slides = notes.filter(n => !n.mu && n.slide);
  if (ch.arp.on && out.length) out = arpeggiate(out, ch.arp, patLen(p));
  if (ch.echo.on && out.length) {
    const L = patLen(p), e = ch.echo, add = [];
    for (const n of out) {
      for (let k = 1; k <= e.count; k++) {
        const s = n.s + k * e.time, v = n.v * Math.pow(e.fb, k);
        if (s >= L || v < 0.02) break;
        add.push({ ...n, s, m: clamp(n.m + k * e.pitch, 0, 127), v, porta: false });
      }
    }
    out = out.concat(add);
  }
  if (slides.length) out = out.concat(slides);
  _expandCache.set(notes, { key, out });
  return out;
}
// The chord held at each arpeggiator tick, played one note at a time: up, down, up-down, down-up or random, over 1-4 octaves.
function arpeggiate(notes, a, L) {
  const out = [];
  let count = 0, held = false;
  for (let t = 0; t < L - 1e-9; t += a.time) {
    const on = notes.filter(n => n.s <= t + 1e-9 && n.s + n.l > t + 1e-9);
    if (!on.length) { held = false; count = 0; continue; }
    if (!held) { held = true; count = 0; }
    const pitches = [...new Set(on.map(n => n.m))].sort((x, y) => x - y), list = [];
    for (let o = 0; o < a.range; o++) pitches.forEach(m => list.push(m + 12 * o));
    const N = list.length, step = Math.floor(count / a.rep);
    let i;
    switch (a.dir) {
      case 'down': i = N - 1 - (step % N); break;
      case 'updown': { const per = Math.max(1, 2 * N - 2); const k = step % per; i = k < N ? k : per - k; break; }
      case 'downup': { const per = Math.max(1, 2 * N - 2); const k = step % per; i = N - 1 - (k < N ? k : per - k); break; }
      case 'random': i = Math.floor(seededRandom(step * 7919 + N) * N); break;
      default: i = step % N;
    }
    i = clamp(i, 0, N - 1);
    const m = list[i], base = pitches[i % pitches.length], src = on.find(n => n.m === base) || on[0];
    out.push({ ...src, s: t, l: Math.max(0.05, a.time * a.gate), m: clamp(m, 0, 127), v: src.v, porta: false });
    count++;
  }
  return out;
}
function seededRandom(n) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }

function newPattern(name, color) { return { id: uid(), name, color, len: 16, notes: {} }; }
function newMixerTrack(i) {
  return {
    name: i === 0 ? T('Master') : T('Insert {0}', i), vol: i === 0 ? 0.9 : 0.8, pan: 0, mute: false, fx: Array(FX_SLOTS).fill(null),
    out: 0, sends: [], eq: { low: 0, mid: 0, midf: 1000, high: 0 }, width: 1, phase: false, swap: false,
  };
}
const numInserts = () => proj.mixer.length - 1;
const MARKER_ACTS = { '': TM('Nessuna azione'), start: TM('Inizio del brano'), loop: TM('Punto di ritorno del loop'), mloop: TM('Ripeti fino al prossimo marcatore'), skip: TM('Salta al prossimo marcatore'), pause: TM('Pausa'), ts: TM('Cambio di metro') };
function normalizeMarkers(list) {
  return (Array.isArray(list) ? list : []).filter(m => m && Number.isFinite(+m.s)).map(m => {
    const o = { id: m.id || uid(), s: Math.max(0, Math.round(+m.s)), name: String(m.name || ''), act: MARKER_ACTS[m.act] != null ? m.act : '' };
    if (o.act === 'ts') { o.num = clamp(m.num | 0 || 4, 1, 16); o.den = [2, 4, 8, 16].includes(m.den) ? m.den : 4; }
    return o;
  }).sort((a, b) => a.s - b.s);
}
function normalizePlaylist(pl, p) {
  pl = pl && typeof pl === 'object' ? pl : { tracks: [], clips: [] };
  pl.tracks = Array.isArray(pl.tracks) ? pl.tracks : [];
  while (pl.tracks.length < 16) pl.tracks.push({ name: T('Traccia {0}', pl.tracks.length + 1), mute: false });
  pl.tracks.forEach((t, i) => {
    t.name = String(t.name || T('Traccia {0}', i + 1));
    t.mute = !!t.mute;
    if (t.h != null) t.h = clamp(t.h | 0, 24, 160);
    t.sub = !!t.sub && i > 0;
    t.collapsed = !!t.collapsed;
  });
  pl.clips = (Array.isArray(pl.clips) ? pl.clips : []).filter(c => c &&
    ((c.a && p.automation.some(a => a.id === c.a)) || (c.smp && typeof c.smp === 'string') || p.patterns.some(pt => pt.id === c.p)));
  pl.clips.forEach(c => {
    c.id = c.id || uid();
    c.t = clamp(c.t | 0, 0, pl.tracks.length - 1);
    if (!c.smp) return;
    c.fin = clamp(+c.fin || 0, 0, 4096); c.fout = clamp(+c.fout || 0, 0, 4096);
    c.pitch = clamp(Math.round(+c.pitch || 0), -24, 24); c.rev = !!c.rev; c.stretch = clamp(+c.stretch || 0, 0, 8);
  });
  return pl;
}
// A track is silent when it is muted or when its group (the header above it) is muted.
function trackMuted(i) {
  const tracks = proj.playlist.tracks, t = tracks[i];
  if (!t) return true;
  if (t.mute) return true;
  if (t.sub) for (let k = i - 1; k >= 0; k--) if (!tracks[k].sub) return !!tracks[k].mute;
  return false;
}
// Signal edges between mixer tracks: main output, sends and sidechain taps (source → ducked track).
function mixerEdges(i) {
  const t = proj.mixer[i], out = [];
  if (i > 0) out.push(t.out | 0);
  t.sends.forEach(s => out.push(s.to));
  proj.mixer.forEach((o, j) => o.fx.forEach(f => { if (f && f.type === 'ducker' && Math.round(f.params.src) === i && j !== i) out.push(j); }));
  return out;
}
// Does the signal of track a reach track b? Used to refuse routes that would form a loop.
function reaches(a, b) {
  const seen = new Set([a]), todo = [a];
  while (todo.length) {
    const i = todo.pop();
    if (i === b) return true;
    for (const j of mixerEdges(i)) if (!seen.has(j) && proj.mixer[j]) { seen.add(j); todo.push(j); }
  }
  return false;
}
function fxSlot(type, params = {}) { return { type, on: true, params: { ...defaults(FXDEFS[type].params), ...params } }; }

function emptyProject(withKit = true) {
  const p = {
    app: 'ritmo-studio', version: 1, name: T('Senza titolo'), bpm: 128, swing: 0,
    channels: [], patterns: [newPattern(T('Pattern {0}', 1), COLORS[0])],
    playlist: { tracks: Array.from({ length: 16 }, (_, i) => ({ name: T('Traccia {0}', i + 1), mute: false })), clips: [] },
    mixer: Array.from({ length: NUM_INSERTS + 1 }, (_, i) => newMixerTrack(i)),
    automation: [], ts: { num: 4, den: 4 }, markers: [], arrId: uid(),
  };
  p.arrangements = [{ id: p.arrId, name: T('Arrangiamento'), playlist: null, markers: [], loop: null }];
  if (withKit) {
    [['kick', T('Cassa')], ['clap', T('Clap')], ['hat', T('Hi-hat')], ['snare', T('Rullante')]].forEach(([t, n], i) => {
      p.channels.push(newChannel(t, { name: n, mixer: i + 1, color: COLORS[i] }));
      p.mixer[i + 1].name = n;
    });
  }
  return p;
}

function demoProject() {
  const p = emptyProject(false);
  p.name = 'Mezzanotte (demo)';
  p.bpm = 124;
  p.swing = 0.12;
  const add = (type, name, mixer, color, o = {}) => {
    const ch = newChannel(type, { name, mixer, color, ...o });
    p.channels.push(ch);
    p.mixer[mixer].name = name;
    return ch;
  };
  const kick = add('kick', T('Cassa'), 1, COLORS[0], { vol: 0.86 });
  const clap = add('clap', T('Clap'), 2, COLORS[2], { vol: 0.62 });
  const hat = add('hat', T('Hi-hat'), 3, COLORS[6], { vol: 0.42 });
  const ohat = add('ohat', T('Hi-hat aperto'), 3, COLORS[7], { vol: 0.34 });
  const bass = add('bass808', T('Basso 808'), 4, COLORS[4], { vol: 0.72, params: { decay: 0.9, glide: 0.25, drive: 0.35 } });
  const pad = add('pad', T('Pad notturno'), 5, COLORS[3], { vol: 0.56 });
  const pluck = add('pluck', T('Pluck'), 6, COLORS[1], { vol: 0.5, params: { bright: 0.55, decay: 1.2 } });
  p.mixer[3].name = T('Hi-hat');

  const steps = (idx, m, v) => idx.map(i => ({ s: i, l: 1, m, v: typeof v === 'function' ? v(i) : v }));
  const drums = newPattern(T('Batteria'), COLORS[0]);
  drums.notes[kick.id] = steps([0, 4, 8, 12], 60, 0.9);
  drums.notes[clap.id] = steps([4, 12], 60, 0.8);
  drums.notes[hat.id] = steps([0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], 60, i => (i % 2 ? 0.45 : 0.72));
  drums.notes[ohat.id] = steps([2, 6, 10, 14], 60, 0.62);

  // A minor: Am7 – Fmaj7 – Cmaj7 – G6, one bar each
  const roots = [33, 29, 36, 31];
  const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 60, 64], [55, 59, 62, 64]];
  const bassPat = newPattern(T('Basso'), COLORS[4]); bassPat.len = 64;
  const padPat = newPattern(T('Accordi'), COLORS[3]); padPat.len = 64;
  const melPat = newPattern(T('Melodia'), COLORS[1]); melPat.len = 64;
  bassPat.notes[bass.id] = []; padPat.notes[pad.id] = []; melPat.notes[pluck.id] = [];
  roots.forEach((r, b) => {
    const o = b * SPB;
    [[0, r, 0.9], [6, r, 0.75], [10, r + 12, 0.7], [14, r, 0.8]].forEach(([s, m, v]) => bassPat.notes[bass.id].push({ s: o + s, l: 2, m, v }));
    chords[b].forEach(m => padPat.notes[pad.id].push({ s: o, l: 16, m, v: 0.7 }));
    const t = chords[b].map(m => m + 12);
    [t[0], t[2], t[1], t[3], t[2], t[1], t[3], t[2]].forEach((m, k) => melPat.notes[pluck.id].push({ s: o + k * 2, l: 2, m, v: k % 2 ? 0.55 : 0.78 }));
  });
  p.patterns = [drums, bassPat, padPat, melPat];

  [T('Batteria'), T('Basso'), T('Accordi'), T('Melodia')].forEach((n, i) => { p.playlist.tracks[i].name = n; });
  const clip = (pat, t, s, l) => p.playlist.clips.push({ id: uid(), p: pat.id, t, s, l });
  clip(drums, 0, 64, 192);
  [64, 128, 192].forEach(s => clip(bassPat, 1, s, 64));
  [0, 64, 128, 192].forEach(s => clip(padPat, 2, s, 64));
  [128, 192].forEach(s => clip(melPat, 3, s, 64));

  p.mixer[2].fx[0] = fxSlot('reverb', { size: 1.2, damp: 7000, pre: 0.01, mix: 0.18 });
  p.mixer[5].fx[0] = fxSlot('chorus', { rate: 0.6, depth: 0.5, mix: 0.4 });
  p.mixer[5].fx[1] = fxSlot('reverb', { size: 3.5, mix: 0.35 });
  p.mixer[6].fx[0] = fxSlot('delay', { time: '0.75', fb: 0.4, tone: 3500, mix: 0.28, pp: 'on' });
  p.mixer[6].fx[1] = fxSlot('reverb', { size: 2, mix: 0.2 });
  p.mixer[0].fx[0] = fxSlot('comp', { thr: -14, ratio: 2.5, att: 0.02, rel: 0.25, makeup: 2 });
  p.mixer[0].fx[1] = fxSlot('limiter', { gain: 2, ceil: -1 });
  return p;
}

function normalizeProject(p) {
  if (!p || !Array.isArray(p.channels) || !Array.isArray(p.patterns)) throw new Error(T('il file non contiene un progetto Ritmo Studio'));
  p.bpm = clamp(+p.bpm || 128, 40, 300);
  p.swing = clamp(+p.swing || 0, 0, 1);
  p.name = String(p.name || T('Senza titolo'));
  p.channels.forEach(ch => {
    if (!INSTRUMENTS[ch.type]) ch.type = 'synth';
    ch.id = ch.id || uid();
    ch.name = String(ch.name || INSTRUMENTS[ch.type].label);
    ch.params = { ...defaults(INSTRUMENTS[ch.type].params), ...(ch.params || {}) };
    ch.vol = clamp(ch.vol ?? 0.78, 0, 1);
    ch.pan = clamp(ch.pan ?? 0, -1, 1);
    ch.mixer = clamp(ch.mixer | 0, 0, NUM_INSERTS);
    ch.root = clamp(ch.root ?? 60, 0, 127);
    ch.color = ch.color || COLORS[0];
    ch.mute = !!ch.mute; ch.solo = !!ch.solo;
    normalizeChannelMode(ch);
  });
  if (!p.patterns.length) p.patterns.push(newPattern(T('Pattern {0}', 1), COLORS[0]));
  p.patterns.forEach(pt => {
    pt.id = pt.id || uid();
    pt.len = clamp((pt.len | 0) || 16, 1, 512);
    pt.notes = pt.notes || {};
    pt.color = pt.color || COLORS[0];
  });
  if (!p.scale || typeof p.scale !== 'object') p.scale = { root: 0, type: 'none' };
  if (p.loop && !(p.loop.e > p.loop.s)) delete p.loop;
  const ts = p.ts || {};
  p.ts = { num: clamp(ts.num | 0 || 4, 1, 16), den: [2, 4, 8, 16].includes(ts.den) ? ts.den : 4 };
  p.markers = normalizeMarkers(p.markers);
  p.automation = (Array.isArray(p.automation) ? p.automation : []).filter(a => a && a.target && Array.isArray(a.points));
  p.automation.forEach(a => {
    a.id = a.id || uid();
    a.len = clamp(+a.len || 64, 1, 4096);
    a.points = a.points.map(q => ({ s: clamp(+q.s || 0, 0, a.len), v: clamp(+q.v || 0, 0, 1) })).sort((x, y) => x.s - y.s);
    if (!a.points.length) a.points = [{ s: 0, v: 0.5 }];
  });
  p.playlist = normalizePlaylist(p.playlist, p);
  // Arrangements: alternative playlists of the same patterns. The current one lives in p.playlist / p.markers / p.loop;
  // its entry in the list only keeps its name and place.
  p.arrangements = (Array.isArray(p.arrangements) ? p.arrangements : []).filter(a => a && a.id).map(a => ({
    id: a.id, name: String(a.name || T('Arrangiamento')).slice(0, 40), playlist: a.playlist || null, markers: normalizeMarkers(a.markers), loop: a.loop && a.loop.e > a.loop.s ? a.loop : null,
  }));
  if (!p.arrangements.some(a => a.id === p.arrId)) { p.arrId = uid(); p.arrangements.unshift({ id: p.arrId, name: T('Arrangiamento'), playlist: null, markers: [], loop: null }); }
  p.arrangements.forEach(a => {
    if (a.id === p.arrId) { a.playlist = null; a.markers = []; a.loop = null; } else a.playlist = normalizePlaylist(a.playlist, p);
  });
  const mx = p.mixer || [];
  const count = NUM_INSERTS + 1;
  p.mixer = Array.from({ length: count }, (_, i) => {
    const base = newMixerTrack(i), t = { ...base, ...(mx[i] || {}) };
    t.eq = { ...base.eq, ...(t.eq || {}) };
    t.out = i === 0 ? 0 : clamp(t.out | 0, 0, count - 1);
    if (t.out === i) t.out = 0;
    t.sends = (Array.isArray(t.sends) ? t.sends : []).filter(x => x && x.to > 0 && x.to < count && x.to !== i).map(x => ({ to: x.to | 0, lv: clamp(+x.lv || 0, 0, 1.25) }));
    t.width = clamp(t.width ?? 1, 0, 2);
    t.phase = !!t.phase;
    t.swap = !!t.swap;
    const fx = t.fx || [];
    t.fx = Array.from({ length: FX_SLOTS }, (_, k) => {
      const f = fx[k];
      if (!f || !FXDEFS[f.type]) return null;
      const slot = { type: f.type, on: f.on !== false, params: { ...defaults(FXDEFS[f.type].params), ...(f.params || {}) } };
      if (f.mix != null && f.mix < 1) slot.mix = clamp(+f.mix || 0, 0, 1);
      if (f.type === 'plugin') { slot.plugin = f.plugin || {}; if (f.state) slot.state = f.state; }
      return slot;
    });
    return t;
  });
  return p;
}

/* ---------- Queries ---------- */
const chById = id => proj.channels.find(c => c.id === id);
const patById = id => proj.patterns.find(p => p.id === id);
const curPat = () => patById(ui.selPat) || proj.patterns[0];
const anySolo = () => proj.channels.some(c => c.solo);
const audible = ch => !ch.mute && (!anySolo() || ch.solo);
const mixerName = i => (i === 0 ? T('Master') : i + ' · ' + proj.mixer[i].name);

function patLen(p) {
  let end = p.len;
  for (const k in p.notes) for (const n of p.notes[k]) if (n.s + n.l > end) end = n.s + n.l;
  const bar = spb();
  return Math.max(bar, Math.ceil(end / bar - 1e-9) * bar);
}
function songLen() {
  let end = 0;
  for (const c of proj.playlist.clips) end = Math.max(end, c.s + c.l);
  return Math.ceil(end / spb() - 1e-9) * spb();
}

/* ---------- Metre: time signature of the project, and changes placed as playlist markers ---------- */
const tsBar = ts => ts.num * 16 / ts.den;   // steps per bar
const tsBeat = ts => 16 / ts.den;           // steps per beat
const spb = () => tsBar(proj && proj.ts ? proj.ts : { num: 4, den: 4 });
const beatSteps = () => tsBeat(proj && proj.ts ? proj.ts : { num: 4, den: 4 });
// Song metre segments: [{ s, ts, bar0 }] where bar0 is the number (0-based) of the first bar of the segment.
function meterSegments(song = true) {
  const segs = [{ s: 0, ts: proj.ts, bar0: 0 }];
  if (!song) return segs;
  for (const m of proj.markers) {
    if (m.act !== 'ts' || m.s <= 0) continue;
    const prev = segs[segs.length - 1], bars = Math.ceil((m.s - prev.s) / tsBar(prev.ts) - 1e-9);
    segs.push({ s: m.s, ts: { num: m.num, den: m.den }, bar0: prev.bar0 + bars });
  }
  return segs;
}
// Bar, beat and step (all 1-based) at a position, as shown by the time display and the rulers.
function barAt(step, song = true) {
  const segs = meterSegments(song);
  let seg = segs[0];
  for (const g of segs) if (g.s <= step + 1e-9) seg = g;
  const bl = tsBar(seg.ts), bt = tsBeat(seg.ts), rel = Math.max(0, step - seg.s), bar = Math.floor(rel / bl + 1e-9);
  const inBar = rel - bar * bl;
  return { bar: seg.bar0 + bar + 1, beat: Math.floor(inBar / bt + 1e-9) + 1, step: Math.floor(inBar % bt + 1e-9) + 1, barStart: seg.s + bar * bl, barLen: bl, beatLen: bt, ts: seg.ts };
}
// Calls fn(start, number, barLen, beatLen) for every bar that starts in [from, to).
function eachBar(from, to, song, fn) {
  const segs = meterSegments(song);
  segs.forEach((g, i) => {
    const end = i + 1 < segs.length ? segs[i + 1].s : Infinity, bl = tsBar(g.ts);
    let k = Math.max(0, Math.floor((from - g.s) / bl));
    for (let x = g.s + k * bl; x < Math.min(end, to); x = g.s + ++k * bl) if (x >= from - bl) fn(x, g.bar0 + k + 1, bl, tsBeat(g.ts));
  });
}

// Playback map shared by both audio engines: song end, where the song loops back to, marker jumps and pauses,
// the metre of every stretch (for the metronome) and the length of every pattern.
function seqInfo() {
  const ms = proj.markers || [], end = Math.max(spb(), songLen());
  const seq = { end, wrap: 0, jumps: [], pauses: [], meter: meterSegments(true).map(g => ({ s: g.s, bar: tsBar(g.ts), beat: tsBeat(g.ts) })), plen: {} };
  proj.patterns.forEach(p => { seq.plen[p.id] = patLen(p); });
  ms.forEach((m, i) => {
    const next = ms.slice(i + 1).find(o => o.s > m.s && o.act !== 'ts');
    if (m.act === 'loop' && m.s < end) seq.wrap = m.s;
    else if (m.act === 'skip' && next) seq.jumps.push({ at: m.s, to: next.s });
    else if (m.act === 'mloop') { if (next && next.s < end) seq.jumps.push({ at: next.s, to: m.s, loop: true }); else if (m.s < end) seq.wrap = m.s; }
    else if (m.act === 'pause' && m.s > 0) seq.pauses.push(m.s);
  });
  return seq;
}
// Where playback from the top of the song begins: the "song start" marker, if there is one.
const songStart = () => { const m = (proj.markers || []).find(k => k.act === 'start'); return m ? m.s : 0; };

/* ---------- Per-note properties (stored only when they differ from the default) ---------- */
const NOTE_PROPS = {
  v: { label: T('Velocità'), min: 0, max: 1, def: 0.8 },
  rel: { label: T('Rilascio'), min: 0, max: 1, def: 0.5 },
  pan: { label: T('Pan'), min: -1, max: 1, def: 0 },
  fine: { label: T('Intonazione fine'), min: -1, max: 1, def: 0 },
  mx: { label: T('Mod X (filtro)'), min: 0, max: 1, def: 0.5 },
  my: { label: T('Mod Y (risonanza)'), min: 0, max: 1, def: 0.5 },
};
const np = (n, k) => (n[k] ?? NOTE_PROPS[k].def);
const NOTE_COLORS = ['#7ec7f0', '#f0a35e', '#9ddc6c', '#e07ab3', '#c3a4f5', '#f0d36a', '#6be0c8', '#f07e7e', '#a8b4c0', '#d6a77a', '#8fa3f0', '#e0e07a', '#7ae09a', '#f0b0d0', '#b0d0f0', '#d0b0f0'];

/* ---------- Undo history ---------- */
const Hist = {
  undoStack: [], redoStack: [], last: '',
  init() { this.undoStack = []; this.redoStack = []; this.last = JSON.stringify(proj); },
  commit() {
    const s = JSON.stringify(proj);
    if (s === this.last) return;
    this.undoStack.push(this.last);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.last = s;
    autosave();
  },
  undo() {
    if (!this.undoStack.length) { toast(T('Niente da annullare')); return; }
    this.redoStack.push(this.last);
    this.last = this.undoStack.pop();
    proj = JSON.parse(this.last);
    onProjectReplaced();
    autosave();
    hint(T('Annullato'));
  },
  redo() {
    if (!this.redoStack.length) { toast(T('Niente da ripetere')); return; }
    this.undoStack.push(this.last);
    this.last = this.redoStack.pop();
    proj = JSON.parse(this.last);
    onProjectReplaced();
    autosave();
    hint(T('Ripetuto'));
  },
};
const commit = () => Hist.commit();

// A mixer track still has its default name ("Insert 3"), in Italian or in the interface language.
function isDefaultInsertName(n) {
  const local = T('Insert {0}').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{0\\}', '\\d+');
  return /^Insert \d+$/.test(n) || new RegExp('^' + local + '$').test(n);
}

/* ---------- Browser storage (per-viewer convenience) ---------- */
const STORE_KEY = 'ritmo-studio/project-v1';
const PREFS_KEY = 'ritmo-studio/ui-v1';
function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
let saveTimer = 0;
// Before a project is replaced (new, demo, open, restore) the current one joins the last 8 backups,
// so nothing is lost by a click on "New project". Very large projects (embedded audio) rely on saved files.
const BACKUP_KEY = 'ritmo-studio/backups-v1';
function readBackups() { try { return JSON.parse(storeGet(BACKUP_KEY) || '[]') || []; } catch (e) { return []; } }
function backupCurrentProject() {
  if (!proj) return;
  const used = proj.channels.length > 4 || proj.playlist.clips.length || proj.patterns.some(p => Object.values(p.notes).some(n => n.length));
  if (!used) return;
  const data = JSON.stringify({ proj, samples: serializeSamples() });
  if (data.length > 3e6) return;
  let list = readBackups();
  if (list[0] && list[0].data === data) return;
  list.unshift({ at: Date.now(), name: proj.name, channels: proj.channels.length, data });
  list = list.slice(0, 8);
  while (list.length > 1 && JSON.stringify(list).length > 6e6) list.pop();
  try { storeSet(BACKUP_KEY, JSON.stringify(list)); } catch (e) { /* storage full: the backup is skipped */ }
}
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    let s = JSON.stringify({ proj, samples: serializeSamples() });
    if (s.length > 4e6) s = JSON.stringify({ proj, samples: {} });
    storeSet(STORE_KEY, s);
  }, 700);
}
function loadAutosave() {
  const s = storeGet(STORE_KEY);
  if (!s) return null;
  try { const d = JSON.parse(s); return { proj: normalizeProject(d.proj), samples: d.samples || {} }; } catch (e) { return null; }
}
let prefsTimer = 0;
function savePrefs() {
  clearTimeout(prefsTimer);
  prefsTimer = setTimeout(() => {
    const { browser, wins, treeOpen, lcdMode, typing, prSnap, prZoom, plSnap, plZoom, ghost, metro, noWelcome, prAllNames, mxWide, recMode, exportOpts, starred, previewVol, previewAuto, prLane, snapLive } = ui;
    storeSet(PREFS_KEY, JSON.stringify({ browser, wins, treeOpen, lcdMode, typing, prSnap, prZoom, plSnap, plZoom, ghost, metro, noWelcome, prAllNames, mxWide, recMode, exportOpts, starred, previewVol, previewAuto, prLane, snapLive }));
  }, 300);
}
function loadPrefs() {
  let p = {};
  try { p = JSON.parse(storeGet(PREFS_KEY) || '{}') || {}; } catch (e) { /* defaults stay */ }
  for (const k of ['browser', 'lcdMode', 'typing', 'prSnap', 'prZoom', 'plSnap', 'plZoom', 'ghost', 'metro', 'noWelcome', 'prAllNames', 'mxWide', 'recMode', 'exportOpts', 'starred', 'previewVol', 'previewAuto', 'prLane', 'snapLive']) if (p[k] != null) ui[k] = p[k];
  if (p.wins && typeof p.wins === 'object') ui.wins = p.wins;
  if (Array.isArray(p.treeOpen)) ui.treeOpen = p.treeOpen;
}

/* ---------- Samples ---------- */
function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b) {
  const s = atob(b), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function serializeSamples() {
  const out = {};
  const ids = [...proj.channels.map(ch => ch.sample), ...proj.playlist.clips.map(c => c.smp),
    ...(proj.arrangements || []).flatMap(a => (a.playlist ? a.playlist.clips.map(c => c.smp) : []))];
  for (const id of ids) {
    const s = id && SAMPLES[id];
    if (s) out[id] = { name: s.name, data: s.data };
  }
  return out;
}
async function restoreSamples(obj) {
  for (const [id, s] of Object.entries(obj || {})) {
    if (SAMPLES[id] || !s || !s.data) continue;
    try { SAMPLES[id] = { name: s.name, data: s.data, buffer: await decodeBytes(b64ToBytes(s.data)) }; }
    catch (e) { console.warn('Campione non decodificabile', s.name, e); }
  }
}
async function addSampleFromFile(file) {
  const u8 = new Uint8Array(await file.arrayBuffer());
  const data = bytesToB64(u8);
  const buffer = await decodeBytes(u8);
  const id = uid();
  SAMPLES[id] = { name: file.name, data, buffer };
  return id;
}
