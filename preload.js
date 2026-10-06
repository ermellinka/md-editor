const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mdApi', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  openLink: url => ipcRenderer.invoke('file:open-link', url),
  openExternal: url => ipcRenderer.invoke('link:external', url),
  confirmClose: name => ipcRenderer.invoke('dialog:confirm-close', name),
  saveFile: data => ipcRenderer.invoke('dialog:save', data),
  finishClose: ready => ipcRenderer.invoke('window:finish-close', ready),
  onOpenPath: callback => ipcRenderer.on('open-path', (_event, data) => callback(data)),
  onRequestClose: callback => ipcRenderer.on('request-close', () => callback())
});
