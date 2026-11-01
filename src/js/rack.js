'use strict';
/* Ritmo Studio — Channel Rack: one row per instrument, a step sequencer per pattern */

// A channel shows step buttons while its notes fit the grid (whole steps, at most one step long); otherwise a mini piano-roll preview.
// Each step may have its own pitch and velocity, edited in the Graph Editor.
function isStepLike(notes, len) {
  if (!notes.length) return true;
  const seen = new Set();
  for (const n of notes) {
    if (!Number.isInteger(n.s) || n.s >= len || n.l > 1 || seen.has(n.s)) return false;
    seen.add(n.s);
  }
  return true;
}

function drawMiniRoll(cv, ch, p) {
  const L = patLen(p), w = Math.min(L, 64) * 25 - 3, hh = 26;
  const g = fitCanvas(cv, w, hh);
  g.clearRect(0, 0, w, hh);
  const notes = p.notes[ch.id] || [];
  if (!notes.length) return;
  let lo = 127, hi = 0;
  for (const n of notes) { lo = Math.min(lo, n.m); hi = Math.max(hi, n.m); }
  const span = Math.max(1, hi - lo), sx = w / L;
  for (let b = 1; b < L / spb(); b++) { g.fillStyle = TH.line; g.fillRect(Math.round(b * spb() * sx), 0, 1, hh); }
  g.fillStyle = ch.color;
  for (const n of notes) {
    const y = 3 + (1 - (n.m - lo) / span) * (hh - 8);
    g.globalAlpha = 0.5 + 0.5 * n.v;
    g.fillRect(n.s * sx + 1, y, Math.max(2, n.l * sx - 1), 2.5);
  }
  g.globalAlpha = 1;
}

