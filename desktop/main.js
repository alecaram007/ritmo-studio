'use strict';
/*
 * Ritmo Studio — Electron main process.
 * Wraps the single-file web app (app/index.html, copied from ../RitmoStudio.html)
 * in a native window with an Italian menu, native Save dialogs for downloads,
 * Web MIDI permissions and remembered window bounds.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const { T, setLang, getLang, systemLang } = require('./i18n');
const TM = s => s; // marks a text for translation; shown later with T()
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_NAME = 'Ritmo Studio';
const INDEX_FILE = path.join(__dirname, 'app', 'index.html');
const INDEX_URL = pathToFileURL(INDEX_FILE).href;
const DEFAULT_BOUNDS = { width: 1440, height: 900 };
const MIN_SIZE = { width: 1100, height: 700 };
const BG_COLOR = '#1f262c';
const HELP_LINKS = [
  { label: TM('Guida alla Web Audio API (MDN)'), url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
  { label: TM('Guida alla Web MIDI API (MDN)'), url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API' },
];
// Permissions the page may use: Web MIDI (incl. SysEx), microphone, fullscreen, pointer lock, clipboard write.
const ALLOWED_PERMISSIONS = new Set(['midi', 'midiSysex', 'media', 'fullscreen', 'pointerLock', 'clipboard-sanitized-write']);

const isMac = process.platform === 'darwin';
let mainWindow = null;
let lastSaveDir = null;

app.setName(APP_NAME);

/* ---------- Native audio engine (plays everything and hosts VST3 / AU / LV2 / CLAP plug-ins) ---------- */

const ENGINE_MAGIC = 0x524d5452;

function enginePath() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'engine')
    : path.join(__dirname, '..', 'engine', 'build', 'RitmoEngine_artefacts', 'Release');
  if (isMac) return path.join(base, 'Ritmo Engine.app', 'Contents', 'MacOS', 'Ritmo Engine');
  if (process.platform === 'win32') return path.join(base, 'Ritmo Engine.exe');
  return path.join(base, 'Ritmo Engine');
}

class EngineBridge {
  constructor() {
    this.proc = null;
    this.sock = null;
    this.ready = false;
    this.queue = [];
    this.buffer = Buffer.alloc(0);
    this.quitting = false;
    this.crashes = [];
  }

  available() { return fs.existsSync(enginePath()); }

  start() {
    if (this.quitting || !this.available()) return;
    const token = crypto.randomBytes(16).toString('hex');
    const proc = spawn(enginePath(), ['--token', token], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    let out = '';
    proc.stdout.on('data', d => {
      out += d;
      const m = out.match(/RITMO_ENGINE_PORT (\d+)/);
      if (m && !this.sock) this.connect(Number(m[1]), token);
    });
    proc.stderr.on('data', d => console.warn('[engine]', String(d).trim()));
    proc.on('error', err => this.emit({ t: 'engineFailed', error: err.message }));
    proc.on('exit', code => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.sock = null;
      this.ready = false;
      if (this.quitting) return;
      // A plug-in can take the engine down: restart it, but give up if it keeps crashing.
      const now = Date.now();
      this.crashes = this.crashes.filter(t => now - t < 30000).concat(now);
      if (this.crashes.length > 3) {
        this.emit({ t: 'engineFailed', error: `il motore si è chiuso più volte (codice ${code})` });
        return;
      }
      this.emit({ t: 'engineExit', code });
      setTimeout(() => this.start(), 500);
    });
  }

  connect(port, token) {
    const sock = net.connect(port, '127.0.0.1');
    this.sock = sock;
    sock.setNoDelay(true);
    sock.on('connect', () => {
      this.write({ t: 'hello', token });
      this.write({ t: 'init' });
      this.ready = true;
      for (const m of this.queue) this.write(m);
      this.queue = [];
    });
    sock.on('data', d => {
      this.buffer = Buffer.concat([this.buffer, d]);
      while (this.buffer.length >= 8) {
        if (this.buffer.readUInt32LE(0) !== ENGINE_MAGIC) { sock.destroy(); this.buffer = Buffer.alloc(0); return; }
        const size = this.buffer.readUInt32LE(4);
        if (this.buffer.length < 8 + size) break;
        const text = this.buffer.subarray(8, 8 + size).toString('utf8');
        this.buffer = this.buffer.subarray(8 + size);
        try { this.emit(JSON.parse(text)); } catch { /* ignore malformed */ }
      }
    });
    sock.on('error', () => {});
  }

  write(msg) {
    const body = Buffer.from(JSON.stringify(msg), 'utf8');
    const head = Buffer.alloc(8);
    head.writeUInt32LE(ENGINE_MAGIC, 0);
    head.writeUInt32LE(body.length, 4);
    this.sock.write(Buffer.concat([head, body]));
  }

