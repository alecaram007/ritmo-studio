// Checks the app translations in src/i18n/<code>.json against src/i18n/strings.json:
// every text translated, the same {0} {1} placeholders, no stale entries.
//   node src/i18n/check.mjs [code ...]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(readFileSync(join(HERE, 'strings.json'), 'utf8')).map(e => e.s);
const marks = s => (s.match(/\{\d+\}/g) || []).sort().join(' ');
const codes = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(HERE).filter(f => /^[a-z-]+\.json$/.test(f) && f !== 'strings.json').map(f => f.slice(0, -5));
let bad = 0;
for (const c of codes) {
  const t = JSON.parse(readFileSync(join(HERE, c + '.json'), 'utf8'));
  const missing = src.filter(s => !(typeof t[s] === 'string' && t[s].trim()));
  const ph = src.filter(s => t[s] && marks(t[s]) !== marks(s));
  const stale = Object.keys(t).filter(k => !src.includes(k));
  const ok = !missing.length && !ph.length;
  bad += !ok;
  console.log(`${c}: ${src.length - missing.length}/${src.length} translated` + (ph.length ? `, ${ph.length} with wrong placeholders` : '') + (stale.length ? `, ${stale.length} stale` : '') + (ok ? '' : ' ✗'));
  for (const s of [...missing.slice(0, 5)]) console.log('   missing:', JSON.stringify(s));
  for (const s of ph.slice(0, 5)) console.log('   placeholders:', JSON.stringify(s), '→', JSON.stringify(t[s]));
}
process.exitCode = bad ? 1 : 0;
