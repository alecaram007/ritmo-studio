'use strict';
/* Ritmo Studio — audio: synthesized instruments, mixer effects, engine, sequencer, offline render, file encoders */

let actx = null;    // live AudioContext, created on the first user gesture
let engine = null;  // live Engine bound to actx
const flashQueue = []; // channel triggers waiting to light their activity LED

function audioReady() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC({ latencyHint: 'interactive' });
    engine = new Engine(actx, true);
    loadWorklets(actx).then(ok => { if (ok && engine && engine.c === actx) engine.strips.forEach(s => s.data.fx.some(f => f && f.type === 'bitcrush') && s.buildFx()); });
    actx.addEventListener('statechange', () => updateStatusRight());
    setTimeout(updateStatusRight);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function rebuildEngine() {
  if (!actx) return;
  engine.dispose();
  engine = new Engine(actx, true);
}

let _decoder = null;
async function decodeBytes(u8) {
  // the desktop app's native bridge replaces actx with a clock-only stand-in: decode with an offline context there
  const ctx = actx && actx.decodeAudioData ? actx : (_decoder = _decoder || new OfflineAudioContext(2, 1, 44100));
  const copy = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  return await new Promise((res, rej) => {
    const p = ctx.decodeAudioData(copy, res, rej);
    if (p && p.then) p.then(res, rej);
  });
}

/* ---------- AudioWorklet processors (sample-accurate effects that native nodes cannot express) ---------- */
const WORKLET_SRC = `
class RitmoCrush extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'bits', defaultValue: 8 }, { name: 'down', defaultValue: 4 }, { name: 'mix', defaultValue: 1 }]; }
  constructor() { super(); this.hold = [0, 0]; this.left = 0; }
  process(inputs, outputs, P) {
    const inp = inputs[0], out = outputs[0], n = out[0].length;
    const q = Math.pow(2, P.bits[0] - 1), down = Math.max(1, Math.round(P.down[0])), mix = P.mix[0];
    for (let i = 0; i < n; i++) {
      if (this.left <= 0) {
        for (let c = 0; c < out.length; c++) { const ch = inp[c] || inp[0]; this.hold[c] = ch ? Math.round(ch[i] * q) / q : 0; }
        this.left = down;
      }
      this.left--;
      for (let c = 0; c < out.length; c++) { const ch = inp[c] || inp[0], x = ch ? ch[i] : 0; out[c][i] = x * (1 - mix) + this.hold[c] * mix; }
    }
    return true;
  }
}
registerProcessor('ritmo-crush', RitmoCrush);
`;
const _worklets = new WeakMap();
function loadWorklets(c) {
  if (!c.audioWorklet) return Promise.resolve(false);
  let pr = _worklets.get(c);
  if (!pr) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    pr = c.audioWorklet.addModule(url).then(() => { c._ritmoWk = true; return true; }, e => { console.warn('worklet', e); return false; });
    _worklets.set(c, pr);
  }
  return pr;
}

/* While AT is set, parameter changes land at AT.t on the timeline (automation clips, offline render) instead of now. */
let AT = null;
function sp(param, v) {
  if (AT) param.setTargetAtTime(v, AT.t, 0.004);
  else param.value = v;
}

// 2x2 stereo matrix: width (mid/side), phase invert and left/right swap of a mixer track.
function stereoMatrix(c) {
  const input = c.createGain(), split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
  input.channelCount = 2; input.channelCountMode = 'explicit';
  input.connect(split);
  const g = [0, 1, 2, 3].map(() => c.createGain()); // LL, RL, LR, RR (source → destination)
  split.connect(g[0], 0); g[0].connect(merge, 0, 0);
  split.connect(g[1], 1); g[1].connect(merge, 0, 0);
  split.connect(g[2], 0); g[2].connect(merge, 0, 1);
  split.connect(g[3], 1); g[3].connect(merge, 0, 1);
  return {
    input, output: merge,
    set(d) {
      const w = d.width, a = (1 + w) / 2, b = (1 - w) / 2, ph = d.phase ? -1 : 1;
      let m = [a, b, b, a];
      if (d.swap) m = [m[2], m[3], m[0], m[1]];
      g.forEach((x, i) => { x.gain.value = m[i] * ph; });
    },
  };
}

/* ---------- Building blocks ---------- */
const _noise = new WeakMap();
function noiseBuf(c) {
  let b = _noise.get(c);
  if (!b) {
    const len = c.sampleRate * 2;
    b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    _noise.set(c, b);
  }
  return b;
}
function noiseSrc(c, t, dur) {
  const s = c.createBufferSource();
  s.buffer = noiseBuf(c);
  s.loop = true;
  s.start(t, Math.random() * 1.5);
  s.stop(t + dur);
  return s;
}
function biquad(c, type, freq, q) {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q != null) f.Q.value = q;
  return f;
}
const _curves = {};
function satCurve(k) {
  const key = k.toFixed(2);
  if (_curves[key]) return _curves[key];
  const n = 1024, c = new Float32Array(n), d = 1 + k * 12;
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * d) / Math.tanh(d); }
  return (_curves[key] = c);
}

// Percussive exponential envelope. Returns levelAt(t) so a voice can later be cut without a click.
function percEnv(param, t, peak, dec, atk = 0.002) {
  const lo = 0.0001;
  peak = Math.max(peak, 0.0003);
  param.setValueAtTime(lo, t);
  param.exponentialRampToValueAtTime(peak, t + atk);
  param.exponentialRampToValueAtTime(lo, t + atk + dec);
  return t2 => {
    if (t2 <= t) return lo;
    if (t2 < t + atk) return lo * Math.pow(peak / lo, (t2 - t) / atk);
    if (t2 >= t + atk + dec) return lo;
    return peak * Math.pow(lo / peak, (t2 - t - atk) / dec);
  };
}
function cutEnv(param, levelAt, t2, rel = 0.012) {
  const v = Math.max(levelAt(t2), 0.0001);
  param.cancelScheduledValues(t2);
  param.exponentialRampToValueAtTime(v, t2);
  param.exponentialRampToValueAtTime(0.0001, t2 + rel);
}

// Portamento: a frequency-like parameter starts from the previous note and glides to its target (time constant = time / 3).
function glideTo(param, target, t, glide, ratioOfFrom) {
  if (!glide) { param.setValueAtTime(target, t); return; }
  param.setValueAtTime(target * ratioOfFrom, t);
  param.setTargetAtTime(target, t, Math.max(0.001, glide.time / 3));
}
const glideRatio = (glide, m) => (glide ? Math.pow(2, (glide.from - m) / 12) : 1);

// A note's mod X / mod Y / release move the channel's cutoff, resonance and release for that note only.
function noteParams(ch, x) {
  const mx = x.mx ?? 0.5, my = x.my ?? 0.5, rel = x.rel ?? 0.5, p = ch.params;
  if (mx === 0.5 && my === 0.5 && rel === 0.5) return p;
  const spec = INSTRUMENTS[ch.type].params, o = { ...p };
  const scale = (k, f) => { const s = spec[k]; if (s && !s.select && typeof p[k] === 'number') o[k] = clamp(p[k] * f, s.min, s.max); };
  if (mx !== 0.5) { const f = Math.pow(2, (mx - 0.5) * 4); scale('cut', f); scale('fcut', f); }
  if (my !== 0.5) { const f = Math.pow(2, (my - 0.5) * 2); scale('res', f); scale('fres', f); }
  if (rel !== 0.5) scale('r', Math.pow(2, (rel - 0.5) * 2));
  return o;
}

// Two-to-four oscillator voice with a lowpass filter and ADSR, used by Synth and Pad.
function analogVoice(c, out, cfg, m, v, t) {
  const f = mtof(m);
  const flt = biquad(c, 'lowpass', cfg.cut, cfg.res);
  const vca = c.createGain();
  vca.gain.value = 0;
  const oscs = cfg.waves.map(w => {
    const o = c.createOscillator();
    o.type = w.type;
    glideTo(o.frequency, f * Math.pow(2, w.oct || 0), t, cfg.glide, glideRatio(cfg.glide, m));
    o.detune.value = w.det || 0;
    const g = c.createGain();
    g.gain.value = w.gain;
    o.connect(g);
    if (w.pan) { const pn = c.createStereoPanner(); pn.pan.value = w.pan; g.connect(pn); pn.connect(flt); } else g.connect(flt);
    o.start(t);
    return o;
  });
  flt.connect(vca); vca.connect(out);
  const peak = Math.max(0.0005, v * cfg.gain), { a, d, s, r } = cfg, tau = Math.max(0.005, d / 3);
  const G = vca.gain;
  G.setValueAtTime(0, t);
  G.linearRampToValueAtTime(peak, t + a);
  G.setTargetAtTime(peak * s, t + a, tau);
  const F = flt.frequency, top = Math.min(18000, cfg.cut * (1 + cfg.env * 10));
  if (cfg.env > 0.001) {
    F.setValueAtTime(cfg.cut, t);
    F.linearRampToValueAtTime(top, t + Math.max(0.003, a * 0.7));
    F.setTargetAtTime(cfg.cut + (top - cfg.cut) * s * 0.3, t + a, tau);
  }
  let done = false;
  return {
    stop(t2) {
      if (done) return;
      done = true;
      t2 = Math.max(t2, t + 0.003);
      const lvl = t2 < t + a ? peak * (t2 - t) / a : peak * s + (peak - peak * s) * Math.exp(-(t2 - t - a) / tau);
      G.cancelScheduledValues(t2);
      if (t2 < t + a) G.linearRampToValueAtTime(lvl, t2); else G.setValueAtTime(lvl, t2);
      G.setTargetAtTime(0, t2, Math.max(0.004, r / 4));
      const end = t2 + r * 1.6 + 0.05;
      oscs.forEach(o => o.stop(end));
    },
  };
}

