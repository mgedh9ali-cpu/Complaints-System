'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updateStatus', Object.freeze({
  subscribe(listener) {
    ipcRenderer.on('complaints:update-status', (_event, status) => listener(status));
  },
  submitToken(token) { return ipcRenderer.invoke('complaints:update-token', token); }
}));