  send(msg) {
    if (this.ready && this.sock) { this.write(msg); return; }
    // keep only the newest full project while the engine is starting
    if (msg.t === 'project') this.queue = this.queue.filter(m => m.t !== 'project');
    if (this.queue.length < 500) this.queue.push(msg);
  }

  emit(msg) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('engine:msg', msg);
  }

  stop() {
    this.quitting = true;
    if (this.sock) this.sock.destroy();
    if (this.proc) {
      const proc = this.proc;
      setTimeout(() => { try { proc.kill(); } catch { /* already gone */ } }, 1500);
    }
  }
}

const engineBridge = new EngineBridge();

require('./files').register();
ipcMain.on('engine:available', event => { event.returnValue = engineBridge.available(); });
ipcMain.on('engine:send', (_event, msg) => engineBridge.send(msg));
ipcMain.handle('dialog:save', async (event, options) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
  const dir = lastSaveDir || app.getPath('music');
  const res = await dialog.showSaveDialog(parent, {
    title: options.title || T('Salva'),
    defaultPath: path.join(dir, path.basename(options.defaultPath || 'ritmo-studio')),
    filters: options.filters || [],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  });
  if (res.canceled || !res.filePath) return null;
  lastSaveDir = path.dirname(res.filePath);
  return res.filePath;
});

/* ---------- Window state (size/position) ---------- */

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  let s;
  try {
    s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { ...DEFAULT_BOUNDS };
  }
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const out = {
    width: num(s.width) ? Math.max(MIN_SIZE.width, Math.round(s.width)) : DEFAULT_BOUNDS.width,
    height: num(s.height) ? Math.max(MIN_SIZE.height, Math.round(s.height)) : DEFAULT_BOUNDS.height,
    maximized: s.maximized === true,
  };
  if (num(s.x) && num(s.y)) {
    // Only restore the position if a good part of the window lands on a connected display.
    const rect = { x: Math.round(s.x), y: Math.round(s.y), width: out.width, height: out.height };
    const visible = screen.getAllDisplays().some(({ workArea: wa }) => {
      const w = Math.min(rect.x + rect.width, wa.x + wa.width) - Math.max(rect.x, wa.x);
      const h = Math.min(rect.y + rect.height, wa.y + wa.height) - Math.max(rect.y, wa.y);
      return w >= 200 && h >= 120;
    });
    if (visible) Object.assign(out, { x: rect.x, y: rect.y });
  }
  return out;
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getNormalBounds();
    const data = { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() };
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
    fs.renameSync(file + '.tmp', file);
  } catch (err) {
    console.warn('Impossibile salvare lo stato della finestra:', err);
  }
}

/* ---------- Main window ---------- */

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: APP_NAME,
    backgroundColor: BG_COLOR,
    autoHideMenuBar: false,
    // macOS: the app's own menu bar shares the title bar with the window buttons
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 12 } } : {}),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
      // Keep the audio scheduler running at full rate when the window is in the background.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  mainWindow = win;

  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  // Keep the native title fixed to the product name.
  win.on('page-title-updated', e => e.preventDefault());

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, scheduleSave);
  win.on('close', () => {
    clearTimeout(saveTimer);
    saveWindowState(win);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadFile(INDEX_FILE);
  return win;
}

/* ---------- Security: links, navigation, permissions ---------- */

const isHttpUrl = url => {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const isAppPage = url => {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return u.href === INDEX_URL;
  } catch {
    return false;
  }
};

app.on('web-contents-created', (_event, contents) => {
  // window.open / target=_blank: external http(s) links go to the system browser, nothing opens in-app.
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Never navigate the app window away from the bundled page.
  contents.on('will-navigate', (event, url) => {
    if (isAppPage(url)) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (!isAppPage(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', event => event.preventDefault());
});

function setupSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));

  // <a download> of blob: URLs (.wav, .json, ...) -> native Save dialog.
  ses.on('will-download', (event, item, webContents) => {
    const parent = (webContents && BrowserWindow.fromWebContents(webContents)) || mainWindow || undefined;
    const suggested = item.getFilename() || 'ritmo-studio';
    const ext = path.extname(suggested).replace(/^\./, '');
    const filters = ext
      ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: T('Tutti i file'), extensions: ['*'] }]
      : [];
    const dir = lastSaveDir || app.getPath('downloads');
    const target = dialog.showSaveDialogSync(parent, {
      title: T('Salva file'),
      buttonLabel: 'Salva',
      defaultPath: path.join(dir, suggested),
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (!target) {
      event.preventDefault(); // user cancelled
      return;
    }
    lastSaveDir = path.dirname(target);
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state === 'interrupted') {
        dialog.showErrorBox(T('Salvataggio non riuscito'), T('Impossibile salvare il file:\n{0}', target));
      }
    });
  });
}

