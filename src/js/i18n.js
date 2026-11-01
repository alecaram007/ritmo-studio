/* Ritmo Studio — interface languages.
   Italian is the source language: every text shown to the user is written in Italian inside T('…'), and
   T returns its translation in the chosen language, or the Italian text when a translation is missing.
   Numbered placeholders keep sentences whole: T('Gli slot di {0} sono tutti occupati', name).
   The translations (window.RITMO_I18N) are added by build.py from src/i18n/<code>.json. */

const LANGUAGES = [
  ['it', 'Italiano'], ['en', 'English'], ['es', 'Español'], ['pt', 'Português'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['nl', 'Nederlands'], ['sv', 'Svenska'], ['pl', 'Polski'], ['cs', 'Čeština'],
  ['ro', 'Română'], ['hu', 'Magyar'], ['tr', 'Türkçe'], ['el', 'Ελληνικά'], ['ru', 'Русский'],
  ['uk', 'Українська'], ['ar', 'العربية'], ['he', 'עברית'], ['hi', 'हिन्दी'], ['id', 'Bahasa Indonesia'],
  ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['ja', '日本語'], ['ko', '한국어'], ['zh-cn', '简体中文'], ['zh-tw', '繁體中文'],
];
const LANG_KEY = 'ritmo-studio/lang-v1';

const I18N = (() => {
  const data = window.RITMO_I18N || { src: [] };
  const known = new Set(LANGUAGES.map(l => l[0]).concat('qps'));  // qps: pseudo-language for testing
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch (e) { /* no storage: follow the system */ }
  const alias = { 'zh-hk': 'zh-tw', 'zh-mo': 'zh-tw', 'zh-hant': 'zh-tw', 'zh-sg': 'zh-cn', 'zh-hans': 'zh-cn', zh: 'zh-cn', iw: 'he' };
  const pick = () => {
    for (const l of navigator.languages || [navigator.language || '']) {
      const full = String(l).toLowerCase(), primary = full.split('-')[0];
      if (primary === 'zh') return /hant|-tw|-hk|-mo/.test(full) ? 'zh-tw' : 'zh-cn';  // script or region decides
      const hit = [full, alias[full], primary, alias[primary]].find(c => c && known.has(c) && c !== 'qps');
      if (hit) return hit;
    }
    return 'en';  // a language without a translation: English is the most widely understood
  };
  const lang = saved && known.has(saved) ? saved : pick();
  const map = new Map();
  const tr = data[lang];
  // The pseudo-language brackets every known text, so a text shown without brackets was never marked.
  if (lang === 'qps') data.src.forEach(s => map.set(s, '⟦' + s.split('||')[0] + '⟧'));
  else if (Array.isArray(tr)) data.src.forEach((s, i) => { if (tr[i]) map.set(s, tr[i]); });
  return { lang, map, saved: !!saved };
})();

// A text can carry a context after "||" when the same Italian word means two things in the app
// ("Velocità||rate" is a modulation speed, "Velocità" a note velocity): the context is never shown.
function T(s, ...args) {
  let r = I18N.map.get(s) || s.split('||')[0];
  if (args.length) r = r.replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? '' : String(args[i])));
  return r;
}

// Locale for dates and numbers shown in the interface.
function uiLocale() { return { 'zh-cn': 'zh-CN', 'zh-tw': 'zh-TW', qps: 'en' }[I18N.lang] || I18N.lang; }

// A name or label placed inside a sentence: lowercase, except in German, where nouns keep their capital.
function inSentence(s) { return I18N.lang === 'de' ? s : String(s).toLocaleLowerCase(uiLocale()); }

// Marks a text for translation without translating it here, for texts that are also used as keys or
// compared in code: keep the Italian value in the data and show it with T(value).
function TM(s) { return s; }

// Translates the fixed texts of the page: text nodes and the title, aria-label and placeholder attributes.
function translateDOM(root) {
  if (I18N.lang === 'it') return;
  const one = v => {
    const t = v.replace(/\s+/g, ' ').trim();
    if (!t) return v;
    const r = T(t);
    return r === t ? v : v.match(/^\s*/)[0] + r + v.match(/\s*$/)[0];
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentNode && /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeValue = one(n.nodeValue);
  root.querySelectorAll('[title],[aria-label],[placeholder]').forEach(el => {
    for (const a of ['title', 'aria-label', 'placeholder']) if (el.hasAttribute(a)) el.setAttribute(a, one(el.getAttribute(a)));
  });
}

// The new language applies after a reload; the project is saved first, so nothing is lost.
function setLanguage(code) {
  try { localStorage.setItem(LANG_KEY, code); } catch (e) { /* the choice lasts this session only */ }
  if (typeof autosave === 'function') autosave();
  setTimeout(() => location.reload(), 900);
}

document.documentElement.lang = uiLocale();
translateDOM(document.body);

// The desktop app follows the same language in its menus and Save dialogs.
if (window.ritmoApp && window.ritmoApp.setLang) window.ritmoApp.setLang(I18N.lang);
