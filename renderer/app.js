/* MD Editor — rendering, toolbar, themes, and tab handling logic */

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const workspace = document.getElementById('workspace');
const statusFile = document.getElementById('status-file');
const statusStats = document.getElementById('status-stats');

marked.setOptions({ gfm: true, breaks: false });

/* ---------- Tab system ---------- */

let tabs = [];                    // array of all tabs
let currentTabId = null;          // id of the active tab
let nextTabId = 1;                // counter for generating ids
let welcomeTabId = null;          // id of the startup "Welcome" tab

const WELCOME_CONTENT = [
  '# Welcome to MD Editor!',
  '',
  'This is a **live preview**: type on the left, see the result on the right.',
  '',
  '## Features',
  '',
  '- Open and save `.md` files (📂 and 💾 or Ctrl+O / Ctrl+S)',
  '- Toolbar: select text and press **B**',
  '- Dark and light theme (🌙)',
  '- Three modes: editor / split / preview (◧)',
  '- **Tabs**: open several files at once',
  '',
  '| Try | tables |',
  '|---|---|',
  '| they | work too |',
  '',
  '> Happy writing!'
].join('\n');

function createTab(path = null, content = '', name = null) {
  const id = nextTabId++;
  const displayName = name || (path ? path.split(/[\\/]/).pop() : 'Untitled');

  tabs.push({
    id,
    path,
    name: displayName,
    content,
    isDirty: false
  });

  return id;
}

function getCurrentTab() {
  return tabs.find(t => t.id === currentTabId) || null;
}

function getTabIndex(id) {
  return tabs.findIndex(t => t.id === id);
}

function switchTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  // Save the current tab's content before switching
  const currentTab = getCurrentTab();
  if (currentTab) {
    currentTab.content = editor.value;
  }

  currentTabId = id;
  updateEditorFromTab();
  renderTabs();
  updateStatusBar();
}

function updateEditorFromTab() {
  const tab = getCurrentTab();
  if (tab) {
    editor.value = tab.content;
    editor.scrollTop = 0;
    render();
  }
}

async function closeTab(id) {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  // If the tab has unsaved changes, ask for confirmation via a native dialog.
  // window.confirm() is deliberately avoided: after Electron's blocking
  // dialogs, text inputs stop accepting the cursor (electron#19977).
  if (tab.isDirty) {
    const confirmClose = await window.mdApi.confirmCloseTab(tab.name);
    if (!confirmClose) return false;
  }

  // Recompute the index: tabs may have changed while the dialog was open
  const index = getTabIndex(id);
  if (index === -1) return;

  // Remove the tab
  tabs.splice(index, 1);

  // If it was the active tab, switch to another one
  if (currentTabId === id) {
    if (tabs.length > 0) {
      // If it wasn't the last one, switch to the next
      const newIndex = Math.min(index, tabs.length - 1);
      currentTabId = tabs[newIndex].id;
      updateEditorFromTab();
    } else {
      // If no tabs remain, create a new empty one
      currentTabId = createTab();
      updateEditorFromTab();
    }
  }

  renderTabs();
  updateStatusBar();
  return true;
}

function markTabDirty(id, isDirty = true) {
  const tab = tabs.find(t => t.id === id);
  if (tab) {
    tab.isDirty = isDirty;
    renderTabs();
    updateStatusBar();
  }
}

function updateCurrentTabContent() {
  const tab = getCurrentTab();
  if (tab) {
    tab.content = editor.value;
  }
}

function renderTabs() {
  const tabsList = document.getElementById('tabs-list');
  tabsList.innerHTML = '';

  tabs.forEach(tab => {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab' + (tab.id === currentTabId ? ' active' : '');
    tabEl.dataset.tabId = tab.id;

    // Dirty-state indicator
    const dirtySpan = document.createElement('span');
    dirtySpan.className = 'tab-dirty';
    dirtySpan.textContent = tab.isDirty ? '●' : '';
    tabEl.appendChild(dirtySpan);

    // Tab name
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-name';
    nameSpan.textContent = tab.name;
    nameSpan.title = tab.path || 'Untitled';
    tabEl.appendChild(nameSpan);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(tab.id);
    });
    tabEl.appendChild(closeBtn);

    // Click on the tab
    tabEl.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        switchTab(tab.id);
      }
    });

    // Double-click - does nothing for now, functionality can be added later
    tabEl.addEventListener('dblclick', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        e.stopPropagation();
      }
    });

    tabsList.appendChild(tabEl);
  });
}

