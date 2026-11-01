'use strict';
const { T } = require('./i18n');
// Disk access for the page's browser. The user adds folders with the system picker; the page can list, read and
// search files only inside those folders, and read and write its own presets folder. Nothing else on disk is reachable.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');

const MAX_READ = 300 * 1024 * 1024;
const MAX_INDEX = 150000;
const PRESET_KINDS = ['channel', 'effect', 'mixer'];

const rootsFile = () => path.join(app.getPath('userData'), 'browser-folders.json');
const presetsDir = () => path.join(app.getPath('userData'), 'Presets');
let roots = [];
const indexes = new Map(); // root -> { at, files: [{ path, name, lower }] }

function loadRoots() {
  try {
    const list = JSON.parse(fs.readFileSync(rootsFile(), 'utf8'));
    roots = Array.isArray(list) ? list.filter(p => typeof p === 'string' && fs.existsSync(p)) : [];
  } catch { roots = []; }
}
function saveRoots() {
  try { fs.writeFileSync(rootsFile(), JSON.stringify(roots, null, 1)); } catch { /* read-only profile: keep in memory */ }
}
function inside(p, root) {
  const r = path.resolve(p), base = path.resolve(root);
  return r === base || r.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}
function allowed(p) {
  return typeof p === 'string' && (roots.some(r => inside(p, r)) || inside(p, presetsDir()));
}
const hidden = name => name.startsWith('.') || name === 'node_modules' || name === '__MACOSX';

async function walk(root) {
  const files = [], stack = [root];
  while (stack.length && files.length < MAX_INDEX) {
    const dir = stack.pop();
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (hidden(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) files.push({ path: p, name: e.name, lower: e.name.toLowerCase() });
    }
  }
  return files;
}
async function indexOf(root) {
  const cur = indexes.get(root);
  if (cur && Date.now() - cur.at < 60000) return cur.files;
  const files = await walk(root);
  indexes.set(root, { at: Date.now(), files });
  return files;
}
const safePresetName = s => String(s || 'preset').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'preset';

function register() {
  loadRoots();
  ipcMain.handle('files:roots', () => roots.map(p => ({ path: p, name: path.basename(p) || p })));
  ipcMain.handle('files:pick', async event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, { title: T('Aggiungi una cartella al browser'), properties: ['openDirectory', 'multiSelections', 'createDirectory'] });
    if (res.canceled) return [];
    for (const p of res.filePaths) if (!roots.includes(p)) roots.push(p);
    saveRoots();
    return res.filePaths.map(p => ({ path: p, name: path.basename(p) || p }));
  });
  ipcMain.handle('files:remove', (_event, p) => {
    roots = roots.filter(r => r !== p);
    indexes.delete(p);
    saveRoots();
    return true;
  });
  ipcMain.handle('files:list', async (_event, dir) => {
    if (!allowed(dir)) throw new Error('Cartella non consentita');
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    return ents.filter(e => !hidden(e.name) && (e.isDirectory() || e.isFile()))
      .map(e => ({ name: e.name, dir: e.isDirectory(), path: path.join(dir, e.name) }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1));
  });
  ipcMain.handle('files:read', async (_event, p) => {
    if (!allowed(p)) throw new Error('File non consentito');
    const st = await fsp.stat(p);
    if (st.size > MAX_READ) throw new Error('File troppo grande');
    return fsp.readFile(p);
  });
  // Every word must appear in the file name; results are capped.
  ipcMain.handle('files:search', async (_event, query, limit = 400) => {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const out = [];
    for (const root of roots) {
      for (const f of await indexOf(root)) {
        if (words.every(w => f.lower.includes(w))) out.push({ path: f.path, name: f.name, root });
        if (out.length >= limit) return out;
      }
    }
    return out;
  });
  ipcMain.handle('files:reveal', (_event, p) => { if (allowed(p)) shell.showItemInFolder(p); return true; });

  ipcMain.handle('presets:list', async () => {
    const out = [];
    for (const kind of PRESET_KINDS) {
      const dir = path.join(presetsDir(), kind);
      let ents = [];
      try { ents = await fsp.readdir(dir); } catch { continue; }
      for (const n of ents) if (n.endsWith('.json')) out.push({ kind, name: n.slice(0, -5) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });
  ipcMain.handle('presets:save', async (_event, kind, name, json) => {
    if (!PRESET_KINDS.includes(kind)) throw new Error('Tipo di preset sconosciuto');
    const dir = path.join(presetsDir(), kind);
    await fsp.mkdir(dir, { recursive: true });
    const base = safePresetName(name);
    await fsp.writeFile(path.join(dir, base + '.json'), String(json));
    return base;
  });
  ipcMain.handle('presets:read', async (_event, kind, name) => {
    if (!PRESET_KINDS.includes(kind)) throw new Error('Tipo di preset sconosciuto');
    return fsp.readFile(path.join(presetsDir(), kind, safePresetName(name) + '.json'), 'utf8');
  });
  ipcMain.handle('presets:remove', async (_event, kind, name) => {
    if (!PRESET_KINDS.includes(kind)) return false;
    await fsp.rm(path.join(presetsDir(), kind, safePresetName(name) + '.json'), { force: true });
    return true;
  });
}

module.exports = { register };
