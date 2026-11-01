'use strict';
/* Ritmo Studio — Mixer: master plus 125 insert tracks in narrow strips, and a side panel for the selected track
   with ten effect slots, a 3-band EQ, stereo tools, output routing and sends. Effects open in their own window. */

const SVG_ARROW = '<svg viewBox="0 0 12 9" fill="currentColor"><path d="M6 0 12 9H0z"/></svg>';
const SVG_PHASE = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="6" r="4"/><path d="M2 10 10 2"/></svg>';
const SVG_SWAP = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 4h8l-2-2M10.5 8h-8l2 2"/></svg>';
const SVG_PLUG = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 1.5h1.4v3H5zM9.6 1.5H11v3H9.6zM3.5 4.5h9v3.2a4.5 4.5 0 0 1-3.6 4.4v2.4H7.1v-2.4a4.5 4.5 0 0 1-3.6-4.4z"/></svg>';
const SVG_OUT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h9M8 4.5 11.5 8 8 11.5M13.5 3v10"/></svg>';

const insName = i => (i === 0 ? T('Master') : T('Insert {0}', i) + (proj.mixer[i].name !== T('Insert {0}', i) && proj.mixer[i].name !== 'Insert ' + i ? ' · ' + proj.mixer[i].name : ''));
// A track is "used" when something reaches it: a channel, an audio clip, or another used track routed into it.
function usedTracks() {
  const used = new Set([0]);
  proj.channels.forEach(c => used.add(c.mixer));
  proj.playlist.clips.forEach(c => { if (c.smp) used.add(c.mx | 0); });
  let grew = true;
  while (grew) {
    grew = false;
    proj.mixer.forEach((t, i) => {
      if (!used.has(i)) return;
      for (const j of mixerEdges(i)) if (!used.has(j)) { used.add(j); grew = true; }
    });
  }
  return used;
}
const canRoute = (from, to) => from !== to && to >= 0 && !reaches(to, from);