/* ---------- Menu (in the page's language, see i18n.js) ---------- */

function showAbout() {
  if (isMac) {
    app.showAboutPanel();
    return;
  }
  dialog.showMessageBox(mainWindow || undefined, {
    type: 'info',
    title: T('Informazioni su Ritmo Studio'),
    message: `${APP_NAME} ${app.getVersion()}`,
    detail:
      T('DAW gratuita: Channel Rack, Piano Roll, Playlist e Mixer.') + '\n\n' +
      `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\n` + T('Licenza MIT'),
    buttons: ['OK'],
    noLink: true,
  });
}

function buildMenu() {
  const sep = { type: 'separator' };
  const template = [];

  if (isMac) {
    template.push({
      label: APP_NAME,
      submenu: [
        { role: 'about', label: T('Informazioni su Ritmo Studio') },
        sep,
        { role: 'services', label: T('Servizi') },
        sep,
        { role: 'hide', label: T('Nascondi Ritmo Studio') },
        { role: 'hideOthers', label: T('Nascondi altre') },
        { role: 'unhide', label: T('Mostra tutte') },
        sep,
        { role: 'quit', label: T('Esci da Ritmo Studio') },
      ],
    });
  } else {
    template.push({
      label: T('File'),
      submenu: [{ role: 'quit', label: T('Esci'), accelerator: 'Ctrl+Q' }],
    });
  }

  // Edit roles are kept for text fields; the page handles its own undo/redo shortcuts first.
  template.push({
    label: T('Modifica'),
    submenu: [
      { role: 'undo', label: T('Annulla') },
      { role: 'redo', label: T('Ripeti') },
      sep,
      { role: 'cut', label: T('Taglia') },
      { role: 'copy', label: T('Copia') },
      { role: 'paste', label: T('Incolla') },
      sep,
      { role: 'selectAll', label: T('Seleziona tutto') },
    ],
  });

  // The web app uses Ctrl/Cmd+R (export WAV) and F5-F9, so reload lives on Ctrl/Cmd+Shift+R and no F-keys are bound.
  template.push({
    label: T('Vista'),
    submenu: [
      { role: 'reload', label: T('Ricarica'), accelerator: 'CmdOrCtrl+Shift+R' },
      { role: 'toggleDevTools', label: T('Strumenti per sviluppatori'), accelerator: 'Alt+CmdOrCtrl+I' },
      sep,
      { role: 'resetZoom', label: T('Dimensioni reali') },
      { role: 'zoomIn', label: T('Ingrandisci') },
      { role: 'zoomOut', label: T('Riduci') },
      sep,
      { role: 'togglefullscreen', label: T('Schermo intero'), accelerator: isMac ? 'Ctrl+Cmd+F' : 'Ctrl+Shift+F' },
    ],
  });

  template.push({
    label: T('Finestra'),
    ...(isMac ? { role: 'window' } : {}),
    submenu: isMac
      ? [
          { role: 'minimize', label: T('Contrai') },
          { role: 'zoom', label: T('Ridimensiona') },
          sep,
          { role: 'front', label: T('Porta tutto in primo piano') },
          sep,
          { role: 'close', label: T('Chiudi finestra') },
        ]
      : [
          { role: 'minimize', label: T('Riduci a icona') },
          { role: 'close', label: T('Chiudi finestra') },
        ],
  });

  template.push({
    label: T('Aiuto'),
    ...(isMac ? { role: 'help' } : {}),
    submenu: [
      ...HELP_LINKS.map(l => ({ label: T(l.label), click: () => shell.openExternal(l.url) })),
      ...(isMac ? [] : [sep, { label: T('Informazioni su Ritmo Studio'), click: showAbout }]),
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- App lifecycle ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  const aboutPanel = () => app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    version: '',
    copyright: 'Copyright © 2026 Ritmo Studio — ' + T('Licenza MIT'),
    credits: T('DAW gratuita: Channel Rack, Piano Roll, Playlist e Mixer'),
  });
  // The page reports the interface language it uses; menus and dialogs follow it.
  ipcMain.on('i18n:lang', (_event, code) => {
    if (typeof code !== 'string' || code === getLang()) return;
    setLang(code);
    aboutPanel();
    buildMenu();
  });

  app.whenReady().then(() => {
    setLang(systemLang(app.getPreferredSystemLanguages()));
    aboutPanel();
    setupSession();
    buildMenu();
    createWindow();
    engineBridge.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  app.on('before-quit', () => engineBridge.stop());
}
