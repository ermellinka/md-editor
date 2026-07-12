const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('fs');
const path = require('path');

let win = null;

// File passed at launch (double-click on .md when the association is set up)
function fileFromArgv(argv) {
  const candidate = argv.slice(1).find((a) => a.toLowerCase().endsWith('.md') && fs.existsSync(a));
  return candidate || null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 700,
    minHeight: 400,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null); // all actions live in the toolbar and hotkeys

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.webContents.on('did-finish-load', () => {
    const startFile = fileFromArgv(process.argv);
    if (startFile) {
      win.webContents.send('open-path', {
        path: startFile,
        content: fs.readFileSync(startFile, 'utf-8')
      });
    }
  });

  // Confirm closing when there are unsaved changes.
  // The close must be prevented synchronously: the unsaved-changes check is an
  // async round-trip to the renderer, and the window would otherwise be gone
  // before the response arrives.
  let allowClose = false;
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();

    win.webContents.send('check-unsaved');
    ipcMain.once('unsaved-response', (_event, isDirty) => {
      if (!win) return;

      if (!isDirty) {
        allowClose = true;
        win.close();
        return;
      }

      const choice = dialog.showMessageBoxSync(win, {
        type: 'question',
        buttons: ['Save', 'Don\'t save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Do you want to save them?'
      });

      if (choice === 0) {
        // Save: the renderer saves all dirty tabs, then closes the window itself
        win.webContents.send('save-and-close');
      } else if (choice === 1) {
        // Don't save
        allowClose = true;
        win.close();
      }
      // Cancel: do nothing, the window stays open
    });
  });

  win.on('closed', () => {
    win = null;
  });
}

// ---------- IPC ----------

// Confirm closing a tab with unsaved changes.
// window.confirm() must NOT be used in the renderer: after Electron's blocking
// dialogs (alert/confirm) the window loses its focus state and text inputs
// stop accepting the cursor until the window is refocused.
ipcMain.handle('dialog:confirm-close-tab', async (_event, tabName) => {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Close without saving', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    title: 'Unsaved changes',
    message: `Tab "${tabName}" has unsaved changes.`,
    detail: 'Close without saving?'
  });
  return result.response === 0;
});

ipcMain.handle('dialog:open', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Markdown file',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'All files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  return { path: filePath, content: fs.readFileSync(filePath, 'utf-8') };
});

// Save: if path is empty, show the "Save as" dialog
ipcMain.handle('dialog:save', async (_event, { filePath, content }) => {
  let target = filePath;
  if (!target) {
    const result = await dialog.showSaveDialog(win, {
      title: 'Save as',
      defaultPath: 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  fs.writeFileSync(target, content, 'utf-8');
  return target;
});

ipcMain.handle('dialog:saveAs', async (_event, { filePath, content }) => {
  const result = await dialog.showSaveDialog(win, {
    title: 'Save as',
    defaultPath: filePath || 'untitled.md',
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  });
  if (result.canceled || !result.filePath) return null;
  fs.writeFileSync(result.filePath, content, 'utf-8');
  return result.filePath;
});

// ---------- Lifecycle ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // A second double-click on a .md file — open it i