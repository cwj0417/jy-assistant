const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getDraftPath: () => ipcRenderer.invoke('get-draft-path'),
  setDraftPath: (path) => ipcRenderer.invoke('set-draft-path', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  downloadAndExtract: (apiKey, draftId) => ipcRenderer.invoke('download-and-extract', { apiKey, draftId }),
  checkUpdate: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_, data) => callback(data));
  },
});