/* ---------- KS plucked string, rendered to buffers and cached ---------- */
const _ks = new Map();
function ksBuffer(sr, m, bright, decay) {
  const key = sr + '|' + m + '|' + bright.toFixed(2) + '|' + decay.toFixed(2);
  if (_ks.has(key)) return _ks.get(key);
  if (_ks.size > 400) _ks.clear();
  const f = mtof(m), N = Math.max(2, Math.round(sr / f));
  const len = Math.floor(sr * Math.min(decay * 1.15 + 0.05, 8));
  const buf = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: sr });
  const d = buf.getChannelData(0), ring = new Float32Array(N);
  let lp = 0, peak = 0;
  const a = 0.12 + bright * 0.88;
  for (let i = 0; i < N; i++) { lp += a * ((Math.random() * 2 - 1) - lp); ring[i] = lp; peak = Math.max(peak, Math.abs(lp)); }
  const norm = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < N; i++) ring[i] *= norm;
  const rho = Math.pow(0.001, 1 / Math.max(1, decay * f));
  const w = 0.5 - bright * 0.42;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx], nxt = ring[(idx + 1) % N];
    d[i] = cur;
    ring[idx] = rho * ((1 - w) * cur + w * nxt);
    idx = (idx + 1) % N;
  }
  const fade = Math.min(len, Math.floor(sr * 0.03));
  for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  _ks.set(key, buf);
  return buf;
}

// Ping-pong loops: the region played forwards then backwards, as one buffer that loops forwards.
function pingPongBuffer(smp, rev, ls, le) {
  const key = (rev ? 'r' : 'f') + ls.toFixed(4) + '-' + le.toFixed(4);
  smp.pp = smp.pp || {};
  if (smp.pp[key]) return smp.pp[key];
  const b = rev ? reversedBuffer(smp) : smp.buffer, sr = b.sampleRate;
  const i0 = Math.floor(ls * sr), i1 = Math.min(b.length, Math.floor(le * sr)), n = i1 - i0;
  const out = new AudioBuffer({ length: i1 + n, numberOfChannels: b.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c), dst = out.getChannelData(c);
    dst.set(src.subarray(0, i1));
    for (let k = 0; k < n; k++) dst[i1 + k] = src[i1 - 1 - k];
  }
  if (Object.keys(smp.pp).length > 8) smp.pp = {};
  return (smp.pp[key] = out);
}
function samplePeak(smp) {
  if (smp.peak != null && smp.peakBuf === smp.buffer) return smp.peak;
  let pk = 0;
  for (let c = 0; c < smp.buffer.numberOfChannels; c++) { const d = smp.buffer.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); if (x > pk) pk = x; } }
  smp.peakBuf = smp.buffer;
  return (smp.peak = pk);
}
function reversedBuffer(smp) {
  if (smp.rev) return smp.rev;
  const b = smp.buffer;
  const r = new AudioBuffer({ length: b.length, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
  for (let c = 0; c < b.numberOfChannels; c++) { const src = b.getChannelData(c), dst = r.getChannelData(c); for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i]; }
  return (smp.rev = r);
}

function hatVoice(c, out, p, m, v, t, ch, dec, base) {
  const k = Math.pow(2, (m - ch.root) / 12);
  const sum = c.createGain();
  sum.gain.value = 0.2;
  const end = t + dec + 0.08;
  for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) {
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f * k * 1.4;
    o.connect(sum);
    o.start(t); o.stop(end);
  }
  const n = noiseSrc(c, t, end - t), ng = c.createGain();
  ng.gain.value = 0.35 + (1 - p.tone) * 0.3;
  n.connect(ng); ng.connect(sum);
  const bp = biquad(c, 'bandpass', base + p.tone * 3500, 0.7), hp = biquad(c, 'highpass', base - 2500 + p.tone * 1500);
  const g = c.createGain(), lv = percEnv(g.gain, t, v * 0.9, dec, 0.001);
  sum.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
  return { choke(t2) { if (t2 < end) cutEnv(g.gain, lv, t2, 0.01); } };
}