const Mixer = {
  meters: [],
  init() {
    const wrap = $('#mx-strips');
    wrap.addEventListener('pointerdown', e => {
      const s = e.target.closest('.strip');
      if (s && +s.dataset.i !== ui.selMix && !e.target.closest('.route-btn, .knob')) this.select(+s.dataset.i);
    });
    wrap.addEventListener('dblclick', e => {
      const nm = e.target.closest('.strip-name');
      if (!nm) return;
      const i = +nm.closest('.strip').dataset.i, t = proj.mixer[i];
      inlineEdit(nm, t.name, v => { t.name = v; commit(); this.render(); Rack.render(); });
    });
    wrap.addEventListener('contextmenu', e => {
      const s = e.target.closest('.strip');
      if (!s || e.target.closest('.knob, .fader, .route-btn')) return;
      e.preventDefault();
      this.trackMenu(+s.dataset.i, e.clientX, e.clientY);
    });
    wrap.addEventListener('scroll', () => this.drawMeters(true));
    $('#mx-wide').addEventListener('click', e => {
      ui.mxWide = !ui.mxWide;
      e.currentTarget.setAttribute('aria-pressed', String(ui.mxWide));
      savePrefs();
      this.render();
    });
  },
  select(i) {
    ui.selMix = i;
    this.render();
  },
  render() {
    if (!WM.isOpen('mixer')) return;
    const keep = $('#mx-strips').scrollLeft;
    this.renderStrips();
    $('#mx-strips').scrollLeft = keep;
    this.renderSide();
    if (WM.isOpen('fx')) this.renderFxWin();
    this.drawMeters(true);
  },
  renderStrips() {
    const wrap = $('#mx-strips'), sel = ui.selMix, st = proj.mixer[sel], used = usedTracks(), wide = !!ui.mxWide;
    wrap.textContent = '';
    $('#mx-wide').setAttribute('aria-pressed', String(wide));
    $('#mx-title').textContent = '- ' + insName(sel);
    this.meters = [];
    proj.mixer.forEach((t, i) => {
      const s = h('div', 'strip' + (i === 0 ? ' master' : '') + (sel === i ? ' sel' : '') + (used.has(i) ? ' used' : ''));
      s.dataset.i = i;
      if (wide) s.style.width = (i === 0 ? 64 : 58) + 'px';
      const name = h('span', 'strip-name', i === 0 ? T('Master') : t.name);
      name.title = T('{0} — doppio clic per rinominare, clic destro per il menu', insName(i));
      const mute = h('button', 'strip-mute' + (t.mute ? '' : ' on'));
      mute.type = 'button';
      mute.title = t.mute ? T('Traccia muta — clic per attivare') : T('Traccia attiva — clic per silenziare');
      mute.setAttribute('aria-label', T('Attiva {0}', insName(i)));
      mute.setAttribute('aria-pressed', String(!t.mute));
      mute.addEventListener('click', () => { t.mute = !t.mute; engine && engine.updateStrip(i); commit(); this.render(); });
      const pan = knob({
        spec: { label: T('Panoramica {0}', insName(i)), min: -1, max: 1, def: 0, unit: 'pan' }, value: t.pan, size: 26,
        onInput: v => { t.pan = v; engine && engine.updateStrip(i); }, onCommit: commit,
        auto: { kind: 'mixPan', ins: i }, bind: () => proj.mixer[i] && proj.mixer[i].pan,
      });
      const flags = h('div', 'strip-flags');
      const flag = (key, svg, label) => {
        const b = h('button', 'strip-flag' + (t[key] ? ' on' : ''));
        b.type = 'button';
        b.innerHTML = svg;
        b.title = label;
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', String(!!t[key]));
        b.addEventListener('click', () => { t[key] = !t[key]; engine && engine.updateStrip(i); commit(); this.render(); });
        flags.appendChild(b);
      };
      flag('phase', SVG_PHASE, T('Inverti la fase'));
      flag('swap', SVG_SWAP, T('Scambia sinistra e destra'));
      const meter = h('canvas', 'strip-meter');
      if (wide) meter.style.width = '10px';
      this.meters[i] = meter;
      const f = fader({
        value: t.vol, max: 1.25, def: i === 0 ? 0.9 : 0.8, label: T('Volume {0}', insName(i)),
        onInput: v => { t.vol = v; engine && engine.updateStrip(i); if (i === 0) masterKnob.setValue(v); },
        onCommit: commit, auto: { kind: 'mixVol', ins: i }, bind: () => proj.mixer[i] && proj.mixer[i].vol,
      });
      const body = h('div', 'strip-body');
      body.append(meter, f);
      s.append(h('span', 'strip-num', i === 0 ? 'M' : String(i)), name, mute, pan, flags, body, this.routeCell(i, sel, st));
      wrap.appendChild(s);
    });
  },
  // Bottom of each strip: the arrow says where the selected track goes (orange: main output, green: send).
  routeCell(i, sel, st) {
    const cell = h('div', 'strip-route');
    if (i === sel) return cell;
    const isOut = sel !== 0 && (st.out | 0) === i, send = st.sends.find(x => x.to === i);
    if (send) {
      cell.appendChild(knob({
        spec: { label: T('Mandata da {0} a {1}', insName(sel), insName(i)), min: 0, max: 1.25, def: 1, unit: '%' }, value: send.lv, size: 18,
        onInput: v => { send.lv = v; engine && engine.updateStrip(sel); }, onCommit: commit,
      }));
    }
    const b = h('button', 'route-btn' + (isOut ? ' out' : send ? ' send' : ''));
    b.type = 'button';
    b.innerHTML = SVG_ARROW;
    const ok = sel !== 0 && (isOut || send || canRoute(sel, i));
    b.disabled = !ok;
    b.title = sel === 0 ? T('Il Master va all\'uscita audio')
      : isOut ? T('{0} esce qui (uscita principale). Clic: torna al Master', insName(sel))
        : send ? T('Mandata da {0} — clic: rimuovi', insName(sel))
          : ok ? T('Clic: manda {0} anche qui · clic destro: instrada solo qui', insName(sel)) : T('Instradamento impossibile: creerebbe un anello');
    b.addEventListener('click', () => this.toggleRoute(sel, i));
    b.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (!ok) return;
      openMenu(e.clientX, e.clientY, [
        { title: insName(sel) + ' → ' + insName(i) },
        { label: T('Instrada solo qui (uscita principale)'), checked: isOut, action: () => this.setOut(sel, i) },
        { label: send ? T('Rimuovi la mandata') : T('Aggiungi una mandata'), disabled: isOut, action: () => this.toggleRoute(sel, i) },
      ]);
    });
    cell.appendChild(b);
    return cell;
  },
  setOut(from, to) {
    const t = proj.mixer[from];
    if (!canRoute(from, to) && (t.out | 0) !== to) return;
    t.out = to;
    t.sends = t.sends.filter(x => x.to !== to);
    this.routesChanged();
  },
  toggleRoute(from, to) {
    const t = proj.mixer[from];
    if (from === 0) return;
    if ((t.out | 0) === to) { if (to !== 0) t.out = 0; }
    else if (t.sends.some(x => x.to === to)) t.sends = t.sends.filter(x => x.to !== to);
    else if (canRoute(from, to)) t.sends.push({ to, lv: 1 });
    this.routesChanged();
  },
  routesChanged() {
    engine && engine.routes && engine.routes();
    commit();
    this.render();
  },
  trackMenu(i, x, y) {
    const t = proj.mixer[i], ins = proj.channels.filter(c => c.mixer === i);
    openMenu(x, y, [
      { title: insName(i) },
      { label: T('Rinomina…'), action: () => { const nm = $(`.strip[data-i="${i}"] .strip-name`); inlineEdit(nm, t.name, v => { t.name = v; commit(); this.render(); Rack.render(); }); } },
      { label: t.mute ? T('Attiva') : T('Silenzia'), action: () => { t.mute = !t.mute; engine && engine.updateStrip(i); commit(); this.render(); } },
      { label: T('Solo (silenzia le altre tracce)'), disabled: i === 0, action: () => this.solo(i) },
      '-',
      { label: T('Instrada al Master'), disabled: i === 0 || (t.out | 0) === 0, action: () => this.setOut(i, 0) },
      { label: T('Rimuovi tutte le mandate'), disabled: !t.sends.length, action: () => { t.sends = []; this.routesChanged(); } },
      '-',
      { label: T('Rimuovi tutti gli effetti'), disabled: !t.fx.some(Boolean), action: () => { t.fx = t.fx.map(() => null); engine && engine.rebuildFx(i); commit(); this.render(); } },
      { label: T('Salva lo stato della traccia'), action: () => saveTrackPreset(i) },
      { label: T('Carica uno stato'), disabled: !Presets.of('mixer').length, sub: Presets.of('mixer').map(pr => ({ label: pr.name, action: async () => Presets.applyTrack(await Presets.read('mixer', pr.name), i) })) },
      { label: T('Reimposta la traccia'), danger: true, disabled: i === 0, action: () => {
        Object.assign(t, { ...newMixerTrack(i), name: t.name });
        engine && engine.rebuildFx(i);
        this.routesChanged();
      } },
      ...(ins.length ? ['-', { title: T('Canali in ingresso') }, ...ins.map(c => ({ label: c.name, color: c.color, action: () => { Rack.select(c.id); openEditor(c.id); } }))] : []),
    ]);
  },
  solo(i) {
    const keep = new Set([0, i]);
    // keep everything between this track and the master audible
    let grew = true;
    while (grew) { grew = false; for (const k of [...keep]) for (const j of mixerEdges(k)) if (!keep.has(j)) { keep.add(j); grew = true; } }
    const allOn = proj.mixer.every((t, k) => keep.has(k) || t.mute);
    proj.mixer.forEach((t, k) => { if (k) t.mute = allOn ? false : !keep.has(k); engine && engine.updateStrip(k); });
    commit();
    this.render();
  },

  /* ---------- side panel ---------- */
  renderSide() {
    const box = $('#mx-side'), i = ui.selMix, t = proj.mixer[i];
    box.textContent = '';
    const title = h('div', 'side-title');
    title.append(T('Mixer') + ' - ', h('b', null, insName(i)));
    box.appendChild(title);
    box.appendChild(this.inputSelect(i));
    // ten effect slots
    const slots = h('div', 'slots');
    t.fx.forEach((slot, k) => slots.appendChild(this.slotRow(i, k, slot)));
    box.appendChild(slots);
    // EQ and stereo
    box.appendChild(this.eqBox(i, t));
    const st = h('div', 'eq-knobs');
    st.append(h('span', null, T('Separazione')), knob({
      spec: { label: T('Separazione stereo {0}', insName(i)), min: 0, max: 2, def: 1, unit: '%' }, value: t.width, size: 24,
      onInput: v => { t.width = v; engine && engine.updateStrip(i); }, onCommit: commit,
    }));
    box.appendChild(st);
    // output and sends
    box.appendChild(this.outputSelect(i, t));
    if (t.sends.length) {
      const list = h('div', 'sends');
      t.sends.forEach(snd => {
        const r = h('div', 'send-row');
        r.appendChild(h('span', null, '→ ' + insName(snd.to)));
        r.appendChild(knob({
          spec: { label: T('Mandata a {0}', insName(snd.to)), min: 0, max: 1.25, def: 1, unit: '%' }, value: snd.lv, size: 18,
          onInput: v => { snd.lv = v; engine && engine.updateStrip(i); }, onCommit: commit,
        }));
        const x = h('button', 'win-x');
        x.type = 'button';
        x.innerHTML = WIN_ICON.close;
        x.title = T('Rimuovi la mandata');
        x.addEventListener('click', () => this.toggleRoute(i, snd.to));
        r.appendChild(x);
        list.appendChild(r);
      });
      box.appendChild(list);
    }
  },
  inputSelect(i) {
    const b = h('button', 'side-select');
    b.type = 'button';
    b.insertAdjacentHTML('beforeend', SVG_PLUG);
    const t = proj.mixer[i], name = t.input ? (NE_INPUT_NAME(t.input) || T('Ingresso {0}', t.input)) : T('(nessuno)');
    b.appendChild(h('span', null, name));
    b.title = T('Ingresso audio da registrare su questa traccia');
    b.addEventListener('click', () => {
      const ins = window.NativeAudio ? NativeAudio.inputs() : [];
      const items = [{ title: T('Ingresso di {0}', insName(i)) }, { label: T('(nessuno)'), checked: !t.input, action: () => { t.input = 0; commit(); this.renderSide(); } }];
      if (!ins.length) items.push({ label: window.NativeAudio ? T('Nessun ingresso: scegli la scheda audio in Opzioni') : T('Registrazione dal microfono del browser'), checked: t.input === 1, disabled: !!window.NativeAudio, action: () => { t.input = 1; commit(); this.renderSide(); } });
      ins.forEach(x => items.push({ label: x.name, checked: t.input === x.id, action: () => { t.input = x.id; commit(); this.renderSide(); } }));
      menuAt(b, items);
    });
    return b;
  },
  outputSelect(i, t) {
    const b = h('button', 'side-select');
    b.type = 'button';
    b.insertAdjacentHTML('beforeend', SVG_OUT);
    b.appendChild(h('span', null, i === 0 ? (window.NativeAudio ? NativeAudio.outputName() : T('Uscita 1 - Uscita 2')) : T('Uscita: {0}', insName(t.out | 0))));
    if (i === 0) { b.title = T('Il Master suona sulla scheda audio (Opzioni › Impostazioni audio)'); b.addEventListener('click', () => window.AudioSettings && AudioSettings.open()); return b; }
    b.title = T('Traccia su cui esce questa traccia');
    b.addEventListener('click', () => {
      const items = [{ title: T('Uscita di {0}', insName(i)) }, { label: T('Master'), checked: (t.out | 0) === 0, action: () => this.setOut(i, 0) }];
      const used = usedTracks();
      for (let j = 1; j <= numInserts(); j++) {
        if (j === i || (!used.has(j) && j > 24 && (t.out | 0) !== j)) continue;
        items.push({ label: insName(j), checked: (t.out | 0) === j, disabled: !canRoute(i, j) && (t.out | 0) !== j, action: () => this.setOut(i, j) });
      }
      menuAt(b, items);
    });
    return b;
  },
  slotRow(i, k, slot) {
    const r = h('div', 'slot' + (WM.isOpen('fx') && ui.fxWin && ui.fxWin.i === i && ui.fxWin.k === k ? ' sel' : ''));
    const open = h('button', 'slot-open', '▶');
    open.type = 'button';
    open.title = T('Menu dello slot');
    open.addEventListener('click', () => this.slotMenu(i, k, open));
    const label = slot ? (slot.type === 'plugin' ? (slot.plugin && slot.plugin.name) || T('Plugin') : FXDEFS[slot.type].label) : T('Slot {0}', k + 1);
    const nm = h('button', 'slot-name' + (slot ? '' : ' empty'), label);
    nm.type = 'button';
    nm.title = slot ? T('Clic: apri {0}', label) : T('Clic: scegli un effetto');
    nm.addEventListener('click', () => (slot ? this.openFx(i, k) : this.effectMenu(i, k, nm)));
    nm.addEventListener('contextmenu', e => { e.preventDefault(); this.slotMenu(i, k, nm); });
    r.append(open, nm);
    if (slot) {
      r.appendChild(knob({
        spec: { label: T('Mix dello slot {0}', k + 1), min: 0, max: 1, def: 1, unit: '%' }, value: slot.mix ?? 1, size: 18,
        onInput: v => { slot.mix = v; engine && engine.rebuildFx(i); }, onCommit: commit,
      }));
      const on = h('button', 'slot-on' + (slot.on ? ' on' : ''));
      on.type = 'button';
      on.title = slot.on ? T('Attivo — clic per escluderlo') : T('Escluso — clic per attivarlo');
      on.setAttribute('aria-pressed', String(slot.on));
      on.addEventListener('click', () => { slot.on = !slot.on; engine && engine.rebuildFx(i); commit(); this.render(); });
      r.appendChild(on);
    }
    return r;
  },
  // Effect picker for a slot: built-in effects, then the plug-ins the desktop engine found, by maker.
  effectItems(i, k) {
    const items = [{ title: T('Effetti inclusi') }];
    Object.entries(FXDEFS).forEach(([key, d]) => { if (!d.hidden) items.push({ label: d.label, action: () => this.setSlot(i, k, fxSlot(key)) }); });
    if (window.NE && NE.plugins && NE.plugins.length) {
      const byVendor = new Map();
      NE.plugins.filter(p => !p.isInstrument).forEach(p => { const v = p.vendor || T('Altri'); if (!byVendor.has(v)) byVendor.set(v, []); byVendor.get(v).push(p); });
      if (byVendor.size) {
        items.push('-', { title: T('Plugin') });
        [...byVendor.keys()].sort((a, b) => a.localeCompare(b)).forEach(v => items.push({
          label: v, sub: byVendor.get(v).map(p => ({ label: p.name + ' · ' + p.format, action: () => NativePlugins.addEffect(p, i, k) })),
        }));
      }
    }
    return items;
  },
  effectMenu(i, k, anchor) { menuAt(anchor, this.effectItems(i, k)); },
  slotMenu(i, k, anchor) {
    const t = proj.mixer[i], slot = t.fx[k];
    const move = d => { const j = k + d; [t.fx[k], t.fx[j]] = [t.fx[j], t.fx[k]]; engine && engine.rebuildFx(i); commit(); this.render(); };
    menuAt(anchor, [
      { title: T('Slot {0}', k + 1) + ' · ' + insName(i) },
      { label: slot ? T('Sostituisci') : T('Scegli un effetto'), sub: this.effectItems(i, k) },
      { label: T('Apri'), disabled: !slot, action: () => this.openFx(i, k) },
      { label: slot && !slot.on ? T('Attiva') : T('Escludi'), disabled: !slot, action: () => { slot.on = !slot.on; engine && engine.rebuildFx(i); commit(); this.render(); } },
      '-',
      { label: T('Salva preset'), disabled: !slot, action: () => saveSlotPreset(i, k) },
      { label: T('Carica preset'), disabled: !Presets.of('effect').length, sub: Presets.of('effect').map(pr => ({ label: pr.name, action: async () => Presets.applySlot(await Presets.read('effect', pr.name), i, k) })) },
      '-',
      { label: T('Sposta su'), disabled: k === 0, action: () => move(-1) },
      { label: T('Sposta giù'), disabled: k === FX_SLOTS - 1, action: () => move(1) },
      '-',
      { label: T('Rimuovi'), danger: true, disabled: !slot, action: () => this.setSlot(i, k, null) },
    ]);
  },
  setSlot(i, k, slot) {
    proj.mixer[i].fx[k] = slot;
    engine && engine.rebuildFx(i);
    commit();
    if (slot) this.openFx(i, k);
    else { if (ui.fxWin && ui.fxWin.i === i && ui.fxWin.k === k) WM.close('fx'); this.render(); }
  },
  eqBox(i, t) {
    const box = h('div', 'eq-box'), cv = h('canvas', 'eq-graph'), faders = h('div', 'eq-faders');
    const draw = () => drawEq(cv, t.eq);
    [['low', T('Bassi')], ['mid', T('Medi')], ['high', T('Alti')]].forEach(([key, label]) => {
      faders.appendChild(fader({
        value: t.eq[key], min: -18, max: 18, zero: 0, def: 0, label: label + ' ' + insName(i), fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB',
        onInput: v => { t.eq[key] = v; engine && engine.updateStrip(i); draw(); }, onCommit: commit,
      }));
    });
    box.append(cv, faders);
    const row = h('div', 'eq-knobs');
    row.append(h('span', null, T('Equalizzatore')), knob({
      spec: { label: T('Frequenza dei medi {0}', insName(i)), min: 150, max: 6000, def: 1000, unit: 'Hz', log: true }, value: t.eq.midf, size: 22,
      onInput: v => { t.eq.midf = v; engine && engine.updateStrip(i); draw(); }, onCommit: commit,
    }));
    const wrap = h('div');
    wrap.style.display = 'grid';
    wrap.style.gap = '3px';
    wrap.append(box, row);
    requestAnimationFrame(draw);
    return wrap;
  },

  /* ---------- effect window ---------- */
  openFx(i, k) {
    ui.fxWin = { i, k };
    WM.open('fx');
    this.render();
  },
  renderFxWin() {
    const f = ui.fxWin, body = $('#fx-body');
    const slot = f && proj.mixer[f.i] && proj.mixer[f.i].fx[f.k];
    body.textContent = '';
    if (!slot) { WM.close('fx'); return; }
    const label = slot.type === 'plugin' ? (slot.plugin && slot.plugin.name) || T('Plugin') : FXDEFS[slot.type].label;
    $('#fx-title').textContent = T('{0} ({1} – Slot {2})', label, insName(f.i), f.k + 1);
    const head = h('div', 'fx-head');
    const on = h('button', 'fx-on' + (slot.on ? ' on' : ''), slot.on ? T('Attivo') : T('Escluso'));
    on.type = 'button';
    on.setAttribute('aria-pressed', String(slot.on));
    on.addEventListener('click', () => { slot.on = !slot.on; engine && engine.rebuildFx(f.i); commit(); this.render(); });
    head.appendChild(on);
    body.appendChild(head);
    if (slot.type === 'plugin') { body.appendChild(pluginBox('fx:' + f.i + ':' + f.k, slot.plugin || {}, label + ' · ' + insName(f.i))); return; }
    const params = h('div', 'fx-params');
    for (const [key, spec] of Object.entries(FXDEFS[slot.type].params)) {
      if (spec.select) {
        const lab = h('label', 'sel-param', spec.label), s2 = h('select');
        spec.options.forEach(([v, l]) => s2.appendChild(new Option(l, v)));
        s2.value = slot.params[key];
        s2.addEventListener('change', () => { slot.params[key] = s2.value; engine && engine.rebuildFx(f.i); commit(); });
        lab.appendChild(s2);
        params.appendChild(lab);
      } else if (spec.track) {
        const lab = h('label', 'sel-param', spec.label), s2 = h('select');
        for (let j = 1; j <= numInserts(); j++) if (j !== f.i) s2.appendChild(new Option(insName(j), j));
        s2.value = String(Math.round(slot.params[key]));
        s2.addEventListener('change', () => {
          const src = +s2.value;
          if (reaches(f.i, src)) { toast(T('Sidechain impossibile: {0} arriva già a {1}', insName(f.i), insName(src))); s2.value = String(Math.round(slot.params[key])); return; }
          slot.params[key] = src;
          engine && engine.routes && engine.routes();
          engine && engine.rebuildFx(f.i);
          commit();
          this.render();
        });
        lab.appendChild(s2);
        params.appendChild(lab);
      } else {
        params.appendChild(knob({
          spec, value: slot.params[key], size: 34, showLabel: true, showValue: true,
          onInput: v => { slot.params[key] = v; engine && engine.updateFx(f.i); }, onCommit: commit,
          auto: { kind: 'fxParam', ins: f.i, slot: f.k, key }, bind: () => { const s = proj.mixer[f.i].fx[f.k]; return s === slot ? slot.params[key] : null; },
        }));
      }
    }
    body.appendChild(params);
  },

  /* ---------- meters (only the strips in view) ---------- */
  drawMeters(force) {
    if (!WM.isOpen('mixer')) return;
    const wrap = $('#mx-strips'), left = wrap.scrollLeft, right = left + wrap.clientWidth;
    this.meters.forEach((cv, i) => {
      if (!cv) return;
      const s = cv.closest('.strip');
      if (!s || s.offsetLeft > right || s.offsetLeft + s.offsetWidth < left) return;
      const lv = engine && engine.strips[i] ? engine.strips[i].meter() : [0, 0];
      if (!force && lv[0] < 1e-4 && lv[1] < 1e-4 && cv._idle) return;
      cv._idle = lv[0] < 1e-4 && lv[1] < 1e-4;
      const W = cv.clientWidth || 7, H = cv.clientHeight || 100, g = fitCanvas(cv, W, H);
      g.fillStyle = TH.meterBg;
      g.fillRect(0, 0, W, H);
      if (!cv._grad || cv._gradH !== H) {
        const gr = g.createLinearGradient(0, H, 0, 0);
        gr.addColorStop(0, TH.signal); gr.addColorStop(0.7, TH.signal);
        gr.addColorStop(0.8, TH.brass); gr.addColorStop(0.9, TH.brass);
        gr.addColorStop(0.91, TH.alert); gr.addColorStop(1, TH.alert);
        cv._grad = gr; cv._gradH = H;
      }
      const bw = Math.max(2, Math.floor((W - 1) / 2));
      lv.forEach((v, k) => {
        const db = v > 0 ? 20 * Math.log10(v) : -90, n = clamp((db + 60) / 66, 0, 1), hh = n * H;
        g.fillStyle = cv._grad;
        g.fillRect(k * (bw + 1), H - hh, bw, hh);
      });
    });
  },
};
const NE_INPUT_NAME = id => (window.NativeAudio ? NativeAudio.inputName(id) : id === 1 ? T('Microfono del browser') : '');

