const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { readDocument, writeDocument, fileKey } = require('./file-store');
let win = null;
let closing = false;
let allowClose = false;
function fileFromArgv(argv) {
  return argv.slice(1).find(a => /\.(md|markdown|txt)$/i.test(a) && fs.existsSync(a)) || null;
}
async function openPath(filePath) {
  try { win?.webContents.send('open-path', await readDocument(filePath)); }
  catch (error) { if (win) await dialog.showMessageBox(win, { type: 'error', message: 'Could not open file', detail: error.message }); }
}
function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 700, minHeight: 400, backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  Menu.setApplicationMenu(null);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.once('did-finish-load', () => { const file = fileFromArgv(process.argv); if (file) openPath(file); });
  win.on('close', event => {
    if (allowClose) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    win.webContents.send('request-close');
  });
  win.on('closed', () => { win = null; closing = false; allowClose = false; });
}
function handle(channel, action) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return { error: 'Invalid request' };
    try { return await action(...args); } catch (error) { return { error: error.message }; }
  });
}
handle('dialog:confirm-close', async name => {
  const result = await dialog.showMessageBox(win, { type: 'question', buttons: ['Save', "Don't save", 'Cancel'], defaultId: 0, cancelId: 2,
    title: 'Unsaved changes', message: name ? `Save changes to "${name}"?` : 'Save changes to all modified tabs?' });
  return ['save', 'discard', 'cancel'][result.response];
});
handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Open Markdown file', filters: [{ name: 'Markdown', extensions: ['md','markdown','txt'] }, { name: 'All files', extensions: ['*'] }], properties: ['openFile'] });
  return result.canceled ? null : readDocument(result.filePaths[0]);
});
handle('file:open-link', async url => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'file:') throw new Error('Only local Markdown files can be opened here.');
  const target = fileURLToPath(parsed);
  if (!/\.(md|markdown|txt)$/i.test(target)) throw new Error('This link is not a Markdown or text document.');
  return readDocument(target);
});
handle('link:external', async url => {
  if (!['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) throw new Error('Unsupported link protocol.');
  await shell.openExternal(url);
  return true;
});
handle('dialog:save', async ({ filePath, content, expectedContent, saveAs }) => {
  if (typeof content !== 'string') throw new Error('Invalid document content.');
  let target = filePath;
  if (!target || saveAs) {
    const result = await dialog.showSaveDialog(win, { title: 'Save as', defaultPath: target || 'untitled.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  const expected = filePath && fileKey(target) === fileKey(filePath) ? expectedContent : undefined;
  return writeDocument(target, content, expected);
});
handle('window:finish-close', ready => {
  closing = false;
  if (ready) { allowClose = true; win.close(); }
  return true;
});
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const file = fileFromArgv(argv); if (file) openPath(file);
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