/* ---------- Instruments ---------- */
const VOICES = {
  kick(c, out, p, m, v, t, ch) {
    const k = Math.pow(2, (p.tune + m - ch.root) / 12), f0 = 48 * k, f1 = f0 * (2.2 + p.punch * 5);
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.04 + (1 - p.punch) * 0.06);
    percEnv(g.gain, t, v, p.decay, 0.002);
    o.connect(g);
    if (p.drive > 0.01) { const ws = c.createWaveShaper(); ws.curve = satCurve(p.drive * 0.6); g.connect(ws); ws.connect(out); } else g.connect(out);
    o.start(t); o.stop(t + p.decay + 0.05);
    if (p.click > 0.01) {
      const n = noiseSrc(c, t, 0.03), hp = biquad(c, 'highpass', 2500), ng = c.createGain();
      percEnv(ng.gain, t, v * p.click * 0.5, 0.012, 0.001);
      n.connect(hp); hp.connect(ng); ng.connect(out);
    }
    return null;
  },
  snare(c, out, p, m, v, t, ch) {
    const k = Math.pow(2, (p.tune + m - ch.root) / 12);
    const o = c.createOscillator(), og = c.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(250 * k, t);
    o.frequency.exponentialRampToValueAtTime(175 * k, t + 0.05);
    percEnv(og.gain, t, v * p.tone * 0.9, Math.max(0.05, p.decay * 0.55), 0.001);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + p.decay + 0.05);
    const n = noiseSrc(c, t, p.decay + 0.05), hp = biquad(c, 'highpass', 1200 * k), pk = biquad(c, 'peaking', 5000), ng = c.createGain();
    pk.gain.value = 4;
    percEnv(ng.gain, t, v * (0.25 + p.snappy * 0.6), p.decay, 0.001);
    n.connect(hp); hp.connect(pk); pk.connect(ng); ng.connect(out);
    return null;
  },
  clap(c, out, p, m, v, t, ch) {
    const k = Math.pow(2, (m - ch.root) / 12), sp = p.spread;
    const n = noiseSrc(c, t, p.decay + sp * 3 + 0.1), bp = biquad(c, 'bandpass', p.tone * k, 1.1), hp = biquad(c, 'highpass', 500), g = c.createGain();
    const G = g.gain;
    G.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) { const ti = t + i * sp; G.setValueAtTime(v, ti); G.exponentialRampToValueAtTime(v * 0.12, ti + sp * 0.92); }
    const tt = t + 3 * sp;
    G.setValueAtTime(v, tt);
    G.exponentialRampToValueAtTime(0.0001, tt + p.decay);
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);
    return null;
  },
  hat(c, out, p, m, v, t, ch) { return hatVoice(c, out, p, m, v, t, ch, p.decay, 8500); },
  ohat(c, out, p, m, v, t, ch) { return hatVoice(c, out, p, m, v, t, ch, p.decay, 8000); },
  crash(c, out, p, m, v, t, ch) { return hatVoice(c, out, p, m, v * 0.8, t, ch, p.decay, 6500); },
  tom(c, out, p, m, v, t, ch) {
    const k = Math.pow(2, (p.tune + m - ch.root) / 12), f = 110 * k;
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * (1 + p.sweep * 1.2), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06 + p.sweep * 0.14);
    percEnv(g.gain, t, v, p.decay, 0.002);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + p.decay + 0.05);
    return null;
  },
  cowbell(c, out, p, m, v, t, ch) {
    const k = Math.pow(2, (p.tune + m - ch.root) / 12), sum = c.createGain(), end = t + p.decay + 0.05;
    sum.gain.value = 0.35;
    for (const f of [587, 845]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * k; o.connect(sum); o.start(t); o.stop(end); }
    const bp = biquad(c, 'bandpass', 1000 * k, 0.9), g = c.createGain();
    percEnv(g.gain, t, v, p.decay, 0.001);
    sum.connect(bp); bp.connect(g); g.connect(out);
    return null;
  },
  bass808(c, out, p, m, v, t, ch, glide) {
    const f = mtof(m), o = c.createOscillator(), g = c.createGain();
    o.type = 'sine';
    if (glide) glideTo(o.frequency, f, t, glide, glideRatio(glide, m));
    else {
      o.frequency.setValueAtTime(f * (1 + p.glide * 2.5), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.03 + p.glide * 0.09);
    }
    const lv = percEnv(g.gain, t, v, p.decay, 0.004);
    const ws = c.createWaveShaper(), lp = biquad(c, 'lowpass', p.tone, 0.7);
    ws.curve = satCurve(p.drive * 0.7);
    o.connect(g); g.connect(ws); ws.connect(lp); lp.connect(out);
    const end = t + p.decay + 0.1;
    o.start(t); o.stop(end);
    return { choke(t2) { if (t2 < end) cutEnv(g.gain, lv, t2, 0.015); } };
  },
  synth(c, out, p, m, v, t, ch, glide) {
    return analogVoice(c, out, {
      waves: [{ type: p.w1, gain: 1 - p.mix }, { type: p.w2, gain: p.mix, det: p.det, oct: p.oct2 }],
      cut: p.cut, res: p.res, env: p.env, a: p.a, d: p.d, s: p.s, r: p.r, gain: p.gain, glide,
    }, m, v, t);
  },
  pad(c, out, p, m, v, t, ch, glide) {
    return analogVoice(c, out, {
      waves: [
        { type: 'sawtooth', gain: 0.3, det: -p.det }, { type: 'sawtooth', gain: 0.3 },
        { type: 'sawtooth', gain: 0.3, det: p.det }, { type: 'sine', gain: 0.35, oct: -1 },
      ],
      cut: p.cut, res: p.res, env: 0.15, a: p.a, d: 1.2, s: p.s, r: p.r, gain: p.gain, glide,
    }, m, v, t);
  },
  pluck(c, out, p, m, v, t, ch, glide) {
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = ksBuffer(c.sampleRate, m, p.bright, p.decay);
    glideTo(src.playbackRate, 1, t, glide, glideRatio(glide, m));
    g.gain.value = v * p.gain;
    src.connect(g); g.connect(out);
    src.start(t);
    return null;
  },
  epiano(c, out, p, m, v, t, ch, glide) {
    const f = mtof(m), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), gr = glideRatio(glide, m);
    glideTo(car.frequency, f, t, glide, gr);
    glideTo(mod.frequency, f * p.ratio, t, glide, gr);
    const idx = p.index * f * (0.4 + v * 0.8);
    mg.gain.setValueAtTime(idx, t);
    mg.gain.setTargetAtTime(idx * 0.12, t, p.decay * 0.2);
    mod.connect(mg); mg.connect(car.frequency);
    const vca = c.createGain(), trem = c.createGain(), lfo = c.createOscillator(), depth = c.createGain();
    const peak = Math.max(0.0005, v * p.gain), tau = p.decay / 3;
    vca.gain.setValueAtTime(0, t);
    vca.gain.linearRampToValueAtTime(peak, t + 0.003);
    vca.gain.setTargetAtTime(0, t + 0.003, tau);
    lfo.frequency.value = 4.6;
    depth.gain.value = p.trem * 0.35;
    trem.gain.value = 1 - p.trem * 0.35;
    lfo.connect(depth); depth.connect(trem.gain);
    car.connect(vca); vca.connect(trem); trem.connect(out);
    [car, mod, lfo].forEach(o => o.start(t));
    let done = false;
    return {
      stop(t2) {
        if (done) return;
        done = true;
        t2 = Math.max(t2, t + 0.004);
        const lvl = peak * Math.exp(-(t2 - t - 0.003) / tau);
        vca.gain.cancelScheduledValues(t2);
        vca.gain.setValueAtTime(lvl, t2);
        vca.gain.setTargetAtTime(0, t2, Math.max(0.005, p.r / 4));
        const end = t2 + p.r * 1.6 + 0.05;
        [car, mod, lfo].forEach(o => o.stop(end));
      },
    };
  },
  supersaw(c, out, p, m, v, t, ch, glide) {
    const n = clamp(Math.round(p.voices), 1, 9), waves = [];
    let norm = 0;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i / (n - 1)) * 2 - 1, w = Math.abs(x) < 1e-6 ? 1 : p.mix;
      waves.push({ type: 'sawtooth', gain: w, det: x * p.det, pan: x * p.width });
      norm += w * w;
    }
    norm = 1 / Math.sqrt(Math.max(norm, 1e-6));
    waves.forEach(w => { w.gain *= norm; });
    return analogVoice(c, out, { waves, cut: p.cut, res: p.res, env: p.env, a: p.a, d: p.d, s: p.s, r: p.r, gain: p.gain, glide }, m, v, t);
  },
  // TB-303 style mono bass: overlapping notes slide (legato) instead of retriggering, loud notes are accented.
  acid(c, out, p, m, v, t) {
    const o = c.createOscillator(), flt = biquad(c, 'lowpass', p.cut, p.res), vca = c.createGain();
    o.type = p.wave;
    o.frequency.value = mtof(m);
    o.connect(flt); flt.connect(vca); vca.connect(out);
    const G = vca.gain, F = flt.frequency;
    let stopAt = Infinity, peak = 0;
    const strike = (vel, t0, retrig) => {
      const acc = vel > 0.8 ? p.accent : 0;
      peak = Math.max(0.0005, vel * p.gain * (1 + acc * 0.6));
      const top = Math.min(18000, p.cut * (1 + p.env * 8 * (1 + acc)));
      if (retrig) { G.setValueAtTime(0, t0); G.linearRampToValueAtTime(peak, t0 + 0.003); }
      else G.setTargetAtTime(peak, t0, 0.004);
      F.cancelScheduledValues(t0);
      F.setValueAtTime(retrig ? p.cut : top * 0.8, t0);
      F.linearRampToValueAtTime(top, t0 + 0.004);
      F.setTargetAtTime(p.cut, t0 + 0.004, Math.max(0.01, p.decay / 3));
    };
    strike(v, t, true);
    o.start(t);
    const voice = {
      gen: 0,
      legato(m2, v2, t2) {
        if (!(t2 < stopAt - 1e-4)) return false;
        G.cancelScheduledValues(t2);
        G.setValueAtTime(peak, t2);
        stopAt = Infinity;
        o.frequency.setTargetAtTime(mtof(m2), t2, p.glide / 3);
        if (v2 > 0.8) strike(v2, t2, false);
        return true;
      },
      stop(t2) {
        t2 = Math.max(t2, t + 0.003);
        stopAt = t2;
        G.cancelScheduledValues(t2);
        G.setValueAtTime(peak, t2);
        G.setTargetAtTime(0, t2, 0.006);
        o.stop(t2 + 0.06);
      },
      choke(t2) { if (t2 < stopAt) voice.stop(t2); },
    };
    return voice;
  },
  fm4(c, out, p, m, v, t, ch, glide) {
    const f = mtof(m), gr = glideRatio(glide, m), ops = [p.r1, p.r2, p.r3, p.r4].map(r => { const o = c.createOscillator(); glideTo(o.frequency, f * r, t, glide, gr); return o; });
    const idx = [0, 0, p.i2, p.i3, p.i4];
    const mods = [];
    // depth of the modulator k (1-based) in Hz, shaped by its own envelope
    const mod = (k, dst) => {
      const g = c.createGain(), depth = idx[k] * f * [p.r1, p.r2, p.r3, p.r4][k - 1] * (0.5 + 0.5 * v);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(depth, t + Math.max(0.001, p.a));
      g.gain.setTargetAtTime(depth * p.msus, t + Math.max(0.001, p.a), Math.max(0.005, p.mdec / 3));
      ops[k - 1].connect(g); g.connect(ops[dst - 1].frequency);
      mods.push(g);
    };
    const carriers = [];
    switch (p.alg) {
      case 'branch': mod(3, 2); mod(4, 2); mod(2, 1); carriers.push([1, 1]); break;
      case 'pairs': mod(4, 3); mod(2, 1); carriers.push([1, 0.5], [3, 0.5]); break;
      case 'triple': mod(4, 1); mod(4, 2); mod(4, 3); carriers.push([1, 1 / 3], [2, 1 / 3], [3, 1 / 3]); break;
      case 'add': {
        const lv = [1, Math.min(1, p.i2 / 6), Math.min(1, p.i3 / 6), Math.min(1, p.i4 / 6)], sum = lv.reduce((a, b) => a + b, 0);
        lv.forEach((l, k) => carriers.push([k + 1, l / sum]));
        break;
      }
      default: mod(4, 3); mod(3, 2); mod(2, 1); carriers.push([1, 1]);
    }
    const vca = c.createGain();
    for (const [k, l] of carriers) { const g = c.createGain(); g.gain.value = l; ops[k - 1].connect(g); g.connect(vca); }
    vca.connect(out);
    const peak = Math.max(0.0005, v * p.gain), a = Math.max(0.001, p.a), tau = Math.max(0.005, p.d / 3), G = vca.gain;
    G.setValueAtTime(0, t);
    G.linearRampToValueAtTime(peak, t + a);
    G.setTargetAtTime(peak * p.s, t + a, tau);
    ops.forEach(o => o.start(t));
    let done = false;
    return {
      stop(t2) {
        if (done) return;
        done = true;
        t2 = Math.max(t2, t + 0.003);
        const lvl = t2 < t + a ? peak * (t2 - t) / a : peak * p.s + (peak - peak * p.s) * Math.exp(-(t2 - t - a) / tau);
        G.cancelScheduledValues(t2);
        G.setValueAtTime(lvl, t2);
        G.setTargetAtTime(0, t2, Math.max(0.004, p.r / 4));
        mods.forEach(g => { g.gain.cancelScheduledValues(t2); g.gain.setTargetAtTime(0, t2, Math.max(0.004, p.r / 4)); });
        const end = t2 + p.r * 1.6 + 0.05;
        ops.forEach(o => o.stop(end));
      },
    };
  },
  // Tonewheel organ: nine sine drawbars, percussion on the third harmonic, vibrato and key click.
  organ(c, out, p, m, v, t, ch, glide) {
    const gr = glideRatio(glide, m), f = mtof(m), harm = [0.5, 1.5, 1, 2, 3, 4, 5, 6, 8], bars = [p.b1, p.b2, p.b3, p.b4, p.b5, p.b6, p.b7, p.b8, p.b9];
    const sum = c.createGain(), vca = c.createGain(), lfo = c.createOscillator(), vib = c.createGain();
    const total = Math.max(1, bars.reduce((a, b) => a + b, 0));
    lfo.frequency.value = 6.5;
    vib.gain.value = p.vib * 25;
    lfo.connect(vib);
    const oscs = [lfo];
    bars.forEach((b, k) => {
      if (b < 0.001) return;
      const o = c.createOscillator(), g = c.createGain();
      glideTo(o.frequency, f * harm[k], t, glide, gr);
      vib.connect(o.detune);
      g.gain.value = b / total;
      o.connect(g); g.connect(sum);
      oscs.push(o);
    });
    if (p.perc > 0.001) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = f * 3;
      percEnv(g.gain, t, p.perc * 0.6, 0.25, 0.002);
      o.connect(g); g.connect(sum);
      o.start(t); o.stop(t + 0.4);
    }
    if (p.click > 0.001) {
      const n = noiseSrc(c, t, 0.02), bp = biquad(c, 'bandpass', 2400, 0.8), g = c.createGain();
      percEnv(g.gain, t, p.click * 0.3, 0.006, 0.0005);
      n.connect(bp); bp.connect(g); g.connect(sum);
    }
    sum.connect(vca); vca.connect(out);
    const peak = Math.max(0.0005, (0.55 + 0.45 * v) * p.gain), G = vca.gain;
    G.setValueAtTime(0, t);
    G.linearRampToValueAtTime(peak, t + 0.005);
    oscs.forEach(o => o.start(t));
    let done = false;
    return {
      stop(t2) {
        if (done) return;
        done = true;
        t2 = Math.max(t2, t + 0.006);
        G.cancelScheduledValues(t2);
        G.setValueAtTime(peak, t2);
        G.setTargetAtTime(0, t2, 0.012);
        oscs.forEach(o => o.stop(t2 + 0.1));
      },
    };
  },
  sampler(c, out, p, m, v, t, ch, glide) {
    const smp = ch.sample && SAMPLES[ch.sample];
    if (!smp || !smp.buffer) return null;
    const rev = p.rev === 'rev', looping = p.loop !== 'off';
    const base = rev ? reversedBuffer(smp) : smp.buffer, dur = base.duration;
    const s0 = clamp(p.start, 0, 1) * dur, s1 = Math.max(s0 + 0.002, clamp(p.end, 0, 1) * dur);
    const src = c.createBufferSource();
    if (looping) {
      const ls = clamp(p.ls, 0, 1) * dur, le = Math.max(ls + 0.002, clamp(p.le, 0, 1) * dur);
      if (p.loop === 'ping') {
        // ping-pong: the loop region followed by its mirror image, looped forwards
        src.buffer = pingPongBuffer(smp, rev, ls, le);
        src.loopStart = ls;
        src.loopEnd = le + (le - ls);
      } else { src.buffer = base; src.loopStart = ls; src.loopEnd = le; }
      src.loop = true;
    } else src.buffer = base;
    const rate = Math.pow(2, (m - ch.root + p.pitch) / 12);
    // pitch: portamento from the previous note, then the pitch envelope on top
    const pr = src.playbackRate, startRate = glide ? rate * glideRatio(glide, m) : rate;
    if (p.penv) {
      pr.setValueAtTime(startRate * Math.pow(2, p.penv / 12), t);
      pr.setTargetAtTime(rate, t, Math.max(0.001, (glide ? Math.min(glide.time, p.pd) : p.pd) / 3));
    } else glideTo(pr, rate, t, glide, glideRatio(glide, m));
    let node = src;
    // filter with its own envelope (bipolar, up to ±6 octaves) and LFO
    let filt = null;
    if (p.ftype !== 'off') {
      const type = { lp: 'lowpass', lp24: 'lowpass', hp: 'highpass', bp: 'bandpass', notch: 'notch' }[p.ftype];
      const q = p.ftype === 'bp' || p.ftype === 'notch' ? 0.5 + p.fres : p.fres;
      filt = [biquad(c, type, p.fcut, q)];
      if (p.ftype === 'lp24') filt.push(biquad(c, 'lowpass', p.fcut, q));
      filt.forEach(f => { node.connect(f); node = f; });
      if (p.fenv) {
        const peak = clamp(p.fcut * Math.pow(2, p.fenv * 6), 20, 20000), sus = clamp(p.fcut * Math.pow(2, p.fenv * 6 * p.fs), 20, 20000);
        filt.forEach(f => {
          f.frequency.setValueAtTime(p.fcut, t);
          f.frequency.linearRampToValueAtTime(peak, t + p.fa);
          f.frequency.setTargetAtTime(sus, t + p.fa, Math.max(0.003, p.fd / 3));
        });
      }
    }
    // amplitude: normalise, fades of the sample region, AHDSR envelope
    const norm = p.norm === 'on' ? 1 / Math.max(1e-4, samplePeak(smp)) : 1;
    const peak = Math.max(0.0005, v * p.gain * norm);
    const fade = c.createGain(), env = c.createGain();
    node.connect(fade); fade.connect(env);
    node = env;
    const playLen = (s1 - s0) / rate; // seconds of output when not looping (pitch envelope ignored)
    if (p.fin > 0) { fade.gain.setValueAtTime(0, t); fade.gain.linearRampToValueAtTime(1, t + Math.min(p.fin, playLen)); }
    if (p.fout > 0 && !looping) { const fo = Math.min(p.fout, playLen); fade.gain.setValueAtTime(1, t + playLen - fo); fade.gain.linearRampToValueAtTime(0, t + playLen); }
    const a = Math.max(0.001, p.a), G = env.gain;
    G.setValueAtTime(0, t);
    G.linearRampToValueAtTime(peak, t + a);
    if (p.h > 0) G.setValueAtTime(peak, t + a + p.h);
    if (p.d > 0) G.setTargetAtTime(peak * p.s, t + a + p.h, p.d / 3);
    // LFOs: volume, pan, filter and pitch from one oscillator that starts with the note
    let lfo = null;
    if (p.lvol > 0 || p.lpan > 0 || (p.lcut > 0 && filt) || p.lpit > 0) {
      lfo = c.createOscillator();
      lfo.type = p.lshape;
      lfo.frequency.value = p.lrate;
      if (p.lvol > 0) {
        const trem = c.createGain(), dep = c.createGain();
        trem.gain.value = 1 - p.lvol / 2;
        dep.gain.value = p.lvol / 2;
        lfo.connect(dep); dep.connect(trem.gain);
        node.connect(trem); node = trem;
      }
      if (p.lpan > 0) {
        const pan = c.createStereoPanner(), dep = c.createGain();
        pan.pan.value = 0;
        dep.gain.value = p.lpan;
        lfo.connect(dep); dep.connect(pan.pan);
        node.connect(pan); node = pan;
      }
      if (p.lcut > 0 && filt) { const dep = c.createGain(); dep.gain.value = p.lcut * 4800; lfo.connect(dep); filt.forEach(f => dep.connect(f.detune)); }
      if (p.lpit > 0) { const dep = c.createGain(); dep.gain.value = p.lpit * 100; lfo.connect(dep); dep.connect(src.detune); }
      lfo.start(t);
    }
    node.connect(out);
    if (looping) src.start(t, s0); else src.start(t, s0, s1 - s0);
    const end = looping ? Infinity : t + playLen;
    if (lfo && end !== Infinity) lfo.stop(end + 0.05);
    // envelope level at any time before the release, to start the release from where the envelope is
    const levelAt = t2 => {
      const x = t2 - t;
      if (x < a) return peak * Math.max(0, x) / a;
      if (x < a + p.h || p.d <= 0) return peak;
      return peak * p.s + (peak - peak * p.s) * Math.exp(-(x - a - p.h) / (p.d / 3));
    };
    let done = false;
    const release = (t2, rel) => {
      if (done || t2 >= end) return;
      done = true;
      G.cancelScheduledValues(t2);
      G.setValueAtTime(levelAt(t2), t2);
      G.setTargetAtTime(0, t2, rel / 4);
      if (filt && p.fenv) filt.forEach(f => { f.frequency.cancelScheduledValues(t2); f.frequency.setTargetAtTime(p.fcut, t2, rel / 4); });
      const stopAt = Math.min(end, t2 + rel * 2 + 0.02);
      src.stop(stopAt);
      if (lfo) lfo.stop(stopAt + 0.01);
    };
    return {
      stop(t2) { if (p.cut === 'note' || looping) release(t2, Math.max(0.005, p.r)); },
      choke(t2) { release(t2, 0.01); },
    };
  },
};