function updateStatusBar() {
  const tab = getCurrentTab();
  if (tab) {
    const displayPath = tab.path || 'New file';
    const displayName = tab.name;
    statusFile.textContent = (tab.isDirty ? '● ' : '') + displayPath;
    document.title = `${tab.isDirty ? '● ' : ''}${displayName} — MD Editor`;
  }
}

/* ---------- Preview rendering (debounced) ---------- */

let renderTimer = null;

function render() {
  const html = marked.parse(editor.value);
  preview.innerHTML = DOMPurify.sanitize(html);
  updateStats();
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 120);
}

function updateStats() {
  const text = editor.value;
  const words = (text.match(/[^\s]+/g) || []).length;
  statusStats.textContent = `${words} words · ${text.length} characters`;
}

editor.addEventListener('input', () => {
  updateCurrentTabContent();
  markTabDirty(currentTabId, true);
  scheduleRender();
});

/* ---------- Synced scrolling (proportional) ---------- */

let syncing = false;

editor.addEventListener('scroll', () => {
  if (syncing) { syncing = false; return; }
  const ratio = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
  syncing = true;
  preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
});

preview.addEventListener('scroll', () => {
  if (syncing) { syncing = false; return; }
  const ratio = preview.scrollTop / Math.max(1, preview.scrollHeight - preview.clientHeight);
  syncing = true;
  editor.scrollTop = ratio * (editor.scrollHeight - editor.clientHeight);
});

/* ---------- Inserting markdown syntax ---------- */

function surround(before, after, placeholder) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || placeholder;
  const insert = before + selected + after;
  editor.setRangeText(insert, start, end, 'end');
  if (!editor.value.slice(start, end).length) {
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + selected.length;
  }
  editor.focus();
  updateCurrentTabContent();
  markTabDirty(currentTabId, true);
  scheduleRender();
}

function linePrefix(prefix, numbered) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const prefixed = lines
    .map((line, i) => (numbered ? `${i + 1}. ` : prefix) + line)
    .join('\n');
  editor.setRangeText(prefixed, lineStart, lineEnd, 'end');
  editor.focus();
  updateCurrentTabContent();
  markTabDirty(currentTabId, true);
  scheduleRender();
}

const TABLE_TEMPLATE =
  '\n| Column 1 | Column 2 | Column 3 |\n' +
  '|---|---|---|\n' +
  '| text | text | text |\n' +
  '| text | text | text |\n';

const actions = {
  bold: () => surround('**', '**', 'bold text'),
  italic: () => surround('*', '*', 'italic'),
  strike: () => surround('~~', '~~', 'strikethrough'),
  code: () => surround('`', '`', 'code'),
  h1: () => linePrefix('# '),
  h2: () => linePrefix('## '),
  h3: () => linePrefix('### '),
  ul: () => linePrefix('- '),
  ol: () => linePrefix('', true),
  quote: () => linePrefix('> '),
  link: () => surround('[', '](https://)', 'link text'),
  hr: () => surround('\n\n---\n\n', '', ''),
  table: () => surround(TABLE_TEMPLATE, '', '')
};

document.querySelectorAll('#toolbar button[data-md]').forEach((btn) => {
  btn.addEventListener('click', () => actions[btn.dataset.md]());
});

/* ---------- File and tab handling ---------- */

function createNewTab() {
  const id = createTab(null, '', 'Untitled');
  switchTab(id);
}

async function openFileInNewTab() {
  const result = await window.mdApi.openFile();
  if (result) {
    const id = createTab(result.path, result.content, result.path.split(/[\\/]/).pop());
    switchTab(id);
  }
}

async function saveCurrentFile() {
  const tab = getCurrentTab();
  if (!tab) return;

  updateCurrentTabContent();
  const savedPath = await window.mdApi.saveFile(tab.path, tab.content);

  if (savedPath) {
    tab.path = savedPath;
    tab.name = savedPath.split(/[\\/]/).pop();
    tab.isDirty = false;
    renderTabs();
    updateStatusBar();
  }
}

