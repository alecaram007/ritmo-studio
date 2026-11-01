(() => {
  // Offer the visitor's own language with a bar (never a redirect, so search engines see every page as it is).
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  const data = JSON.parse((document.getElementById('langs-data') || {}).textContent || '{}');
  document.querySelectorAll('.langs a, .foot-langs a').forEach(a => a.addEventListener('click', () => store('ritmo-lang', a.hreflang.toLowerCase())));
  if (data.pages && !store('ritmo-lang')) {
    const alias = { 'zh-hk': 'zh-tw', 'zh-mo': 'zh-tw', 'zh-hant': 'zh-tw', 'zh-sg': 'zh-cn', 'zh-hans': 'zh-cn', zh: 'zh-cn', iw: 'he' };
    let want = '';
    for (const l of navigator.languages || [navigator.language || '']) {
      const full = l.toLowerCase(), primary = full.split('-')[0];
      if (primary === 'zh') { want = /hant|-tw|-hk|-mo/.test(full) ? 'zh-tw' : 'zh-cn'; break; }
      want = [full, alias[full], primary, alias[primary]].find(c => c && data.pages[c]) || '';
      if (want) break;
    }
    const bar = document.getElementById('suggest');
    if (want && want !== data.current && bar) {
      const [href, text, go] = data.pages[want];
      const lang = want.replace(/-(\w+)$/, (m, r) => '-' + r.toUpperCase());
      document.getElementById('suggest-text').textContent = text;
      const link = document.getElementById('suggest-link');
      link.href = href; link.textContent = go; link.hreflang = lang;
      bar.lang = lang;
      bar.dir = ['ar', 'he'].includes(want) ? 'rtl' : 'ltr';
      link.addEventListener('click', () => store('ritmo-lang', want));
      document.getElementById('suggest-close').addEventListener('click', () => { bar.hidden = true; store('ritmo-lang', data.current); });
      bar.hidden = false;
    }
  }

  // The language menu closes on a click elsewhere or on Escape.
  const menu = document.querySelector('.langs');
  if (menu) {
    document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); } });
  }

  // Point the main download button at the visitor's system and highlight its card.
  const ua = navigator.userAgent;
  const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const touchMac = /Mac/i.test(plat) && navigator.maxTouchPoints > 1;
  let os = '';
  if (/Android|iPhone|iPad|iPod/i.test(ua) || touchMac) os = 'mobile';
  else if (/Win/i.test(plat) || /Windows/i.test(ua)) os = 'win';
  else if (/Mac/i.test(plat)) os = 'mac';
  else if (/Linux|X11|CrOS/i.test(plat + ua)) os = 'linux';
  const main = document.getElementById('dl-main');
  if (os && main && main.dataset[os + 'Href']) {
    main.href = main.dataset[os + 'Href'];
    main.querySelector('span').textContent = main.dataset[os + 'Label'];
    const card = document.getElementById('dl-' + os);
    if (card) card.classList.add('mine');
  }

  // The little step sequencer in the hero: the drum pattern of the demo song, playable and editable.
  const seq = document.getElementById('seq');
  const play = document.getElementById('seq-play');
  if (!seq || !play || !(window.AudioContext || window.webkitAudioContext)) return;
  const rows = [...seq.querySelectorAll('.seq-row')].map(r => ({ voice: r.dataset.voice, steps: [...r.querySelectorAll('.st')] }));
  seq.addEventListener('click', e => {
    const b = e.target.closest('.st');
    if (!b) return;
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on);
    if (on && ctx) hit(rows.find(r => r.steps.includes(b)).voice, ctx.currentTime + 0.01, 0.8);
  });

  let ctx, out, noise, timer, step = 0, next = 0, raf;
  const queue = [];
  const stepDur = 60 / +seq.dataset.bpm / 4;

  function setup() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    out = ctx.createDynamicsCompressor();
    const g = ctx.createGain();
    g.gain.value = 0.7;
    out.connect(g).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function env(t, peak, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(out);
    return g;
  }
  function burst(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur);
    return s;
  }
  function hit(voice, t, v) {
    if (voice === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      o.connect(env(t, v, 0.42));
      o.start(t); o.stop(t + 0.45);
    } else if (voice === 'clap') {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.9;
      f.connect(env(t, v * 0.9, 0.22));
      [0, 0.012, 0.024].forEach(o => burst(t + o, 0.2).connect(f));
    } else {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = 7200;
      f.connect(env(t, v * 0.42, voice === 'ohat' ? 0.28 : 0.05));
      burst(t, 0.3).connect(f);
    }
  }
  function schedule() {
    while (next < ctx.currentTime + 0.12) {
      rows.forEach(r => { if (r.steps[step].getAttribute('aria-pressed') === 'true') hit(r.voice, next, step % 4 ? 0.62 : 0.9); });
      queue.push({ step, t: next });
      step = (step + 1) % 16;
      next += stepDur;
    }
  }
  let shown = -1;
  function draw() {
    while (queue.length && queue[0].t <= ctx.currentTime) {
      const s = queue.shift().step;
      if (shown >= 0) rows.forEach(r => r.steps[shown].classList.remove('now'));
      rows.forEach(r => r.steps[s].classList.add('now'));
      shown = s;
    }
    raf = requestAnimationFrame(draw);
  }
  function stop() {
    clearInterval(timer); cancelAnimationFrame(raf); queue.length = 0;
    if (shown >= 0) rows.forEach(r => r.steps[shown].classList.remove('now'));
    shown = -1;
    play.setAttribute('aria-pressed', 'false');
    play.querySelector('span').textContent = play.dataset.play;
  }
  play.addEventListener('click', async () => {
    if (play.getAttribute('aria-pressed') === 'true') return stop();
    if (!ctx) setup();
    await ctx.resume();
    step = 0; next = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 25); schedule(); draw();
    play.setAttribute('aria-pressed', 'true');
    play.querySelector('span').textContent = play.dataset.stop;
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && play.getAttribute('aria-pressed') === 'true') stop(); });
})();