/* ---------- Mixer effects ---------- */
function mixPair(c) {
  const input = c.createGain(), dry = c.createGain(), wet = c.createGain(), output = c.createGain();
  input.connect(dry); dry.connect(output); wet.connect(output);
  return { input, dry, wet, output, setMix(m) { sp(dry.gain, Math.cos(m * Math.PI / 2)); sp(wet.gain, Math.sin(m * Math.PI / 2)); } };
}
function impulse(c, secs) {
  const sr = c.sampleRate, len = Math.max(1, Math.floor(sr * secs)), b = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const x = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-6.9 * x) * Math.min(1, i / (sr * 0.004));
    }
  }
  return b;
}
const FX_IMPL = {
  eq(c) {
    const lo = biquad(c, 'lowshelf', 180), mid = biquad(c, 'peaking', 1000, 0.9), hi = biquad(c, 'highshelf', 6500);
    lo.connect(mid); mid.connect(hi);
    return { input: lo, output: hi, set(p) { sp(lo.gain, p.low); sp(mid.gain, p.mid); sp(mid.frequency, p.midf); sp(hi.gain, p.high); } };
  },
  filter(c) {
    const f = c.createBiquadFilter();
    return { input: f, output: f, set(p) { f.type = p.type; sp(f.frequency, p.freq); sp(f.Q, p.q); } };
  },
  comp(c) {
    const k = c.createDynamicsCompressor(), g = c.createGain();
    k.connect(g);
    return { input: k, output: g, set(p) { sp(k.threshold, p.thr); sp(k.ratio, p.ratio); sp(k.attack, p.att); sp(k.release, p.rel); k.knee.value = 6; sp(g.gain, dbToGain(p.makeup)); } };
  },
  limiter(c) {
    const pre = c.createGain(), k = c.createDynamicsCompressor();
    pre.connect(k);
    k.knee.value = 0; k.ratio.value = 20; k.attack.value = 0.001; k.release.value = 0.06;
    return { input: pre, output: k, set(p) { sp(pre.gain, dbToGain(p.gain)); sp(k.threshold, p.ceil); } };
  },
  dist(c) {
    const m = mixPair(c), ws = c.createWaveShaper(), lp = biquad(c, 'lowpass', 5000), out = c.createGain();
    ws.oversample = '2x';
    m.input.connect(ws); ws.connect(lp); lp.connect(m.wet); m.output.connect(out);
    return { input: m.input, output: out, set(p) { ws.curve = satCurve(p.drive); sp(lp.frequency, p.tone); sp(m.dry.gain, 1 - p.mix); sp(m.wet.gain, p.mix); sp(out.gain, p.out); } };
  },
  delay(c, slot) {
    const m = mixPair(c), dl = c.createDelay(4), dr = c.createDelay(4), fb = c.createGain(), lp = biquad(c, 'lowpass', 4000);
    if (slot.params.pp === 'on') {
      const mono = c.createGain(), merge = c.createChannelMerger(2);
      mono.channelCount = 1; mono.channelCountMode = 'explicit';
      m.input.connect(mono); mono.connect(dl);
      dl.connect(lp); lp.connect(dr); dr.connect(fb); fb.connect(dl);
      dl.connect(merge, 0, 0); dr.connect(merge, 0, 1); merge.connect(m.wet);
    } else {
      m.input.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); dl.connect(m.wet);
    }
    return {
      input: m.input, output: m.output,
      set(p) {
        const sec = Math.min(3.9, parseFloat(p.time) * 60 / proj.bpm);
        dl.delayTime.value = sec; dr.delayTime.value = sec;
        sp(fb.gain, p.fb); sp(lp.frequency, p.tone); m.setMix(p.mix);
      },
    };
  },
  reverb(c) {
    const m = mixPair(c), pre = c.createDelay(0.5), conv = c.createConvolver(), damp = biquad(c, 'lowpass', 6000);
    m.input.connect(pre); pre.connect(conv); conv.connect(damp); damp.connect(m.wet);
    let size = -1;
    return {
      input: m.input, output: m.output,
      set(p) {
        if (Math.abs(p.size - size) > 0.04) { size = p.size; conv.buffer = impulse(c, p.size); }
        sp(damp.frequency, p.damp); pre.delayTime.value = p.pre; m.setMix(p.mix);
      },
    };
  },
  chorus(c) {
    const m = mixPair(c), d1 = c.createDelay(0.1), d2 = c.createDelay(0.1), lfo = c.createOscillator();
    const g1 = c.createGain(), g2 = c.createGain(), inv = c.createGain(), merge = c.createChannelMerger(2);
    d1.delayTime.value = 0.014; d2.delayTime.value = 0.019; inv.gain.value = -1;
    lfo.connect(g1); g1.connect(d1.delayTime);
    lfo.connect(inv); inv.connect(g2); g2.connect(d2.delayTime);
    m.input.connect(d1); m.input.connect(d2);
    d1.connect(merge, 0, 0); d2.connect(merge, 0, 1); merge.connect(m.wet);
    lfo.start();
    return {
      input: m.input, output: m.output,
      set(p) { sp(lfo.frequency, p.rate); sp(g1.gain, p.depth * 0.005); sp(g2.gain, p.depth * 0.005); m.setMix(p.mix); },
      dispose() { try { lfo.stop(); } catch (e) { /* already stopped */ } },
    };
  },
  phaser(c, slot) {
    const m = mixPair(c), n = parseInt(slot.params.stages, 10) || 6, lfo = c.createOscillator(), depth = c.createGain();
    const stages = Array.from({ length: n }, () => biquad(c, 'allpass', 800, 0.7));
    const fbIn = c.createGain(), fb = c.createGain(), fbDelay = c.createDelay(0.01);
    m.input.connect(fbIn);
    let node = fbIn;
    stages.forEach(a => { node.connect(a); node = a; lfo.connect(depth); depth.connect(a.frequency); });
    node.connect(m.wet);
    node.connect(fb); fb.connect(fbDelay); fbDelay.connect(fbIn);
    fbDelay.delayTime.value = 0;
    lfo.start();
    return {
      input: m.input, output: m.output,
      set(p) {
        sp(lfo.frequency, p.rate);
        stages.forEach(a => sp(a.frequency, p.freq));
        sp(depth.gain, p.freq * p.depth * 0.9);
        sp(fb.gain, p.fb);
        m.setMix(p.mix);
      },
      dispose() { try { lfo.stop(); } catch (e) { /* already stopped */ } },
    };
  },
  flanger(c, slot) {
    const m = mixPair(c), dl = c.createDelay(0.05), lfo = c.createOscillator(), depth = c.createGain(), fb = c.createGain();
    m.input.connect(dl); dl.connect(m.wet);
    lfo.connect(depth); depth.connect(dl.delayTime);
    // Web Audio feedback loops need at least one render quantum of delay: only close the loop when feedback is used.
    if (Math.abs(slot.params.fb) > 0.01) { dl.connect(fb); fb.connect(dl); }
    lfo.start();
    return {
      input: m.input, output: m.output,
      set(p) {
        sp(lfo.frequency, p.rate);
        sp(dl.delayTime, (p.delay + p.depth / 2) / 1000);
        sp(depth.gain, p.depth / 2000);
        sp(fb.gain, p.fb);
        m.setMix(p.mix);
      },
      dispose() { try { lfo.stop(); } catch (e) { /* already stopped */ } },
    };
  },
  bitcrush(c) {
    if (c._ritmoWk) {
      const n = new AudioWorkletNode(c, 'ritmo-crush', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      const P = n.parameters;
      return { input: n, output: n, set(p) { sp(P.get('bits'), p.bits); sp(P.get('down'), p.down); sp(P.get('mix'), p.mix); } };
    }
    // Without AudioWorklet: quantize only (no sample-rate reduction).
    const mp = mixPair(c), ws = c.createWaveShaper();
    mp.input.connect(ws); ws.connect(mp.wet);
    let bits = -1;
    return {
      input: mp.input, output: mp.output,
      set(p) {
        if (p.bits !== bits) {
          bits = p.bits;
          const q = Math.pow(2, bits - 1), N = 8192, cv = new Float32Array(N);
          for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; cv[i] = Math.round(x * q) / q; }
          ws.curve = cv;
        }
        sp(mp.dry.gain, 1 - p.mix); sp(mp.wet.gain, p.mix);
      },
    };
  },
  width(c) {
    const st = stereoMatrix(c), out = c.createGain();
    st.output.connect(out);
    return { input: st.input, output: out, set(p) { st.set({ width: p.width, phase: false, swap: false }); sp(out.gain, p.gain); } };
  },
  // Tempo-synced volume gate: the sequencer calls step() with every sixteenth it schedules.
  gate(c) {
    const g = c.createGain();
    let P = null;
    return {
      input: g, output: g,
      set(p) { P = p; },
      step(t, s, sd) {
        const pat = GATE_PATTERNS[P.pattern] || GATE_PATTERNS['16'];
        for (let k = 0; k < 2; k++) {
          const val = pat[(s * 2 + k) % pat.length], gain = 1 - P.depth * P.mix * (1 - val);
          g.gain.setTargetAtTime(gain, t + k * sd / 2, P.smooth / 3);
        }
      },
      reset() { g.gain.cancelScheduledValues(0); g.gain.value = 1; },
    };
  },
  tremolo(c, slot) {
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.type = slot.params.shape;
    lfo.connect(depth);
    lfo.start();
    if (slot.params.mode === 'pan') {
      const pn = c.createStereoPanner();
      pn.pan.value = 0;
      depth.connect(pn.pan);
      return {
        input: pn, output: pn,
        set(p) { sp(lfo.frequency, p.rate); sp(depth.gain, p.depth); },
        dispose() { try { lfo.stop(); } catch (e) { /* already stopped */ } },
      };
    }
    const g = c.createGain();
    depth.connect(g.gain);
    return {
      input: g, output: g,
      set(p) { sp(lfo.frequency, p.rate); sp(depth.gain, p.depth / 2); sp(g.gain, 1 - p.depth / 2); },
      dispose() { try { lfo.stop(); } catch (e) { /* already stopped */ } },
    };
  },
  // Sidechain ducking: the level of another mixer track pushes this track's volume down.
  ducker(c, slot, strip) {
    const g = c.createGain(), abs = c.createWaveShaper(), lp = biquad(c, 'lowpass', 5, 0.5), curve = c.createWaveShaper();
    const A = new Float32Array(4097);
    for (let i = 0; i < A.length; i++) A[i] = Math.abs((i / (A.length - 1)) * 2 - 1);
    abs.curve = A;
    abs.connect(lp); lp.connect(curve);
    g.gain.value = 1;
    let linked = null, key = '';
    const fx = {
      input: g, output: g,
      set(p) {
        lp.frequency.value = 1 / (2 * Math.PI * Math.max(0.005, p.rel));
        const k = p.thr + '|' + p.range;
        if (k !== key) {
          key = k;
          const N = 32768, cv = new Float32Array(N);
          for (let i = 0; i < N; i++) {
            const e = (i / (N - 1)) * 2 - 1, db = e > 1e-6 ? 20 * Math.log10(e) : -120;
            cv[i] = dbToGain(-p.range * clamp((db - p.thr) / 12, 0, 1));
          }
          curve.curve = cv;
        }
        if (strip.eng.linked && linked !== Math.round(p.src)) fx.link(strip.eng);
      },
      link(eng) {
        const src = Math.round(slot.params.src), from = eng.strips[src];
        if (linked != null) { try { eng.strips[linked].output.disconnect(abs); } catch (e) { /* gone */ } try { curve.disconnect(); } catch (e) { /* not connected */ } }
        linked = null;
        g.gain.value = 1;
        if (!from || src === strip.i || reaches(strip.i, src)) return;
        from.output.connect(abs);
        curve.connect(g.gain);
        g.gain.value = 0;
        linked = src;
      },
      dispose() { if (linked != null) { try { strip.eng.strips[linked].output.disconnect(abs); } catch (e) { /* gone */ } } },
    };
    return fx;
  },
};
const expand16 = a => a.flatMap(x => [x, x]);
// Gate shapes in 32nd notes, repeated along the song
const GATE_PATTERNS = {
  8: [1, 1, 0, 0],
  16: [1, 0],
  dot: [1, 1, 1, 1, 0, 0],
  tranceA: expand16([1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0]),
  tranceB: expand16([1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0]),
  stutter: [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1],
};