// Response of the track EQ (low shelf 180 Hz, peak at midf, high shelf 6.5 kHz), drawn like an analyser.
function drawEq(cv, eq) {
  const W = cv.clientWidth || 160, H = cv.clientHeight || 84, g = fitCanvas(cv, W, H);
  g.fillStyle = '#252d31';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = TH.lineSoft;
  g.lineWidth = 1;
  [100, 1000, 10000].forEach(f => { const x = Math.log(f / 20) / Math.log(1000) * W; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); });
  g.beginPath(); g.moveTo(0, H / 2 + 0.5); g.lineTo(W, H / 2 + 0.5); g.stroke();
  const shelf = (f, f0, gain, high) => { const r = Math.pow(f / f0, 2); const w = high ? r / (1 + r) : 1 / (1 + r); return gain * w; };
  const peak = (f, f0, gain) => { const x = Math.log2(f / f0) / 0.9; return gain * Math.exp(-x * x * 2); };
  g.strokeStyle = TH.text;
  g.lineWidth = 1.5;
  g.beginPath();
  for (let x = 0; x <= W; x += 2) {
    const f = 20 * Math.pow(1000, x / W), db = shelf(f, 180, eq.low, false) + peak(f, eq.midf, eq.mid) + shelf(f, 6500, eq.high, true);
    const y = H / 2 - db / 24 * (H / 2 - 4);
    if (x) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
}
