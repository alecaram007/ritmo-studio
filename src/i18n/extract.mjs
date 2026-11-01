// Collects every text to translate into src/i18n/strings.json: the T('…') calls in src/js and the fixed
// texts of src/index.html (text nodes and title / aria-label / placeholder attributes).
//   node src/i18n/extract.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const html = readFileSync(join(SRC, 'index.html'), 'utf8');
const found = new Map();
const add = (s, at) => {
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || !/\p{L}/u.test(s)) return;
  if (!found.has(s)) found.set(s, []);
  if (found.get(s).length < 4) found.get(s).push(at);
};
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', times: '×', rarr: '→', larr: '←', uarr: '↑', darr: '↓', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
const lineOf = (text, i) => text.slice(0, i).split('\n').length;

// index.html: markup only, without <style> and <script> blocks
const markup = html.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, m => m.replace(/[^\n]/g, ' '));
for (const m of markup.matchAll(/>([^<>]+)</g)) add(decode(m[1]), `index.html:${lineOf(markup, m.index)}`);
for (const m of markup.matchAll(/\s(?:title|aria-label|placeholder)="([^"]*)"/g)) add(decode(m[1]), `index.html:${lineOf(markup, m.index)}`);

// scripts, in the order index.html loads them
const scripts = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]).filter(f => !/^i18n/.test(f));
// plus the desktop app's main process (menus, Save dialogs)
const DESKTOP = ['../../desktop/main.js', '../../desktop/files.js'];
const bad = [];
for (const f of [...scripts, ...DESKTOP]) {
  const code = readFileSync(join(SRC, 'js', f), 'utf8');
  for (const m of code.matchAll(/(?<![\w$.])TM?\(\s*/g)) {
    const i = m.index + m[0].length, q = code[i];
    if (!`'"\``.includes(q)) continue;  // T(variable): a text marked elsewhere
    let j = i + 1;
    while (j < code.length && code[j] !== q) j += code[j] === '\\' ? 2 : 1;
    const lit = code.slice(i, j + 1);
    if (q === '`' && lit.includes('${')) { bad.push(`${f}:${lineOf(code, i)} template with \${} inside T()`); continue; }
    add(Function(`return ${lit}`)(), `${f}:${lineOf(code, i)}`);
  }
}
const list = [...found].map(([s, at]) => ({ s, at }));
writeFileSync(join(HERE, 'strings.json'), JSON.stringify(list, null, 1) + '\n');
console.log(`${list.length} texts → src/i18n/strings.json`);
if (bad.length) { console.log('problems:\n  ' + bad.join('\n  ')); process.exitCode = 1; }