/* ---------- Engine: channel strips → mixer inserts → master ---------- */
function setParam(param, v, eng) {
  if (AT) param.setTargetAtTime(v, AT.t, 0.006);
  else if (eng.live) param.setTargetAtTime(v, eng.c.currentTime, 0.015);
  else param.value = v;
}

class Strip {
  constructor(eng, i) {
    const c = eng.c;
    this.eng = eng; this.i = i;
    this.input = c.createGain();
    this.pan = c.createStereoPanner();
    this.fader = c.createGain();
    this.output = this.fader;      // post-fader signal: meters, sends and sidechain taps listen here
    this.out = c.createGain();      // main output, routed to another track or to the speakers
    this.pan.connect(this.fader);
    this.fader.connect(this.out);
    this.fx = [];
    this.extra = [];
    this.sendGains = [];
    if (eng.live) {
      this.split = c.createChannelSplitter(2);
      this.an = [c.createAnalyser(), c.createAnalyser()];
      this.an.forEach(a => { a.fftSize = 512; });
      this.fader.connect(this.split);
      this.split.connect(this.an[0], 0);
      this.split.connect(this.an[1], 1);
      this.buf = new Float32Array(512);
      this.level = [0, 0];
    }
    this.buildFx();
    this.update();
  }
  get data() { return proj.mixer[this.i]; }
  buildFx() {
    const c = this.eng.c, d = this.data;
    this.input.disconnect();
    [...this.fx, ...this.extra].forEach(f => { try { f.output.disconnect(); f.dispose && f.dispose(); } catch (e) { /* ignore */ } });
    this.fx = [];
    this.extra = [];
    let node = this.input;
    for (const slot of d.fx) {
      if (!slot || !FX_IMPL[slot.type]) continue;
      const f = FX_IMPL[slot.type](c, slot, this);
      f.slot = slot;
      f.set(slot.params);
      this.fx.push(f);
      if (!slot.on) continue;
      const mix = slot.mix ?? 1;
      if (mix >= 0.999) { node.connect(f.input); node = f.output; continue; }
      // slot mix knob: blend the effect with the dry signal
      const sum = c.createGain(), dry = c.createGain(), wet = c.createGain();
      dry.gain.value = 1 - mix; wet.gain.value = mix;
      node.connect(dry); dry.connect(sum);
      node.connect(f.input); f.output.connect(wet); wet.connect(sum);
      this.extra.push({ output: sum });
      node = sum;
    }
    // Track EQ and stereo tools sit after the effects, before pan and fader; they cost nothing while flat.
    this.eqNode = null;
    this.stereo = null;
    if (eqActive(d.eq)) { const e = FX_IMPL.eq(c); e.set(d.eq); node.connect(e.input); node = e.output; this.extra.push(e); this.eqNode = e; }
    if (stereoActive(d)) { const m = stereoMatrix(c); m.set(d); node.connect(m.input); node = m.output; this.extra.push(m); this.stereo = m; }
    node.connect(this.pan);
    if (this.eng.linked) this.link();
  }
  link() { this.fx.forEach(f => f.link && f.link(this.eng)); }
  route() {
    const eng = this.eng, d = this.data;
    this.out.disconnect();
    this.sendGains.forEach(g => { try { this.fader.disconnect(g); g.disconnect(); } catch (e) { /* ignore */ } });
    this.sendGains = [];
    if (this.i === 0) { this.out.connect(eng.dest); return; }
    this.out.connect((eng.strips[d.out] || eng.strips[0]).input);
    for (const snd of d.sends) {
      const tgt = eng.strips[snd.to];
      if (!tgt || snd.to === this.i) continue;
      const g = eng.c.createGain();
      g.gain.value = snd.lv * snd.lv;
      this.fader.connect(g);
      g.connect(tgt.input);
      g.to = snd.to;
      this.sendGains.push(g);
    }
  }
  update() {
    const d = this.data;
    if (eqActive(d.eq) !== !!this.eqNode || stereoActive(d) !== !!this.stereo) this.buildFx();
    else {
      if (this.eqNode) this.eqNode.set(d.eq);
      if (this.stereo) this.stereo.set(d);
    }
    setParam(this.fader.gain, d.mute ? 0 : d.vol * d.vol, this.eng);
    setParam(this.pan.pan, d.pan, this.eng);
    this.sendGains.forEach(g => { const snd = d.sends.find(x => x.to === g.to); if (snd) setParam(g.gain, snd.lv * snd.lv, this.eng); });
  }
  updateFx() { this.fx.forEach(f => f.set(f.slot.params)); }
  meter() {
    for (let k = 0; k < 2; k++) {
      this.an[k].getFloatTimeDomainData(this.buf);
      let pk = 0;
      for (let i = 0; i < this.buf.length; i++) { const a = Math.abs(this.buf[i]); if (a > pk) pk = a; }
      this.level[k] = Math.max(pk, this.level[k] * 0.9);
    }
    return this.level;
  }
  dispose() {
    try { this.fader.disconnect(); this.out.disconnect(); this.input.disconnect(); } catch (e) { /* ignore */ }
    [...this.fx, ...this.extra].forEach(f => f.dispose && f.dispose());
  }
}
const eqActive = eq => !!(eq && (eq.low || eq.mid || eq.high));
const stereoActive = d => d.width !== 1 || d.phase || d.swap;

