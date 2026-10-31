'use strict';
/* Ritmo Studio — plug-in browser (desktop app only): a "Plugin" folder in the browser lists the VST3, AU, LV2 and
   CLAP plug-ins found by the native engine, grouped into instruments and effects and then by maker. */

if (window.NativePlugins) {
  const FORMAT = { VST3: 'VST3', AudioUnit: 'AU', LV2: 'LV2', CLAP: 'CLAP', LADSPA: 'LADSPA' };
  let opened = false;

  window.TreeExtras = ({ add, folder, note }) => {
    if (!opened && NE.plugins.length) {
      opened = true;
      for (const k of ['plugins', 'plugins/inst']) if (!ui.treeOpen.includes(k)) ui.treeOpen.push(k);
    }
    folder('plugins', 0, 'Database plugin' + (NE.plugins.length ? ' (' + NE.plugins.length + ')' : ''), d => {
      if (NE.scan) note(d, 'Scansione in corso: ' + NE.scan.done + ' di ' + NE.scan.total + (NE.scan.current ? ' · ' + NE.scan.current : ''));
      else if (!NE.connected) note(d, 'Avvio del motore audio…');
      else if (!NE.plugins.length) note(d, 'Nessun plugin trovato. Usa “Cerca plugin nuovi”.');
      const groups = [['plugins/inst', 'Strumenti', p => p.isInstrument], ['plugins/fx', 'Effetti', p => !p.isInstrument]];
      for (const [key, label, pick] of groups) {
        const list = NE.plugins.filter(pick);
        if (!list.length) continue;
        folder(key, d, label + ' (' + list.length + ')', d2 => {
          const byVendor = new Map();
          for (const p of list) {
            const v = p.vendor || 'Altri';
            if (!byVendor.has(v)) byVendor.set(v, []);
            byVendor.get(v).push(p);
          }
          [...byVendor.keys()].sort((a, b) => a.localeCompare(b)).forEach(v => folder(key + '/' + v, d2, v, d3 => byVendor.get(v).forEach(p => add('item', d3, p.isInstrument ? 'inst' : 'fx', p.name, {
            meta: FORMAT[p.format] || p.format,
            title: p.isInstrument ? 'Clic: nuovo canale con ' + p.name : 'Clic: aggiungi ' + p.name + ' alla traccia selezionata del mixer (' + mixerName(ui.selMix) + ')',
            click: () => (p.isInstrument ? NativePlugins.addInstrument(p) : NativePlugins.addEffect(p)),
            drag: { kind: 'plugin', plugin: p },
          }))));
        });
      }
      add('item', d, 'plus', 'Cerca plugin nuovi', { click: () => { NativePlugins.scan('update'); toast('Cerco plugin nuovi o aggiornati…'); } });
      add('item', d, 'plus', 'Ripeti la scansione completa', { click: () => { NativePlugins.scan('full'); toast('Scansione completa dei plugin avviata'); } });
    }, 'plug', 'plugins');
  };
}
