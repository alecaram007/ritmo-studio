'use strict';
// Exposes the native audio engine to the page as window.ritmoNative, only when the engine is bundled
// with this build. Without it the page keeps its own Web Audio engine.
const { contextBridge, ipcRenderer } = require('electron');

if (ipcRenderer.sendSync('engine:available')) {
  contextBridge.exposeInMainWorld('ritmoNative', {
    platform: process.platform,
    send: msg => ipcRenderer.send('engine:send', msg),
    onMessage: cb => {
      const handler = (_event, msg) => cb(msg);
      ipcRenderer.on('engine:msg', handler);
      return () => ipcRenderer.removeListener('engine:msg', handler);
    },
    saveDialog: options => ipcRenderer.invoke('dialog:save', options),
  });
}

// Folders the user adds to the browser, and the presets folder (available with or without the native engine).
contextBridge.exposeInMainWorld('ritmoFiles', {
  roots: () => ipcRenderer.invoke('files:roots'),
  pick: () => ipcRenderer.invoke('files:pick'),
  remove: p => ipcRenderer.invoke('files:remove', p),
  list: dir => ipcRenderer.invoke('files:list', dir),
  read: p => ipcRenderer.invoke('files:read', p),
  search: (q, limit) => ipcRenderer.invoke('files:search', q, limit),
  reveal: p => ipcRenderer.invoke('files:reveal', p),
  presets: {
    list: () => ipcRenderer.invoke('presets:list'),
    save: (kind, name, json) => ipcRenderer.invoke('presets:save', kind, name, json),
    read: (kind, name) => ipcRenderer.invoke('presets:read', kind, name),
    remove: (kind, name) => ipcRenderer.invoke('presets:remove', kind, name),
  },
});