const Rack = {
  paint: null,
  lastCol: -1,
  init() {
    const rows = $('#rack-rows');
    rows.addEventListener('pointerdown', e => this.down(e));
    rows.addEventListener('pointerover', e => this.over(e));
    rows.addEventListener('click', e => this.click(e));
    rows.addEventListener('contextmenu', e => this.context(e));
    document.addEventListener('pointerup', () => {
      if (!this.paint) return;
      this.paint = null;
      commit();
      afterNotesChanged('rack');
    });
    $('#rack-add').addEventListener('click', e => instrumentMenu(e.currentTarget));
    // Mixer track box: drag or scroll to pick the insert, as on a hardware spinner; click for the list.
    rows.addEventListener('wheel', e => {
      const box = e.target.closest('.ch-mix');
      if (!box) return;
      e.preventDefault();
      const ch = chById(box.closest('.ch-row').dataset.id);
      setChannelInsert(ch, clamp(ch.mixer - Math.sign(e.deltaY), 0, numInserts()));
      box.textContent = ch.mixer ? String(ch.mixer) : '—';
    }, { passive: false });
    rows.addEventListener('pointerdown', e => {
      const box = e.target.closest('.ch-mix');
      if (!box || e.button !== 0) return;
      const ch = chById(box.closest('.ch-row').dataset.id), y0 = e.clientY, v0 = ch.mixer;
      let moved = false;
      box.setPointerCapture(e.pointerId);
      const move = ev => {
        const d = Math.round((y0 - ev.clientY) / 6);
        if (!d && !moved) return;
        moved = true;
        setChannelInsert(ch, clamp(v0 + d, 0, numInserts()), true);
        box.textContent = ch.mixer ? String(ch.mixer) : '—';
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        if (moved) { commit(); box._dragged = true; setTimeout(() => { box._dragged = false; }); }
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });
    $('#rack-len').addEventListener('change', e => { curPat().len = +e.target.value; commit(); afterNotesChanged(); });
    const sw = knob({
      spec: { label: T('Swing'), min: 0, max: 1, def: 0, unit: '%' }, value: proj.swing, size: 24,
      onInput: v => { proj.swing = v; }, onCommit: commit,
    });
    $('#rack-swing').appendChild(sw);
    this.swingKnob = sw;
    const filter = $('#rack-filter');
    filter.appendChild(new Option(T('Tutti i canali'), ''));
    [...new Set(Object.values(INSTRUMENTS).map(d => d.group))].forEach(g => filter.appendChild(new Option(T(g), g)));
    filter.addEventListener('change', () => { ui.rackFilter = filter.value; this.render(); });
    $('#rack-graph').addEventListener('click', e => {
      ui.rackGraph = !ui.rackGraph;
      e.currentTarget.setAttribute('aria-pressed', String(ui.rackGraph));
      this.render();
      hint(ui.rackGraph ? T('Graph Editor: trascina sulle barre sotto il canale selezionato') : T('Graph Editor chiuso'));
    });
    $('#rack-graph-mode').addEventListener('change', e => { ui.rackGraphMode = e.target.value; this.render(); });
  },
  render() {
    const wrap = $('#rack-rows'), p = curPat();
    wrap.textContent = '';
    this.lastCol = -1;
    $('#rack-pat-name').textContent = '· ' + p.name;
    const lenSel = $('#rack-len');
    if (!Array.from(lenSel.options).some(o => +o.value === p.len)) lenSel.appendChild(new Option(String(p.len), p.len));
    lenSel.value = String(p.len);
    this.swingKnob.setValue(proj.swing);
    if (!proj.channels.length) {
      wrap.appendChild(h('div', 'rack-empty', T('Nessun canale. Aggiungi uno strumento dal browser a sinistra o con il pulsante Canale.')));
      return;
    }
    const filter = ui.rackFilter || '';
    for (const ch of proj.channels) {
      if (filter && INSTRUMENTS[ch.type].group !== filter) continue;
      const row = h('div', 'ch-row' + (ch.id === ui.selCh ? ' sel' : ''));
      row.dataset.id = ch.id;
      const led = h('button', 'ch-led' + (ch.solo ? ' solo' : (ch.mute ? '' : ' on')));
      led.type = 'button';
      led.dataset.act = 'mute';
      led.title = ch.mute ? T('Canale spento — clic: accendi/spegni, clic destro: solo') : T('Canale attivo — clic: accendi/spegni, clic destro: solo');
      led.setAttribute('aria-label', T('Attiva {0}', ch.name));
      led.setAttribute('aria-pressed', String(!ch.mute));
      const pan = knob({
        spec: { label: T('Panoramica {0}', ch.name), min: -1, max: 1, def: 0, unit: 'pan' }, value: ch.pan, size: 22,
        onInput: v => { ch.pan = v; engine && engine.updateChan(ch); }, onCommit: commit,
      });
      const vol = knob({
        spec: { label: T('Volume {0}', ch.name), min: 0, max: 1, def: 0.78, unit: '%' }, value: ch.vol, size: 22,
        onInput: v => { ch.vol = v; engine && engine.updateChan(ch); }, onCommit: commit,
      });
      const mix = h('button', 'ch-mix', ch.mixer ? String(ch.mixer) : '—');
      mix.type = 'button';
      mix.dataset.act = 'mixer';
      mix.title = T('Traccia del mixer: {0} — trascina o usa la rotella per cambiarla, clic per l\'elenco', mixerName(ch.mixer));
      const name = h('button', 'ch-name');
      name.type = 'button';
      name.dataset.act = 'name';
      name.style.setProperty('--c', ch.color);
      name.append(h('span', 'dot'), h('span', 'nm', ch.name));
      name.title = T('{0} — clic: impostazioni, clic destro: menu', INSTRUMENTS[ch.type].label);
      const act = h('span', 'ch-act');
      act.dataset.flash = ch.id;
      act.dataset.act = 'select';
      act.title = T('Seleziona il canale');
      row.append(led, pan, vol, mix, name, act);
      const notes = p.notes[ch.id] || [];
      if (isStepLike(notes, p.len)) {
        const st = h('div', 'steps');
        for (let i = 0; i < p.len; i++) {
          const b = h('button', 'step' + ((i >> 2) & 1 ? ' alt' : ''));
          b.type = 'button';
          b.dataset.ch = ch.id;
          b.dataset.i = i;
          b.tabIndex = -1;
          this.styleStep(b, ch, notes.find(n => n.s === i));
          st.appendChild(b);
        }
        row.appendChild(st);
      } else {
        const cv = h('canvas', 'mini-roll');
        cv.dataset.act = 'roll';
        cv.title = T('Note nel Piano Roll — clic per aprire');
        row.appendChild(cv);
        drawMiniRoll(cv, ch, p);
      }
      wrap.appendChild(row);
      if (ui.rackGraph && ch.id === ui.selCh && row.querySelector('.steps')) wrap.appendChild(this.graphRow(ch, p, row));
    }
  },
  // Graph Editor: one bar per step for velocity or pitch (semitones from the channel's step note).
  graphRow(ch, p, row) {
    const g = h('div', 'graph-row'), cv = h('canvas', 'graph-cv');
    g.appendChild(cv);
    const mode = ui.rackGraphMode || 'vel', H = 54;
    const layout = () => {
      const steps = row.querySelector('.steps');
      if (!steps) return null;
      const btns = $$('.step', steps);
      cv.style.marginLeft = (steps.offsetLeft + 4) + 'px';
      return { W: steps.scrollWidth - 4, xs: btns.map(b => b.offsetLeft - steps.offsetLeft - 4 + b.offsetWidth / 2), bw: btns[0] ? btns[0].offsetWidth : 16 };
    };
    const draw = () => {
      const L = layout();
      if (!L) return;
      const gg = fitCanvas(cv, L.W, H), notes = p.notes[ch.id] || [];
      gg.fillStyle = TH.lcd;
      gg.fillRect(0, 0, L.W, H);
      gg.fillStyle = TH.lineSoft;
      gg.fillRect(0, mode === 'pitch' ? H / 2 : H - 1, L.W, 1);
      L.xs.forEach((x, i) => {
        const n = notes.find(k => k.s === i);
        if (!n) return;
        gg.fillStyle = ch.color;
        if (mode === 'vel') { const hh = n.v * (H - 6); gg.fillRect(x - L.bw / 2 + 2, H - hh, L.bw - 4, hh); }
        else { const d = clamp(n.m - ch.root, -12, 12), y = H / 2 - d / 12 * (H / 2 - 3); gg.fillRect(x - L.bw / 2 + 2, Math.min(y, H / 2), L.bw - 4, Math.max(2, Math.abs(y - H / 2))); }
      });
      gg.fillStyle = TH.faint;
      gg.font = '600 9px ' + TH.label;
      gg.fillText(mode === 'vel' ? T('VELOCITÀ') : T('INTONAZIONE'), 4, 10);
    };
    let dragging = false;
    const edit = e => {
      const L = layout(), r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = clamp(e.clientY - r.top, 0, H);
      let best = -1, bd = 1e9;
      L.xs.forEach((sx, i) => { const d = Math.abs(sx - x); if (d < bd) { bd = d; best = i; } });
      const n = (p.notes[ch.id] || []).find(k => k.s === best);
      if (!n || bd > L.bw) return;
      if (mode === 'vel') { n.v = clamp(1 - y / (H - 2), 0.05, 1); hint(T('Passo {0}: velocità {1}%', best + 1, Math.round(n.v * 100))); }
      else { n.m = ch.root + Math.round((H / 2 - y) / (H / 2 - 3) * 12); hint(T('Passo {0}: {1}', best + 1, noteName(n.m))); }
      draw();
    };
    cv.addEventListener('pointerdown', e => { dragging = true; cv.setPointerCapture(e.pointerId); edit(e); });
    cv.addEventListener('pointermove', e => { if (dragging) edit(e); });
    const end = () => { if (!dragging) return; dragging = false; commit(); afterNotesChanged(); };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    requestAnimationFrame(draw);
    return g;
  },
  styleStep(b, ch, n) {
    b.classList.toggle('on', !!n);
    b.style.opacity = n ? String(0.55 + 0.45 * n.v) : '';
    b.setAttribute('aria-pressed', String(!!n));
    b.setAttribute('aria-label', T('{0}, passo {1}', ch.name, +b.dataset.i + 1));
  },
  setStep(ch, i, on) {
    const p = curPat(), arr = p.notes[ch.id] || (p.notes[ch.id] = []);
    const idx = arr.findIndex(n => n.s === i);
    if (on && idx < 0) arr.push({ s: i, l: 1, m: ch.root, v: 0.8 });
    else if (!on && idx >= 0) arr.splice(idx, 1);
    if (!arr.length) delete p.notes[ch.id];
    const b = document.querySelector(`.step[data-ch="${ch.id}"][data-i="${i}"]`);
    if (b) this.styleStep(b, ch, (p.notes[ch.id] || []).find(n => n.s === i));
  },
  down(e) {
    const step = e.target.closest('.step');
    if (!step || (e.button !== 0 && e.button !== 2)) return;
    e.preventDefault();
    const ch = chById(step.dataset.ch), i = +step.dataset.i;
    const has = (curPat().notes[ch.id] || []).some(n => n.s === i);
    const on = e.button === 2 ? false : !has;
    this.paint = { on };
    this.setStep(ch, i, on);
    if (on && !Transport.playing) {
      audioReady();
      const first = (curPat().notes[ch.id] || [])[0];
      engine.trigger(ch, first ? first.m : ch.root, 0.8, actx.currentTime + 0.005, 0.15);
    }
    if (ui.selCh !== ch.id) this.select(ch.id);
  },
  over(e) {
    if (!this.paint) return;
    const step = e.target.closest('.step');
    if (step) this.setStep(chById(step.dataset.ch), +step.dataset.i, this.paint.on);
  },
  click(e) {
    const row = e.target.closest('.ch-row');
    if (!row || e.target.closest('.step') || e.target.closest('.knob')) return;
    const ch = chById(row.dataset.id), a = e.target.closest('[data-act]');
    if (!a) { this.select(ch.id); return; }
    switch (a.dataset.act) {
      case 'mute':
        ch.mute = !ch.mute;
        if (!ch.mute && anySolo() && !ch.solo) ch.solo = true;
        engine && engine.updateAllChans();
        commit();
        this.render();
        break;
      case 'mixer': if (!a._dragged) mixerRouteMenu(a, ch); break;
      case 'select': this.select(ch.id); break;
      case 'name': this.select(ch.id); openEditor(ch.id); break;
      case 'roll': this.select(ch.id); WM.open('piano'); break;
    }
  },
  context(e) {
    e.preventDefault();
    const row = e.target.closest('.ch-row');
    if (!row || e.target.closest('.step') || e.target.closest('.knob')) return;
    const ch = chById(row.dataset.id), a = e.target.closest('[data-act]');
    if (a && a.dataset.act === 'mute') {
      const solo = !ch.solo;
      proj.channels.forEach(c => { c.solo = false; });
      ch.solo = solo;
      if (solo) ch.mute = false;
      engine && engine.updateAllChans();
      commit();
      this.render();
      hint(solo ? T('Solo: {0}', ch.name) : T('Solo disattivato'));
      return;
    }
    channelMenu(ch, e.clientX, e.clientY);
  },
  select(id) {
    ui.selCh = id;
    if (ui.rackGraph) this.render();
    else $$('.ch-row').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
    PR.sel.clear();
    PR.refreshToolbar();
    PR.draw();
    Tree.render();
    const ch = chById(id);
    if (ch) hint(T('Canale selezionato: {0} — la tastiera del computer suona questo strumento', ch.name));
  },
  // Light the step column under the playhead while a pattern plays.
  showColumn(col) {
    if (col === this.lastCol) return;
    if (this.lastCol >= 0) $$(`.step.now`).forEach(b => b.classList.remove('now'));
    this.lastCol = col;
    if (col >= 0) $$(`.step[data-i="${col}"]`).forEach(b => b.classList.add('now'));
  },
};

// Right-click menu of a channel: channel commands on the left, step commands on the right.
let chanClipboard = null;
function channelMenu(ch, x, y) {
  const idx = proj.channels.indexOf(ch), p = curPat(), notes = p.notes[ch.id] || [];
  const instList = fn => {
    const items = [];
    let group = '';
    for (const [type, def] of Object.entries(INSTRUMENTS)) {
      if (def.hidden || type === 'sampler') continue;
      if (def.group !== group) { group = def.group; items.push({ title: T(group) }); }
      items.push({ label: def.label, checked: fn === 'replace' && ch.type === type, action: () => (fn === 'insert' ? insertChannelAfter(ch, type) : replaceChannel(ch, type)) });
    }
    return items;
  };
  const rename = () => { const b = $(`.ch-row[data-id="${ch.id}"] .ch-name`); inlineEdit(b || $('#rack-rows'), ch.name, v => { ch.name = v; commit(); renderAll(); }); };
  openMenu(x, y, [
    { label: T('Piano roll'), checked: !isStepLike(notes, p.len), action: () => { Rack.select(ch.id); WM.open('piano'); } },
    { label: T('Graph editor'), checked: !!ui.rackGraph && ui.selCh === ch.id, action: () => { ui.rackGraph = true; $('#rack-graph').setAttribute('aria-pressed', 'true'); Rack.select(ch.id); Rack.render(); } },
    '-',
    { label: T('Rinomina, colore e icona…'), action: rename },
    { label: T('Cambia colore…'), sub: COLORS.map((c, i) => ({ label: T('Colore {0}', i + 1), color: c, checked: ch.color === c, action: () => { ch.color = c; commit(); renderAll(); } })) },
    '-',
    { label: T('Carica campione…'), action: () => { if (ch.type !== 'sampler') replaceChannel(ch, 'sampler', true); pickAudioFiles(ch); } },
    { label: T('Taglia se stesso'), checked: !!ch.cutSelf || !!INSTRUMENTS[ch.type].mono, disabled: !!INSTRUMENTS[ch.type].mono, action: () => { ch.cutSelf = !ch.cutSelf; commit(); hint(ch.cutSelf ? T('{0}: ogni nota interrompe la precedente', ch.name) : T('{0}: le note si sovrappongono', ch.name)); } },
    '-',
    { label: T('Inserisci'), sub: instList('insert') },
    { label: T('Sostituisci'), sub: instList('replace') },
    { label: T('Clona'), action: () => cloneChannel(ch) },
    { label: T('Elimina…'), danger: true, action: () => deleteChannel(ch) },
    '-',
    { label: T('Assegna a un nuovo insert del mixer'), action: () => assignNewInsert(ch) },
    { label: T('Sposta su'), key: 'Alt+↑', disabled: idx === 0, action: () => moveChannel(ch, -1) },
    { label: T('Sposta giù'), key: 'Alt+↓', disabled: idx === proj.channels.length - 1, action: () => moveChannel(ch, 1) },
    { col: true },
    { label: T('Taglia||appunti'), action: () => { chanClipboard = JSON.parse(JSON.stringify(notes)); clearChannel(ch); } },
    { label: T('Copia'), action: () => { chanClipboard = JSON.parse(JSON.stringify(notes)); hint(T('Copiate {0} note di {1}', notes.length, ch.name)); } },
    { label: T('Incolla'), disabled: !chanClipboard, action: () => { p.notes[ch.id] = JSON.parse(JSON.stringify(chanClipboard)); commit(); afterNotesChanged(); } },
    '-',
    { label: T('Riempi ogni passo'), action: () => fillSteps(ch, 1) },
    { label: T('Riempi ogni 2 passi'), action: () => fillSteps(ch, 2) },
    { label: T('Riempi ogni 4 passi'), action: () => fillSteps(ch, 4) },
    { label: T('Riempi ogni 8 passi'), action: () => fillSteps(ch, 8) },
    { label: T('Svuota'), action: () => clearChannel(ch) },
    '-',
    { label: T('Ruota a sinistra'), key: T('Maiusc+Ctrl+←'), disabled: !notes.length, action: () => rotateChannel(ch, -1) },
    { label: T('Ruota a destra'), key: T('Maiusc+Ctrl+→'), disabled: !notes.length, action: () => rotateChannel(ch, 1) },
    '-',
    { label: T('Muto'), checked: ch.mute, action: () => { ch.mute = !ch.mute; engine && engine.updateAllChans(); commit(); Rack.render(); } },
    { label: T('Solo'), checked: ch.solo, action: () => { const on = !ch.solo; proj.channels.forEach(c => { c.solo = false; }); ch.solo = on; if (on) ch.mute = false; engine && engine.updateAllChans(); commit(); Rack.render(); } },
    { label: T('Impostazioni strumento…'), action: () => openEditor(ch.id) },
    { label: T('Crea clip di automazione'), sub: automationTargetsFor(ch) },
    '-',
    { label: T('Salva preset del canale'), action: () => saveChannelPreset(ch) },
    { label: T('Carica preset'), disabled: !Presets.of('channel').length, sub: Presets.of('channel').map(pr => ({ label: pr.name, action: async () => Presets.applyChannel(await Presets.read('channel', pr.name), ch, pr.name) })) },
  ]);
}
function insertChannelAfter(ch, type) {
  const c = addChannel(type, {}, true);
  proj.channels.splice(proj.channels.indexOf(c), 1);
  proj.channels.splice(proj.channels.indexOf(ch) + 1, 0, c);
  commit();
  renderAll();
}
// Swap the instrument of a channel, keeping its notes, mixer track and colour.
function replaceChannel(ch, type, quiet) {
  const def = INSTRUMENTS[type];
  if (ch.name === INSTRUMENTS[ch.type].label) ch.name = def.label;
  ch.type = type;
  ch.params = defaults(def.params);
  delete ch.plugin;
  delete ch.state;
  engine && engine.updateChan(ch);
  if (quiet) return;
  commit();
  renderAll();
}
function setChannelInsert(ch, i, quiet) {
  if (ch.mixer === i) return;
  ch.mixer = i;
  engine && engine.updateChan(ch);
  if (WM.isOpen('mixer')) Mixer.render();
  hint(ch.name + ' → ' + mixerName(i));
  if (!quiet) commit();
}
function assignNewInsert(ch) {
  const i = freeInsert();
  if (!i) { toast(T('Tutti gli insert del mixer sono già usati')); return; }
  proj.mixer[i].name = ch.name;
  setChannelInsert(ch, i);
  renderAll();
}
function rotateChannel(ch, d) {
  const p = curPat(), L = patLen(p);
  (p.notes[ch.id] || []).forEach(n => { n.s = ((n.s + d) % L + L) % L; });
  commit();
  afterNotesChanged();
}

function mixerRouteMenu(anchor, ch) {
  const used = new Set(proj.channels.map(c => c.mixer));
  const items = [{ title: T('Traccia del mixer di {0}', ch.name) }, { label: T('Master'), checked: ch.mixer === 0, action: () => { setChannelInsert(ch, 0); renderAll(); } }];
  const free = freeInsert();
  if (free) items.push({ label: T('Primo insert libero ({0})', free), action: () => assignNewInsert(ch) });
  items.push('-');
  for (let i = 1; i <= numInserts(); i++) {
    if (!used.has(i) && i !== free && i > 24) continue;
    items.push({ label: i + ' · ' + proj.mixer[i].name, checked: ch.mixer === i, action: () => { setChannelInsert(ch, i); renderAll(); } });
  }
  menuAt(anchor, items);
}

function instrumentMenu(anchor) {
  const items = [];
  let group = '';
  for (const [type, def] of Object.entries(INSTRUMENTS)) {
    if (def.hidden) continue;
    if (def.group !== group) { group = def.group; items.push({ title: T(group) }); }
    items.push({ label: def.label, action: () => (type === 'sampler' ? pickAudioFiles() : addChannel(type, {}, true)) });
  }
  menuAt(anchor, items);
}