class Engine {
  constructor(c, live) {
    this.c = c; this.live = live;
    this.dest = c.destination;
    this.strips = proj.mixer.map((_, i) => new Strip(this, i));
    this.routes();
    this.linked = true;
    this.strips.forEach(s => s.link());
    this.chans = new Map();
    this.clipSources = new Set();
    this.lastPitch = new Map();
    this.mono = new Map();
    this.liveVoices = new Set();
    // Voices that slide notes may bend: the oscillators and sample players each note creates are recorded through
    // a stand-in for the audio context, so a later slide note can move their pitch.
    this.rec = null;
    this.sounding = new Map();
    this.pc = new Proxy(c, {
      get: (target, prop) => {
        const v = target[prop];
        if (typeof v !== 'function') return v;
        if (prop === 'createOscillator' || prop === 'createBufferSource') return (...a) => { const n = v.apply(target, a); if (this.rec) this.rec.push(n); return n; };
        return v.bind(target);
      },
    });
    proj.channels.forEach(ch => this.chan(ch));
    if (live) this.startLogger();
  }
  // Audio Logger: always keeps the last 60 seconds of the master output.
  startLogger() {
    const c = this.c, size = Math.floor(c.sampleRate * 60);
    this.log = { l: new Float32Array(size), r: new Float32Array(size), w: 0, filled: 0 };
    const sp = c.createScriptProcessor(4096, 2, 1);
    sp.onaudioprocess = e => {
      const L = e.inputBuffer.getChannelData(0), R = e.inputBuffer.getChannelData(1), log = this.log, n = L.length;
      for (let i = 0; i < n; i++) { log.l[log.w] = L[i]; log.r[log.w] = R[i]; log.w = (log.w + 1) % size; }
      log.filled = Math.min(size, log.filled + n);
    };
    this.strips[0].output.connect(sp);
    sp.connect(c.destination);
    this.loggerNode = sp;
  }
  loggedAudio() {
    const log = this.log;
    if (!log || !log.filled) return null;
    const size = log.l.length, n = log.filled, start = (log.w - n + size) % size;
    const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: this.c.sampleRate });
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < n; i++) { L[i] = log.l[(start + i) % size]; R[i] = log.r[(start + i) % size]; }
    return buf;
  }
  chan(ch) {
    let n = this.chans.get(ch.id);
    if (!n) {
      const c = this.c;
      n = { bus: c.createGain(), vol: c.createGain(), pan: c.createStereoPanner(), to: -1 };
      n.bus.connect(n.vol); n.vol.connect(n.pan);
      this.chans.set(ch.id, n);
      this.updateChan(ch, n);
    }
    return n;
  }
  updateChan(ch, n = this.chans.get(ch.id)) {
    if (!n) { this.chan(ch); return; }
    setParam(n.vol.gain, audible(ch) ? ch.vol * ch.vol * 1.3 : 0, this);
    setParam(n.pan.pan, ch.pan, this);
    if (n.to !== ch.mixer) {
      n.pan.disconnect();
      n.pan.connect((this.strips[ch.mixer] || this.strips[0]).input);
      n.to = ch.mixer;
    }
  }
  updateAllChans() { proj.channels.forEach(ch => this.updateChan(ch)); }
  removeChan(id) { const n = this.chans.get(id); if (n) { n.pan.disconnect(); this.chans.delete(id); } }
  updateStrip(i) { this.strips[i] && this.strips[i].update(); }
  // Output routing and sends changed: reconnect every track (the UI refuses routes that would loop).
  routes() { this.strips.forEach(s => s.route()); if (this.linked) this.strips.forEach(s => s.link()); }
  rebuildFx(i) { this.strips[i] && this.strips[i].buildFx(); }
  updateFx(i) { this.strips[i] && this.strips[i].updateFx(); }
  updateTempo() { this.strips.forEach(s => s.updateFx()); }
  // x: the note's own properties (fine pitch, pan, mod X/Y, release, colour, portamento); track: remember the voice for slide notes.
  trigger(ch, m, v, t, dur, x, track) {
    const fn = VOICES[ch.type];
    if (!fn) return null;
    const def = INSTRUMENTS[ch.type];
    v = clamp(v, 0.02, 1);
    let params = ch.params, out = null;
    if (x) {
      if (x.fine) m += x.fine;
      params = noteParams(ch, x);
    }
    let voice = null;
    if (def.legato) {
      const prev = this.mono.get(ch.id);
      if (prev && prev.legato && prev.legato(m, v, t)) voice = prev;
    }
    if (!voice) {
      const cut = def.mono || ch.cutSelf; // "cut itself": a new note silences the previous one
      if (cut) { const prev = this.mono.get(ch.id); if (prev && prev.choke) prev.choke(t); }
      if (ch.type === 'hat') for (const o of proj.channels) if (o.type === 'ohat') { const pv = this.mono.get(o.id); if (pv && pv.choke) pv.choke(t); }
      // choke groups: this channel silences every channel "cut by" its group (itself included)
      if (ch.cutGroup) for (const o of proj.channels) if (o.cutBy === ch.cutGroup) this.chokeChannel(o, t);
      // mono and portamento: one voice at a time, gliding from the previous pitch;
      // a portamento note glides from the previous note too, without making the channel mono
      let glide = null;
      const porta = x && x.porta, last = this.lastPitch.get(ch.id);
      if ((ch.porta > 0 || porta) && last != null) glide = { from: last, time: ch.porta > 0 ? ch.porta : 0.1 };
      if ((ch.mono || ch.porta > 0) && !(ch.cutGroup && ch.cutBy === ch.cutGroup)) this.chokeChannel(ch, t);
      this.lastPitch.set(ch.id, m);
      const bus = this.chan(ch).bus;
      if (x && x.pan) { out = this.c.createStereoPanner(); out.pan.value = clamp(x.pan, -1, 1); out.connect(bus); }
      const rec = track && dur != null ? [] : null;
      this.rec = rec;
      try { voice = fn(rec ? this.pc : this.c, out || bus, params, m, v, t, ch, glide); } catch (e) { console.warn(e); } finally { this.rec = null; }
      if (voice && cut) this.mono.set(ch.id, voice);
      if (voice && rec && rec.length) {
        let list = this.sounding.get(ch.id);
        if (!list) this.sounding.set(ch.id, list = []);
        for (let i = list.length - 1; i >= 0; i--) if (list[i].t1 < t - 2) list.splice(i, 1);
        list.push({ t0: t, t1: t + dur, nodes: rec, base: m, pitch: m, col: (x && x.col) | 0 });
      }
    }
    if (this.live) flashQueue.push({ id: ch.id, t });
    if (!voice) return null;
    // A legato voice is shared by several notes: each note gets a token that only stops it while it is the newest.
    if (def.legato) {
      const gen = voice.gen = (voice.gen || 0) + 1, tok = { stop: t2 => { if (voice.gen === gen) voice.stop(t2); } };
      if (dur != null) tok.stop(t + dur);
      return tok;
    }
    if (dur != null && voice.stop) voice.stop(t + dur);
    return voice;
  }
  // Slide note: the channel's voices of the same colour that are still sounding glide to its pitch, linearly in semitones.
  slide(ch, m, t, dur, col) {
    const list = this.sounding.get(ch.id);
    if (!list) return;
    for (const s of list) {
      if (s.t0 >= t || s.t1 <= t || s.col !== (col | 0)) continue;
      for (const n of s.nodes) {
        const d = n.detune;
        if (!d) continue;
        if (n._det0 == null) n._det0 = d.value;
        d.setValueAtTime(n._det0 + (s.pitch - s.base) * 100, t);
        d.linearRampToValueAtTime(n._det0 + (m - s.base) * 100, t + Math.max(0.001, dur));
      }
      s.pitch = m;
    }
  }
  noteOn(ch, m, v) {
    const voice = this.trigger(ch, m, v, this.c.currentTime + 0.004, null);
    if (voice && voice.stop) this.liveVoices.add(voice);
    return voice;
  }
  noteOff(voice) {
    if (voice && voice.stop) { voice.stop(this.c.currentTime + 0.004); this.liveVoices.delete(voice); }
  }
  panic() {
    const now = this.c.currentTime;
    for (const n of this.chans.values()) {
      const old = n.bus;
      old.gain.setTargetAtTime(0, now, 0.012);
      setTimeout(() => { try { old.disconnect(); } catch (e) { /* ignore */ } }, 150);
      n.bus = this.c.createGain();
      n.bus.connect(n.vol);
    }
    this.liveVoices.forEach(v => v.stop(now));
    this.liveVoices.clear();
    this.mono.clear();
    this.stopClips(now);
    this.strips.forEach(s => s.fx.forEach(f => f.reset && f.reset()));
  }
  // Silence everything a channel is playing from time t: its voices sit on a bus that fades out and is replaced.
  chokeChannel(ch, t) {
    const n = this.chans.get(ch.id);
    if (!n) return;
    const old = n.bus;
    old.gain.setValueAtTime(1, t);
    old.gain.setTargetAtTime(0, t, 0.003);
    if (this.live) setTimeout(() => { try { old.disconnect(); } catch (e) { /* ignore */ } }, Math.max(0, (t - this.c.currentTime) * 1000) + 150);
    n.bus = this.c.createGain();
    n.bus.connect(n.vol);
  }
  // Audio clips on the playlist play straight into their mixer track.
  // local: steps already played of the clip (it may start mid-way); sd: seconds per step, for the fades.
  playClip(c, smp, t, offset, dur, local = 0, sd = 0) {
    const src = this.c.createBufferSource(), g = this.c.createGain();
    src.buffer = smp.buffer;
    const gain = c.gain ?? 1, fin = c.fin || 0, fout = c.fout || 0;
    if (sd && (fin > 0 || fout > 0)) {
      const env = x => gain * (fin > 0 ? clamp(x / fin, 0, 1) : 1) * (fout > 0 ? clamp((c.l - x) / fout, 0, 1) : 1);
      g.gain.setValueAtTime(env(local), t);
      for (const x of [fin, c.l - fout, c.l].filter(k => k > local).sort((a, b) => a - b)) g.gain.linearRampToValueAtTime(env(x), t + (x - local) * sd);
    } else g.gain.value = gain;
    src.connect(g);
    g.connect((this.strips[c.mx | 0] || this.strips[0]).input);
    src.start(t, Math.max(0, offset), Math.max(0.001, dur));
    this.clipSources.add(src);
    src.onended = () => this.clipSources.delete(src);
  }
  stopClips(t) { this.clipSources.forEach(src => { try { src.stop(t); } catch (e) { /* not started */ } }); this.clipSources.clear(); }
  dispose() {
    if (this.loggerNode) { this.loggerNode.onaudioprocess = null; try { this.loggerNode.disconnect(); } catch (e) { /* ignore */ } }
    this.stopClips(0);
    this.strips.forEach(s => s.dispose());
    this.chans.forEach(n => { try { n.pan.disconnect(); } catch (e) { /* ignore */ } });
  }
}

