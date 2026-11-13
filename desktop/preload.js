'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const commands = new Set(['choose-backup-directory', 'save-recovery-key', 'restore-complete', 'download-update', 'about', 'quit']);
contextBridge.exposeInMainWorld('complaintsDesktop', Object.freeze({
  runMaintenance(command) {
    if (!commands.has(command)) return Promise.reject(new Error('إجراء صيانة غير صالح.'));
    return ipcRenderer.invoke('complaints:maintenance', command);
  }
}));
