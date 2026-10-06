const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mdApi', {
  openFile: () => ipcRenderer.invoke('test:open'),
  openLink: url => ipcRenderer.invoke('test:link', url),
  openExternal: url => ipcRenderer.invoke('test:external', url),
  confirmClose: () => ipcRenderer.invoke('test:confirm'),
  saveFile: data => ipcRenderer.invoke('test:save', data),
  finishClose: ready => ipcRenderer.invoke('test:finish', ready),
  onOpenPath: callback => ipcRenderer.on('test:open-path', (_event, data) => callback(data)),
  onRequestClose: callback => ipcRenderer.on('test:request-close', () => callback())
});