/* ---------- Sequencer ---------- */
const _slides = new WeakMap();
const hasSlides = notes => { let r = _slides.get(notes); if (r == null) _slides.set(notes, r = notes.some(n => n.slide && !n.mu)); return r; };
function playSlice(eng, p, local, t, sd) {
  const swing = proj.swing * sd * 0.5;
  for (const ch of proj.channels) {
    const notes = expandNotes(p, ch);
    if (!notes || !notes.length || !audible(ch)) continue;
    const track = hasSlides(notes) && INSTRUMENTS[ch.type].group !== 'Batteria'; // drums are not bent by slides
    let slides = null;
    for (const n of notes) {
      if (n.mu) continue;
      const d = n.s - local;
      if (d < 0 || d >= 1) continue;
      let tt = t + d * sd;
      if (d === 0 && (local & 1)) tt += swing;
      if (n.slide) (slides = slides || []).push([n, tt]);
      else eng.trigger(ch, n.m, n.v, tt, n.l * sd, n, track);
    }
    // slides after the notes of the same step, so a note that starts just before a slide is bent too
    if (slides) for (const [n, tt] of slides) eng.slide(ch, n.m, tt, n.l * sd, n.col | 0);
  }
}
// jump: the playhead just started or wrapped here, so audio clips already under way start mid-way.
function scheduleStep(eng, s, t, sd, mode, patId, jump) {
  for (const st of eng.strips) for (const f of st.fx) if (f.step && f.slot.on) f.step(t, s, sd);
  if (mode === 'pattern') { const p = patById(patId); if (p) playSlice(eng, p, s, t, sd); return; }
  for (const c of proj.playlist.clips) {
    if (c.mu || s < c.s || s >= c.s + c.l) continue;
    if (trackMuted(c.t)) continue;
    if (c.a) { Automation.apply(eng, c, s, t, sd); continue; }
    if (c.smp) {
      if (s !== c.s && !jump) continue;
      const smp = clipSample(c);
      if (smp && smp.buffer) eng.playClip(c, smp, t, (s - c.s + (c.o || 0)) * sd, (c.s + c.l - s) * sd, s - c.s, sd);
      continue;
    }
    const p = patById(c.p);
    if (p) playSlice(eng, p, (s - c.s + (c.o || 0)) % patLen(p), t, sd);
  }
}

/* ---------- Automation clips: a curve on the playlist that moves one knob ---------- */
const Automation = {
  byId: id => proj.automation.find(a => a.id === id),
  valueAt(a, x) {
    const pts = a.points;
    if (x <= pts[0].s) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      if (x <= p1.s) return p1.s === p0.s ? p1.v : p0.v + (p1.v - p0.v) * (x - p0.s) / (p1.s - p0.s);
    }
    return pts[pts.length - 1].v;
  },
  // The parameter spec of a target, so the 0..1 curve maps to the knob's own range (log knobs stay log).
  spec(tg) {
    switch (tg.kind) {
      case 'chVol': return { min: 0, max: 1 };
      case 'chPan': case 'mixPan': return { min: -1, max: 1 };
      case 'mixVol': return { min: 0, max: 1.25 };
      case 'chParam': { const ch = chById(tg.ch); return ch && INSTRUMENTS[ch.type].params[tg.key]; }
      case 'fxParam': { const sl = proj.mixer[tg.ins] && proj.mixer[tg.ins].fx[tg.slot]; return sl && FXDEFS[sl.type] && FXDEFS[sl.type].params[tg.key]; }
    }
    return null;
  },
  fromNorm(spec, n) {
    n = clamp(n, 0, 1);
    let v = spec.log ? spec.min * Math.pow(spec.max / spec.min, n) : spec.min + n * (spec.max - spec.min);
    if (spec.step) v = Math.round(v / spec.step) * spec.step;
    return v;
  },
  toNorm(spec, v) { return clamp(spec.log ? Math.log(v / spec.min) / Math.log(spec.max / spec.min) : (v - spec.min) / (spec.max - spec.min), 0, 1); },
  // Writes the value into the project (the knob moves, as in any DAW) and schedules the sound change at time t.
  apply(eng, c, s, t, sd) {
    const a = this.byId(c.a);
    if (!a) return;
    const tg = a.target, spec = this.spec(tg);
    if (!spec || spec.select) return;
    const local = s - c.s + (c.o || 0);
    const subs = tg.kind === 'chParam' ? 1 : 4;
    for (let k = 0; k < subs; k++) {
      const v = this.fromNorm(spec, this.valueAt(a, local + k / subs));
      AT = { t: t + k * sd / subs };
      try {
        switch (tg.kind) {
          case 'chVol': case 'chPan': { const ch = chById(tg.ch); if (ch) { ch[tg.kind === 'chVol' ? 'vol' : 'pan'] = v; eng.updateChan(ch); } break; }
          case 'mixVol': case 'mixPan': { const tr = proj.mixer[tg.ins]; if (tr) { tr[tg.kind === 'mixVol' ? 'vol' : 'pan'] = v; eng.updateStrip(tg.ins); } break; }
          case 'chParam': { const ch = chById(tg.ch); if (ch) ch.params[tg.key] = v; break; }
          case 'fxParam': { const sl = proj.mixer[tg.ins].fx[tg.slot]; sl.params[tg.key] = v; eng.updateFx(tg.ins); break; }
        }
      } finally { AT = null; }
    }
    if (eng.live) Automation.moved = true;
  },
  moved: false,
};
function metronome(t, accent) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1760 : 1175;
  percEnv(g.gain, t, 0.18, 0.035, 0.001);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.06);
}

