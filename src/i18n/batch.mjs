// Prints a block of texts to translate, with where each one appears (to look up the context).
//   node src/i18n/batch.mjs <from> <count>      e.g. node src/i18n/batch.mjs 0 150
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const list = JSON.parse(readFileSync(join(HERE, 'strings.json'), 'utf8'));
const from = +(process.argv[2] || 0), count = +(process.argv[3] || 150);
console.log(`texts ${from}–${Math.min(list.length, from + count) - 1} of ${list.length - 1}`);
list.slice(from, from + count).forEach((e, i) => console.log(`${from + i}\t${JSON.stringify(e.s)}\t(${e.at.join(', ')})`));
