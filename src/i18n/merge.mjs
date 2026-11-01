// Merges translated parts into src/i18n/<code>.json and removes the parts.
// A part is a JSON object { "Italian text": "translation", ... } saved as src/i18n/parts/<code>-<anything>.json.
//   node src/i18n/merge.mjs <code>
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = process.argv[2];
if (!code) { console.error('usage: node src/i18n/merge.mjs <code>'); process.exit(1); }
const src = JSON.parse(readFileSync(join(HERE, 'strings.json'), 'utf8')).map(e => e.s);
const file = join(HERE, code + '.json');
const out = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
const dir = join(HERE, 'parts');
const parts = existsSync(dir) ? readdirSync(dir).filter(f => f.startsWith(code + '-') && f.endsWith('.json')).sort() : [];
let added = 0;
for (const p of parts) {
  const t = JSON.parse(readFileSync(join(dir, p), 'utf8'));
  for (const [k, v] of Object.entries(t)) { if (typeof v === 'string') { out[k] = v; added++; } }
}
const sorted = {};
for (const s of src) if (out[s] !== undefined) sorted[s] = out[s];
const unknown = Object.keys(out).filter(k => !src.includes(k));
writeFileSync(file, JSON.stringify(sorted, null, 1) + '\n');
for (const p of parts) rmSync(join(dir, p));
console.log(`${code}: merged ${parts.length} parts (${added} entries); ${Object.keys(sorted).length}/${src.length} translated` + (unknown.length ? `; ${unknown.length} keys not in strings.json were dropped, e.g. ${JSON.stringify(unknown[0])}` : ''));