async function saveCurrentFileAs() {
  const tab = getCurrentTab();
  if (!tab) return;

  updateCurrentTabContent();
  const savedPath = await window.mdApi.saveFileAs(tab.path, tab.content);

  if (savedPath) {
    tab.path = savedPath;
    tab.name = savedPath.split(/[\\/]/).pop();
    tab.isDirty = false;
    renderTabs();
    updateStatusBar();
  }
}

document.getElementById('btn-new-tab').addEventListener('click', createNewTab);
document.getElementById('btn-open').addEventListener('click', openFileInNewTab);
document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
document.getElementById('btn-save-as').addEventListener('click', saveCurrentFileAs);
document.getElementById('tabs-new-btn').addEventListener('click', createNewTab);

// File opened via double-click / second launch - open it in a new tab
window.mdApi.onOpenPath(({ path, content }) => {
  const id = createTab(path, content, path.split(/[\\/]/).pop());
  switchTab(id);

  // Remove the untouched startup "Welcome" tab if it's still open
  if (welcomeTabId !== null) {
    const welcome = tabs.find(t => t.id === welcomeTabId);
    if (welcome && !welcome.isDirty) {
      const index = getTabIndex(welcomeTabId);
      if (index !== -1) tabs.splice(index, 1);
    }
    welcomeTabId = null;
    renderTabs();
    updateStatusBar();
  }
});

// Handle the main process's request about unsaved changes
window.mdApi.onCheckUnsaved(() => {
  const hasUnsaved = tabs.some(t => t.isDirty);
  window.mdApi.respondUnsaved(hasUnsaved);
});

// Handle the save-before-close signal: save ALL dirty tabs, then close.
// If the user cancels a "Save as" dialog for any tab, the close is aborted.
window.mdApi.onSaveAndClose(async () => {
  updateCurrentTabContent();

  for (const tab of tabs) {
    if (!tab.isDirty) continue;
    const savedPath = await window.mdApi.saveFile(tab.path, tab.content);
    if (!savedPath) {
      // User cancelled the save dialog - abort closing
      renderTabs();
      updateStatusBar();
      return;
    }
    tab.path = savedPath;
    tab.name = savedPath.split(/[\\/]/).pop();
    tab.isDirty = false;
  }

  renderTabs();
  updateStatusBar();
  window.close();
});

/* ---------- Display modes and theme ---------- */

const MODES = ['split', 'editor-only', 'preview-only'];
let modeIndex = 2; // Default: preview-only
const toolbar = document.getElementById('toolbar');

function setMode(index) {
  modeIndex = index;
  workspace.className = MODES[modeIndex];
  toolbar.classList.toggle('preview-only', MODES[modeIndex] === 'preview-only');
  // When editing becomes available, put the cursor in the editor
  if (MODES[modeIndex] !== 'preview-only') editor.focus();
}

document.getElementById('btn-edit').addEventListener('click', () => {
  setMode(0);
});

document.getElementById('btn-mode').addEventListener('click', () => {
  setMode((modeIndex + 1) % MODES.length);
});

setMode(modeIndex);

const themeBtn = document.getElementById('btn-theme');

function applyTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('theme', theme);
}

themeBtn.addEventListener('click', () => {
  applyTheme(document.body.classList.contains('dark') ? 'light' : 'dark');
});

applyTheme(localStorage.getItem('theme') || 'dark');

/* ---------- Hotkeys ---------- */

document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 's' && e.shiftKey) { e.preventDefault(); saveCurrentFileAs(); }
  else if (key === 's') { e.preventDefault(); saveCurrentFile(); }
  else if (key === 'o') { e.preventDefault(); openFileInNewTab(); }
  else if (key === 'n') { e.preventDefault(); createNewTab(); }
  else if (key === 'b') { e.preventDefault(); actions.bold(); }
  else if (key === 'i') { e.preventDefault(); actions.italic(); }
});

/* ---------- Initialization ---------- */

// Create the first tab with the welcome content.
// If the app is launched with a file, main will send open-path and this tab
// will be removed automatically (see the onOpenPath handler above).
currentTabId = createTab(null, WELCOME_CONTENT, 'Welcome');
welcomeTabId = currentTabId;
updateEditorFromTab();
renderTabs();
updateStatusBar();
