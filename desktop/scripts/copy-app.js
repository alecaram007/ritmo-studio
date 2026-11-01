#!/usr/bin/env node
'use strict';
// Copies the single-file web app (../RitmoStudio.html) to app/index.html,
// so every `npm start` / `npm run dist*` packages the current version.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.resolve(root, '..', 'RitmoStudio.html');
const destDir = path.join(root, 'app');
const dest = path.join(destDir, 'index.html');

if (!fs.existsSync(src)) {
  console.error(`[copy-app] File non trovato: ${src}`);
  console.error('[copy-app] Genera prima RitmoStudio.html nella cartella superiore.');
  process.exit(1);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);

// Translations for the main process (menus, dialogs): the page's own, from ../src/js/i18n-data.js (build.py).
const i18nSrc = path.resolve(root, '..', 'src', 'js', 'i18n-data.js');
let i18n = '{"src":[]}';
if (fs.existsSync(i18nSrc)) i18n = fs.readFileSync(i18nSrc, 'utf8').replace(/^window\.RITMO_I18N = /, '').replace(/;\s*$/, '').replace(/<\\\//g, '</');
fs.writeFileSync(path.join(destDir, 'i18n.json'), i18n);

const kb = (fs.statSync(dest).size / 1024).toFixed(0);
console.log(`[copy-app] ${path.relative(root, src)} -> ${path.relative(root, dest)} (${kb} KB)`);
