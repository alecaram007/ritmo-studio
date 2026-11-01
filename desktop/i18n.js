'use strict';
// Translations for the main process (menus, Save dialogs, About box): the same texts and files as the page.
// scripts/copy-app.js writes app/i18n.json from the page's translations. The page tells us its language when
// it starts (ritmoApp.setLang); until then the system language is used.
const fs = require('node:fs');
const path = require('node:path');

let data = { src: [] };
try {
  data = JSON.parse(fs.readFileSync(path.join(__dirname, 'app', 'i18n.json'), 'utf8'));
} catch (e) {
  /* no translations packaged: menus stay in Italian */
}
let lang = 'it';
let map = new Map();

function setLang(code) {
  lang = code;
  map = new Map();
  const tr = data[code];
  if (Array.isArray(tr)) data.src.forEach((s, i) => { if (tr[i]) map.set(s, tr[i]); });
}

function T(s, ...args) {
  let r = map.get(s) || s.split('||')[0];
  if (args.length) r = r.replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? '' : String(args[i])));
  return r;
}

// Same choice as the page: exact tag, then the main language (de-AT -> de), Chinese by script or region.
function systemLang(locales) {
  const alias = { 'zh-hk': 'zh-tw', 'zh-mo': 'zh-tw', 'zh-hant': 'zh-tw', 'zh-sg': 'zh-cn', 'zh-hans': 'zh-cn', zh: 'zh-cn', iw: 'he' };
  for (const l of locales || []) {
    const full = String(l).toLowerCase().replace('_', '-');
    const primary = full.split('-')[0];
    if (primary === 'zh') return /hant|-tw|-hk|-mo/.test(full) ? 'zh-tw' : 'zh-cn';  // script or region decides
    const hit = [full, alias[full], primary, alias[primary]].find(c => c && (c === 'it' || data[c]));
    if (hit) return hit;
  }
  return data.en ? 'en' : 'it';  // a language without a translation: English is the most widely understood
}

module.exports = { T, setLang, getLang: () => lang, systemLang };