const Transport = {
  playing: false, step: 0, time: 0, timer: 0, q: [],
  play() {
    audioReady();
    if (this.playing) return;
    this.playing = true;
    this.step = ui.mode === 'song' ? (ui.songPos || songStart()) : 0;
    this.prev = null;
    this.pausing = null;
    this.time = actx.currentTime + 0.06;
    this.q = [];
    this.tick();
    this.timer = setInterval(() => this.tick(), 20);
    onTransportChange();
  },
  stop() {
    if (!this.playing) {
      if (ui.songPos) { ui.songPos = 0; onTransportChange(); }
      return;
    }
    this.playing = false;
    clearInterval(this.timer);
    this.q = [];
    if (engine) engine.panic();
    Rec.flush();
    onTransportChange();
  },
  toggle() { if (this.playing) this.stop(); else this.play(); },
  restart() { if (this.playing) { this.stop(); this.play(); } },
  // Pause marker reached: playback stops when the audio gets there, and the playhead stays on the marker.
  pauseAt(s, t) {
    const tok = this.pausing = {};
    clearInterval(this.timer);
    setTimeout(() => {
      if (this.pausing !== tok || !this.playing) return;
      this.pausing = null;
      this.stop();
      ui.songPos = s;
      onTransportChange();
      hint('Pausa al marcatore: premi Play per continuare');
    }, Math.max(0, (t - actx.currentTime) * 1000));
  },
  tick() {
    const now = actx.currentTime;
    if (this.time < now - 0.05) this.time = now + 0.02; // the tab was throttled: skip ahead instead of bursting
    const ahead = now + 0.12, song = ui.mode === 'song', seq = song ? seqInfo() : null;
    while (this.time < ahead && this.playing && !this.pausing) {
      const sd = 60 / proj.bpm / 4;
      const len = song ? seq.end : patLen(curPat());
      const loop = song && proj.loop, before = this.step;
      // marker actions happen where the playhead arrives, not where playback starts
      if (song && this.prev != null && this.prev === this.step - 1) {
        if (seq.pauses.includes(this.step)) { this.pauseAt(this.step, this.time); break; }
        const j = seq.jumps.find(k => k.at === this.step);
        if (j) this.step = j.to;
      }
      if (loop && (this.step >= loop.e || this.step < loop.s)) this.step = loop.s;
      else if (!loop && this.step >= len) this.step = song ? seq.wrap : this.step % len;
      let jump = !this.q.length;
      if (this.step !== before) { engine.stopClips(this.time); jump = true; }
      if (ui.metro) { const ba = barAt(this.step, ui.mode === 'song'), rel = this.step - ba.barStart; if (Math.abs(rel % ba.beatLen) < 1e-9) metronome(this.time, Math.abs(rel) < 1e-9); }
      scheduleStep(engine, this.step, this.time, sd, ui.mode, curPat().id, jump);
      this.q.push({ step: this.step, time: this.time, sd });
      this.prev = this.step;
      this.time += sd;
      this.step++;
    }
  },
  // Fractional step the listener is hearing right now, or null when stopped.
  position() {
    if (!this.playing || !this.q.length) return null;
    const ct = actx.currentTime - (actx.outputLatency || actx.baseLatency || 0);
    while (this.q.length > 1 && this.q[1].time <= ct) this.q.shift();
    const e = this.q[0];
    if (ct < e.time) return e.step;
    return e.step + Math.min(0.999, (ct - e.time) / e.sd);
  },
};

/* Live recording from the computer keyboard or MIDI into the current pattern */
const Rec = {
  open: new Map(),
  start(key, ch, m, v) {
    if (!ui.rec || ui.recMode === 'audio' || !Transport.playing || ui.mode !== 'pattern') return;
    const pos = Transport.position();
    if (pos != null) this.open.set(key, { chId: ch.id, m, v, s: pos, pat: curPat().id });
  },
  end(key) {
    const r = this.open.get(key);
    if (!r) return;
    this.open.delete(key);
    const p = patById(r.pat);
    if (!p || !chById(r.chId)) return;
    const L = patLen(p), q = ui.prSnap;
    let e = Transport.position();
    if (e == null) e = r.s + q;
    if (e < r.s) e += L;
    let s = Math.round(r.s / q) * q;
    if (s >= L) s -= L;
    const l = Math.max(q, Math.round((e - r.s) / q) * q);
    (p.notes[r.chId] = p.notes[r.chId] || []).push({ s, l, m: r.m, v: r.v });
    commit();
    afterNotesChanged();
  },
  flush() { for (const k of Array.from(this.open.keys())) this.end(k); },
};

/* ---------- Offline render and file encoders ---------- */
// tracks: mixer tracks to capture as separate stereo stems (post-fader), or null for the master mix.
// o.project: a stand-in project to render (same channels and mixer, its own playlist); o.mode / o.pattern: what to render;
// o.tail: false cuts the render exactly at the end of the music. Marker skips are followed; marker loops and pauses are not.
async function renderOffline(tracks = null, o = {}) {
  const real = proj, mode = o.mode || ui.mode, p = o.pattern ? patById(o.pattern) : curPat();
  proj = o.project || real;
  let order;
  try {
    const seq = seqInfo();
    const steps = mode === 'song' ? (o.project ? seq.end : songLen()) : patLen(p);
    if (!steps) throw new Error('La playlist è vuota: aggiungi un pattern alla playlist oppure passa alla modalità PAT.');
    order = [];
    for (let s = 0, prev = null; s < steps;) {
      if (mode === 'song' && prev === s - 1) { const j = seq.jumps.find(k => k.at === s && !k.loop); if (j) s = j.to; }
      if (s >= steps) break;
      order.push(s);
      prev = s++;
    }
  } finally { proj = real; }
  const sd = 60 / proj.bpm / 4, sr = 44100, music = order.length * sd;
  const saved = JSON.stringify({ channels: proj.channels, mixer: proj.mixer }); // automation clips write into the project while scheduling
  const nch = tracks ? tracks.length * 2 : 2;
  const oc = new OfflineAudioContext(nch, Math.ceil(sr * (music + 4)), sr);
  await loadWorklets(oc);
  let buf;
  try {
    const eng = new Engine(oc, false);
    if (tracks) {
      const merge = oc.createChannelMerger(nch);
      oc.destination.channelCount = nch;
      oc.destination.channelCountMode = 'explicit';
      oc.destination.channelInterpretation = 'discrete';
      eng.strips[0].out.disconnect();
      tracks.forEach((ti, k) => {
        const sp2 = oc.createChannelSplitter(2);
        eng.strips[ti].output.connect(sp2);
        sp2.connect(merge, 0, k * 2); sp2.connect(merge, 1, k * 2 + 1);
      });
      merge.connect(oc.destination);
    }
    proj = o.project || real;
    try { order.forEach((s, k) => scheduleStep(eng, s, 0.01 + k * sd, sd, mode, p.id, k === 0 || order[k - 1] !== s - 1)); } finally { proj = real; }
    buf = await oc.startRendering();
  } finally {
    // put back the knob values the automation clips moved while scheduling
    const back = JSON.parse(saved);
    proj.channels.forEach((ch, i) => { const o = back.channels[i]; if (o) { ch.vol = o.vol; ch.pan = o.pan; Object.assign(ch.params, o.params); } });
    proj.mixer.forEach((t, i) => {
      const o = back.mixer[i];
      if (!o) return;
      t.vol = o.vol; t.pan = o.pan;
      t.fx.forEach((sl, k) => { if (sl && o.fx[k]) Object.assign(sl.params, o.fx[k].params); });
    });
  }
  // trim the silent tail but keep the full musical length
  let last = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > 1e-4) { last = i; break; }
  }
  const frames = o.tail === false ? Math.min(buf.length, Math.round((music + 0.01) * sr)) : Math.min(buf.length, Math.max(Math.ceil((music + 0.01) * sr), last + Math.floor(sr * 0.05)));
  // the music starts 10 ms in (scheduling headroom): without a tail the clip must start right on the beat
  if (o.tail === false) {
    const skip = Math.round(0.01 * sr), out = new AudioBuffer({ length: Math.max(1, frames - skip), numberOfChannels: buf.numberOfChannels, sampleRate: sr });
    for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(skip, frames));
    return { buf: out, frames: out.length, seconds: out.length / sr };
  }
  return { buf, frames, seconds: frames / sr };
}

// bits: 16 or 24 (integer PCM) or 32 (float). chans: which channels of buf to write (stems come from one wide buffer).
function encodeWav(buf, frames = buf.length, bits = 16, chans = null) {
  return new Blob([wavArrayBuffer(buf, frames, bits, chans)], { type: 'audio/wav' });
}
function wavArrayBuffer(buf, frames = buf.length, bits = 16, chans = null) {
  const data = (chans || Array.from({ length: buf.numberOfChannels }, (_, i) => i)).map(i => buf.getChannelData(i));
  const nch = data.length, sr = buf.sampleRate, bps = bits / 8, bytes = frames * nch * bps, fmt = bits === 32 ? 3 : 1;
  const dv = new DataView(new ArrayBuffer(44 + bytes));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, fmt, true); dv.setUint16(22, nch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * nch * bps, true); dv.setUint16(32, nch * bps, true); dv.setUint16(34, bits, true);
  w(36, 'data'); dv.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      const x = data[c][i];
      if (bits === 32) dv.setFloat32(o, x, true);
      else {
        const s = clamp(x, -1, 1);
        if (bits === 24) { const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); dv.setUint8(o, v & 255); dv.setUint8(o + 1, (v >> 8) & 255); dv.setUint8(o + 2, (v >> 16) & 255); }
        else dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      o += bps;
    }
  }
  return dv.buffer;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
// A one-file ZIP archive (stored, not compressed): used where the host accepts .zip but not .wav.
// A ZIP archive (stored, not compressed) with several files: [{ name, u8 }]
function zipMany(files) {
  const parts = [], central = [], d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const f of files) {
    const nb = new TextEncoder().encode(f.name), crc = crc32(f.u8), size = f.u8.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, nb.length, true);
    parts.push(lh, nb, f.u8);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
    cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, nb.length, true); cd.setUint32(42, offset, true);
    central.push(cd, nb);
    offset += 30 + nb.length + size;
  }
  const cdSize = central.reduce((a, x) => a + x.byteLength, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
function zipOne(name, u8) {
  const nb = new TextEncoder().encode(name), crc = crc32(u8), size = u8.length, d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
  lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
  lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
  const cd = new DataView(new ArrayBuffer(46));
  cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
  cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
  cd.setUint32(20, size, true); cd.setUint32(24, size, true); cd.setUint16(28, nb.length, true);
  cd.setUint32(42, 0, true);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true);
  end.setUint32(12, 46 + nb.length, true); end.setUint32(16, 30 + nb.length + size, true);
  return new Blob([lh, nb, u8, cd, nb, end], { type: 'application/zip' });
}

// Inside a claude.ai viewer, files go through the downloads capability; a local copy uses a normal download.
const downloadsCap = (window.claude && typeof window.claude.use === 'function')
  ? window.claude.use('downloads').catch(() => null)
  : Promise.resolve(null);
async function saveFile(filename, blob) {
  const dl = await downloadsCap;
  if (dl) {
    let name = filename, data = blob;
    // The viewer only saves some file types: anything else (WAV, MIDI…) goes inside a .zip.
    if (!/\.(gif|png|jpe?g|webp|mp4|webm|mov|txt|json|md|docx|pptx|epub|csv|ttf|html|svg|pdf|xlsx|zip)$/i.test(name)) {
      data = zipOne(name, new Uint8Array(await blob.arrayBuffer()));
      name = name.replace(/\.[^.]+$/, '') + '.zip';
    }
    try { await dl.save({ filename: name, data }); toast('Salvato: ' + name); }
    catch (e) { if (!e || e.code !== 'declined') toast('Salvataggio non riuscito: ' + ((e && (e.message || e.code)) || e)); }
    return;
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Scaricato: ' + filename);
}
