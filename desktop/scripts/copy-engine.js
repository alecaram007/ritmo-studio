#!/usr/bin/env node
'use strict';
// Stages the native engine (../engine) into engine-bin/<os>/ for electron-builder's extraResources.
// The engine is C++ and must be compiled on each OS: a build only includes the engines present here.
// Without an engine the app still runs, with the browser (Web Audio) engine and no third-party plug-ins.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const engineDir = path.resolve(root, '..', 'engine');
const out = path.join(root, 'engine-bin');

const candidates = {
  mac: ['build-universal', 'build'].map(b => path.join(engineDir, b, 'RitmoEngine_artefacts', 'Release', 'Ritmo Engine.app')),
  win: ['build-win', 'build'].map(b => path.join(engineDir, b, 'RitmoEngine_artefacts', 'Release', 'Ritmo Engine.exe')),
  linux: ['build-linux', 'build'].map(b => path.join(engineDir, b, 'RitmoEngine_artefacts', 'Release', 'Ritmo Engine')),
};

fs.rmSync(out, { recursive: true, force: true });
for (const [os, list] of Object.entries(candidates)) {
  const dest = path.join(out, os);
  fs.mkdirSync(dest, { recursive: true });
  const src = list.find(p => fs.existsSync(p));
  if (!src) {
    fs.writeFileSync(path.join(dest, 'README.txt'), 'Motore nativo non incluso in questa build.\n');
    console.log(`[copy-engine] ${os}: motore non trovato, la build ${os} userà il motore Web Audio`);
    continue;
  }
  fs.cpSync(src, path.join(dest, path.basename(src)), { recursive: true, verbatimSymlinks: true });
  console.log(`[copy-engine] ${os}: ${path.relative(root, src)}`);
}
