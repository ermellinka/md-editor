const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mdApi', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  confirmCloseTab: (tabName) => ipcRenderer.invoke('dialog:confirm-close-tab', tabName),
  saveFile: (filePath, content) => ipcRenderer.invoke('dialog:save', { filePath, content }),
  saveFileAs: (filePath, content) => ipcRenderer.invoke('dialog:saveAs', { filePath, content }),
  onOpenPath: (callback) => ipcRenderer.on('open-path', (_event, data) => callback(data)),
  onCheckUnsaved: (callback) => ipcRenderer.on('check-unsaved', callback),
  respondUnsaved: (isDirty) => ipcRenderer.send('unsaved-response', 