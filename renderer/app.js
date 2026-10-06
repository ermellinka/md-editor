/* Document state, commands and workspace interactions. Source mapping lives in source-preview.js. */
const $ = id => document.getElementById(id);
const editor = $('editor'), preview = $('preview'), workspace = $('workspace'), backdrop = $('editor-backdrop');
const MODES = ['split', 'editor-only', 'preview-only'];
let tabs = [], currentTabId = null, nextTabId = 1, blocks = [], mode = 'split';
let renderTimer, sessionTimer, selectionFrame, scrollFrame, scrollLock = false, closing = false;
let scrollAnchors = null;
let mirroredSelection = null, lastInputAt = 0;
const WELCOME = '# Welcome to MD Editor!\n\nSelect text in either pane to highlight its counterpart.\n\n## Writing\n\n- **Bold**, *italic*, and `code`\n- Ctrl+F to find, Ctrl+H to replace\n- Ctrl+S to save, Ctrl+W to close a tab\n\n## A table\n\n| Markdown | Preview |\n|---|---|\n| Select here | See it there |\n\n> Your tabs and drafts are restored when you reopen the editor.\n';
marked.setOptions({ gfm: true, breaks: false });
function notify(message) { $('notice-text').textContent = message; $('notice').hidden = !message; }
$('notice-close').onclick = () => notify('');
async function request(promise) {
  try { const result = await promise; if (result?.error) throw new Error(result.error); return result; }
  catch (error) { notify(error.message); return null; }
}
function current() { return tabs.find(tab => tab.id === currentTabId); }
function dirty(tab) { return tab.content !== tab.savedContent; }
function nameFor(filePath) { return filePath?.split(/[\\/]/).pop() || 'Untitled'; }
function createTab(data = {}) {
  const tab = { id: nextTabId++, path: null, key: null, baseUrl: null, content: '', savedContent: '', start: 0, end: 0, editorTop: 0, editorLeft: 0, previewTop: 0, history: [], future: [], ...data };
  tabs.push(tab); return tab;
}
function remember() {
  const tab = current(); if (!tab) return;
  tab.content = editor.value; tab.start = editor.selectionStart; tab.end = editor.selectionEnd;
  tab.editorTop = editor.scrollTop; tab.editorLeft = editor.scrollLeft; tab.previewTop = preview.scrollTop;
}
function persist() {
  clearTimeout(sessionTimer); remember();
  try {
    localStorage.setItem('md-session-v1', JSON.stringify({ active: currentTabId, mode, tabs: tabs.map(({ history, future, saving, asking, before, ...tab }) => tab) }));
  } catch { notify('Draft recovery could not be updated. Please save your documents to disk.'); }
}
function scheduleSession() { clearTimeout(sessionTimer); sessionTimer = setTimeout(persist, 400); }
function renderTabs() {
  $('tabs-list').replaceChildren();
  for (const tab of tabs) {
    const item = document.createElement('div'); item.className = 'tab' + (tab.id === currentTabId ? ' active' : ''); item.setAttribute('role', 'tab'); item.setAttribute('aria-selected', tab.id === currentTabId); item.tabIndex = tab.id === currentTabId ? 0 : -1;
    const label = document.createElement('span'); label.className = 'tab-name'; label.textContent = (dirty(tab) ? '● ' : '') + (tab.name || nameFor(tab.path)); label.title = tab.path || 'Untitled';
    const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', `Close ${tab.name || nameFor(tab.path)}`);
    close.onclick = event => { event.stopPropagation(); closeTab(tab.id); }; item.onclick = () => switchTab(tab.id);
    item.onkeydown = event => { if (event.key === 'Enter') switchTab(tab.id); };
    item.append(label, close); $('tabs-list').append(item);
  }
  const tab = current();
  $('status-file').textContent = tab ? (dirty(tab) ? '● ' : '') + (tab.path || tab.name || 'New file') : '';
  document.title = `${tab && dirty(tab) ? '● ' : ''}${tab?.name || nameFor(tab?.path)} — MD Editor`;
}
function switchTab(id) {
  if (closing || id === currentTabId) return;
  remember(); clearTimeout(renderTimer); lastInputAt = 0; currentTabId = id; const tab = current(); if (!tab) return;
  mirroredSelection = null; editor.value = tab.content; editor.setSelectionRange(tab.start, tab.end);
  render(); renderTabs();
  withScrollLock(() => { editor.scrollTop = tab.editorTop; editor.scrollLeft = tab.editorLeft; preview.scrollTop = tab.previewTop; syncBackdrop(); });
  scheduleSession();
}
function openDocument(data) {
  if (!data || closing) return;
  const existing = tabs.find(tab => tab.key && tab.key === data.key);
  if (existing) { switchTab(existing.id); return; }
  const welcome = tabs.find(tab => tab.welcome && !dirty(tab));
  const tab = createTab({ ...data, savedContent: data.content }); switchTab(tab.id);
  if (welcome) { tabs = tabs.filter(item => item.id !== welcome.id); renderTabs(); }
  scheduleSession();
}
async function saveTab(tab, saveAs = false) {
  if (tab.saving) return tab.saving;
  const snapshot = tab.content;
  tab.saving = (async () => {
    const result = await request(window.mdApi.saveFile({ filePath: tab.path, content: snapshot, expectedContent: tab.path ? tab.savedContent : undefined, saveAs }));
    if (!result) return false;
    tab.path = result.path; tab.key = result.key; tab.baseUrl = result.baseUrl; tab.name = null; tab.welcome = false; tab.savedContent = snapshot;
    const duplicate = tabs.find(other => other !== tab && other.key === tab.key);
    if (duplicate) notify('This path is also open in another tab. That tab keeps its own changes; saving an outdated version will be blocked.');
    renderTabs(); if (tab === current()) render(); persist(); return !dirty(tab);
  })();
  try { return await tab.saving; } finally { delete tab.saving; }
}
async function closeTab(id) {
  if (closing) return; const tab = tabs.find(item => item.id === id); if (!tab || tab.asking) return;
  tab.asking = true;
  try {
    if (dirty(tab)) {
      const choice = await request(window.mdApi.confirmClose(tab.name || nameFor(tab.path)));
      if (!choice || choice === 'cancel' || (choice === 'save' && !await saveTab(tab))) return;
    }
    const index = tabs.indexOf(tab); tabs.splice(index, 1);
    if (currentTabId === id) { currentTabId = null; switchTab((tabs[Math.min(index, tabs.length - 1)] || createTab()).id); }
    renderTabs(); persist();
  } finally { delete tab.asking; }
}
function rebuildBackdrop() {
  const value = editor.value, range = mirroredSelection;
  backdrop.replaceChildren();
  if (range && range.end > range.start) {
    backdrop.append(document.createTextNode(value.slice(0, range.start)));
    const mark = document.createElement('mark'); mark.textContent = value.slice(range.start, range.end); backdrop.append(mark, document.createTextNode(value.slice(range.end) + '\n'));
  } else backdrop.textContent = value + '\n';
  syncBackdrop();
}
function syncBackdrop() { backdrop.scrollTop = editor.scrollTop; backdrop.scrollLeft = editor.scrollLeft; }
function sourcePoint(offset) {
  const walker = document.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT); let node, remaining = offset;
  while ((node = walker.nextNode())) { if (remaining <= node.length) return { node, offset: remaining }; remaining -= node.length; }
  return null;
}
function sourceY(offset) {
  const point = sourcePoint(offset); if (!point) return 0;
  const range = document.createRange(); range.setStart(point.node, point.offset); range.collapse(true);
  const rect = range.getBoundingClientRect(); return rect.top - backdrop.getBoundingClientRect().top + backdrop.scrollTop;
}
function previewY(block) { return block.element.getBoundingClientRect().top - preview.getBoundingClientRect().top + preview.scrollTop; }
function withScrollLock(action) {
  scrollLock = true; cancelAnimationFrame(scrollFrame); action();
  scrollFrame = requestAnimationFrame(() => { scrollFrame = requestAnimationFrame(() => { scrollLock = false; }); });
}
function syncScroll(origin) {
  if (scrollLock || mode !== 'split' || !$('sync-scroll').checked || !blocks.length) return;
  const source = origin === editor;
  if (!scrollAnchors) scrollAnchors = { source: blocks.map(block => sourceY(block.start)), preview: blocks.map(previewY) };
  const from = [...(source ? scrollAnchors.source : scrollAnchors.preview)];
  const to = [...(source ? scrollAnchors.preview : scrollAnchors.source)];
  const other = source ? preview : editor;
  if (origin.scrollTop <= 0 || origin.scrollTop >= origin.scrollHeight - origin.clientHeight - 1) {
    withScrollLock(() => { other.scrollTop = origin.scrollTop <= 0 ? 0 : other.scrollHeight; syncBackdrop(); }); return;
  }
  from.push(Math.max(origin.scrollHeight - origin.clientHeight, from.at(-1) + 1));
  to.push(Math.max(other.scrollHeight - other.clientHeight, to.at(-1) + 1));
  let index = 0;
  while (index < blocks.length - 1 && from[index + 1] <= origin.scrollTop) index++;
  const fraction = Math.max(0, Math.min(1, (origin.scrollTop - from[index]) / Math.max(1, from[index + 1] - from[index])));
  withScrollLock(() => { other.scrollTop = Math.max(0, to[index] + fraction * (to[index + 1] - to[index])); syncBackdrop(); });
}
editor.addEventListener('scroll', () => { syncBackdrop(); syncScroll(editor); scheduleSession(); });
preview.addEventListener('scroll', () => { syncScroll(preview); scheduleSession(); });
function clearHighlights() {
  CSS.highlights?.delete('source-selection');
  preview.querySelectorAll('.corresponding').forEach(node => node.classList.remove('corresponding'));
}
function revealPreview(element) {
  const rect = element.getBoundingClientRect(), viewport = preview.getBoundingClientRect();
  if (rect.bottom < viewport.top || rect.top > viewport.bottom) withScrollLock(() => { preview.scrollTop += rect.top - viewport.top - 35; });
}
function highlightSourceSelection() {
  if (mode !== 'split' || document.activeElement !== editor) return;
  clearHighlights(); mirroredSelection = null; rebuildBackdrop();
  const start = editor.selectionStart, end = editor.selectionEnd; if (start === end) return;
  const ranges = []; let first;
  for (const leaf of preview.querySelectorAll('[data-source-leaf]')) {
    const positions = leaf.sourcePositions; if (!positions || leaf.firstChild?.nodeType !== Node.TEXT_NODE) continue;
    const from = positions.findIndex(position => position.end > start && position.start < end);
    if (from < 0) continue;
    let to = from + 1; while (to < positions.length && positions[to].start < end) to++;
    const range = document.createRange(); range.setStart(leaf.firstChild, from); range.setEnd(leaf.firstChild, to); ranges.push(range); first ||= leaf;
  }
  if (ranges.length && CSS.highlights) CSS.highlights.set('source-selection', new Highlight(...ranges));
  else for (const block of blocks) if (block.start < end && block.end > start) { block.element.classList.add('corresponding'); first ||= block.element; }
  if (first) revealPreview(first);
}
function queueSelection() { cancelAnimationFrame(selectionFrame); selectionFrame = requestAnimationFrame(() => { updateStats(); highlightSourceSelection(); }); }
editor.addEventListener('select', queueSelection);
editor.addEventListener('keyup', queueSelection);
editor.addEventListener('pointerup', queueSelection);
editor.addEventListener('focus', () => { mirroredSelection = null; rebuildBackdrop(); queueSelection(); });
document.addEventListener('selectionchange', () => {
  if (document.activeElement === editor) { queueSelection(); return; }
  if (mode !== 'split') return;
  const selection = document.getSelection();
  if (!selection.rangeCount || selection.isCollapsed) {
    if (preview.contains(selection.anchorNode)) { mirroredSelection = null; rebuildBackdrop(); clearHighlights(); }
    return;
  }
  const range = selection.getRangeAt(0); if (!preview.contains(range.commonAncestorContainer)) return;
  clearHighlights(); let firstPosition = Infinity, lastPosition = -1;
  for (const leaf of preview.querySelectorAll('[data-source-leaf]')) {
    const node = leaf.firstChild; if (!leaf.sourcePositions || !node || !range.intersectsNode(node)) continue;
    const from = range.startContainer === node ? range.startOffset : 0;
    const to = range.endContainer === node ? range.endOffset : node.length;
    for (let index = from; index < to; index++) {
      const position = leaf.sourcePositions[index];
      if (position) { firstPosition = Math.min(firstPosition, position.start); lastPosition = Math.max(lastPosition, position.end); }
    }
  }
  if (lastPosition >= 0) mirroredSelection = { start: firstPosition, end: lastPosition };
  else {
    const touched = blocks.filter(block => range.intersectsNode(block.element));
    if (!touched.length) return;
    mirroredSelection = { start: touched[0].start, end: touched.at(-1).end };
  }
  rebuildBackdrop();
  const top = sourceY(mirroredSelection.start);
  if (top < editor.scrollTop || top > editor.scrollTop + editor.clientHeight - 25) withScrollLock(() => { editor.scrollTop = Math.max(0, top - 35); syncBackdrop(); });
});
function render() {
  clearTimeout(renderTimer); const top = preview.scrollTop;
  blocks = SourcePreview.render(editor.value, preview, current()?.baseUrl);
  scrollAnchors = null;
  preview.scrollTop = top; rebuildBackdrop(); updateStats(); updateOutline(); updateSearch(false); queueSelection();
}
function updateStats() {
  const prefix = editor.value.slice(0, editor.selectionStart);
  $('status-stats').textContent = `Ln ${prefix.split('\n').length}, Col ${prefix.length - prefix.lastIndexOf('\n')} · ${(editor.value.match(/\S+/g) || []).length} words · ${editor.value.length} characters`;
}
function recordChange(before, start, end, group = false) {
  const tab = current(); if (!tab) return;
  const now = Date.now();
  if (!group || now - lastInputAt > 700 || !tab.history.length) {
    tab.history.push({ content: before, start, end }); if (tab.history.length > 150) tab.history.shift();
  }
  lastInputAt = group ? now : 0; tab.future = [];
}
function changed() {
  const tab = current(), wasDirty = dirty(tab);
  tab.content = editor.value; scrollAnchors = null; mirroredSelection = null; rebuildBackdrop();
  if (dirty(tab) !== wasDirty) renderTabs();
  updateStats();
  clearTimeout(renderTimer); renderTimer = setTimeout(render, 120); scheduleSession();
}
editor.addEventListener('beforeinput', () => { const tab = current(); tab.before = { start: editor.selectionStart, end: editor.selectionEnd }; });
editor.addEventListener('input', event => { const tab = current(); recordChange(tab.content, tab.before?.start || 0, tab.before?.end || 0, event.inputType === 'insertText'); changed(); });
editor.addEventListener('click', updateStats);
function replaceRange(text, start = editor.selectionStart, end = editor.selectionEnd, selectStart = start + text.length, selectEnd = selectStart) {
  recordChange(editor.value, editor.selectionStart, editor.selectionEnd);
  editor.setRangeText(text, start, end, 'end'); editor.setSelectionRange(selectStart, selectEnd); changed(); editor.focus();
}
function undo(redo = false) {
  const tab = current(), from = redo ? tab.future : tab.history, to = redo ? tab.history : tab.future;
  const entry = from.pop(); if (!entry) return;
  to.push({ content: editor.value, start: editor.selectionStart, end: editor.selectionEnd });
  editor.value = entry.content; editor.setSelectionRange(entry.start, entry.end); lastInputAt = 0; changed();
}
function surround(before, after, placeholder = '') {
  const start = editor.selectionStart, end = editor.selectionEnd;
  const selected = editor.value.slice(start, end) || placeholder;
  replaceRange(before + selected + after, start, end, start + before.length, start + before.length + selected.length);
}
function prefixLines(prefix, numbered = false) {
  const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
  const selectionEnd = editor.selectionEnd > editor.selectionStart && editor.value[editor.selectionEnd - 1] === '\n' ? editor.selectionEnd - 1 : editor.selectionEnd;
  let end = editor.value.indexOf('\n', selectionEnd); if (end < 0) end = editor.value.length;
  const lines = editor.value.slice(start, end).split('\n');
  const remove = !numbered && lines.every(line => line.startsWith(prefix));
  const text = lines.map((line, i) => remove ? line.slice(prefix.length) : (numbered ? `${i + 1}. ` : prefix) + line).join('\n');
  replaceRange(text, start, end, start, start + text.length);
}
const actions = { bold: () => surround('**','**','bold text'), italic: () => surround('*','*','italic'), strike: () => surround('~~','~~','strikethrough'), code: () => surround('`','`','code'), h1: () => prefixLines('# '), h2: () => prefixLines('## '), h3: () => prefixLines('### '), ul: () => prefixLines('- '), ol: () => prefixLines('',true), quote: () => prefixLines('> '), link: () => surround('[','](https://)','link text'), hr: () => surround('\n\n---\n\n',''), table: () => surround('\n| Column 1 | Column 2 |\n|---|---|\n| text | text |\n','') };
document.querySelectorAll('[data-md]').forEach(button => { button.onmousedown = event => event.preventDefault(); button.onclick = () => { if (mode !== 'preview-only') actions[button.dataset.md](); }; });
function setMode(value) {
  mode = MODES.includes(value) ? value : 'split'; workspace.className = mode;
  $('toolbar').classList.toggle('preview-only', mode === 'preview-only'); $('btn-mode').textContent = { split: '◧ Split', 'editor-only': '✎ Editor', 'preview-only': '▣ Preview' }[mode];
  mirroredSelection = null; clearHighlights(); rebuildBackdrop(); scheduleSession();
}
$('btn-edit').onclick = () => { setMode('split'); editor.focus(); };
$('btn-mode').onclick = () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
function newTab() { if (closing) return; switchTab(createTab().id); setMode('split'); editor.focus(); }
$('btn-new-tab').onclick = $('tabs-new-btn').onclick = newTab;
$('btn-open').onclick = async () => openDocument(await request(window.mdApi.openFile()));
$('btn-save').onclick = () => { remember(); saveTab(current()); };
$('btn-save-as').onclick = () => { remember(); saveTab(current(), true); };
function theme(value) { document.body.classList.toggle('dark', value === 'dark'); $('btn-theme').textContent = value === 'dark' ? '☀️' : '🌙'; localStorage.setItem('theme', value); }
$('btn-theme').onclick = () => theme(document.body.classList.contains('dark') ? 'light' : 'dark');
$('sync-scroll').checked = localStorage.getItem('sync-scroll') !== 'false';
$('sync-scroll').onchange = () => localStorage.setItem('sync-scroll', $('sync-scroll').checked);
preview.addEventListener('click', async event => {
  const link = event.target.closest('a'); if (!link) return; event.preventDefault();
  if (!document.getSelection().isCollapsed) return;
  const href = link.getAttribute('href'); if (!href) return;
  try {
    if (href.startsWith('#')) { const target = preview.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`); if (target) target.scrollIntoView({ block: 'start' }); return; }
    const url = new URL(href, current()?.baseUrl || undefined);
    if (url.protocol === 'file:') { const hash = url.hash; url.hash = ''; const data = await request(window.mdApi.openLink(url.href)); openDocument(data); if (data && hash) preview.querySelector(`[id="${CSS.escape(decodeURIComponent(hash.slice(1)))}"]`)?.scrollIntoView(); }
    else await request(window.mdApi.openExternal(url.href));
  } catch { notify('Save this document first to use relative links, or check the link address.'); }
});
function updateOutline() {
  $('outline-list').replaceChildren();
  for (const heading of preview.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    const button = document.createElement('button'); button.textContent = heading.textContent; button.style.paddingLeft = `${10 + (Number(heading.tagName[1]) - 1) * 10}px`;
    button.onclick = () => { const block = blocks.find(item => item.element.contains(heading)); withScrollLock(() => { preview.scrollTop += heading.getBoundingClientRect().top - preview.getBoundingClientRect().top; editor.scrollTop = sourceY(block.start); syncBackdrop(); }); };
    $('outline-list').append(button);
  }
}
$('btn-outline').onclick = () => { $('outline').hidden = !$('outline').hidden; };
let matches = [], matchIndex = -1;
function updateSearch(reveal = true) {
  const query = $('find-input').value; matches = [];
  if (query) {
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    for (const match of editor.value.matchAll(pattern)) matches.push({ start: match.index, end: match.index + match[0].length });
  }
  if (matchIndex >= matches.length) matchIndex = matches.length - 1;
  if (matchIndex < 0 && matches.length) matchIndex = 0;
  $('find-count').textContent = `${matches.length ? matchIndex + 1 : 0} / ${matches.length}`;
  if (reveal) revealMatch();
}
function revealMatch() {
  const match = matches[matchIndex]; if (!match) return;
  mirroredSelection = match; rebuildBackdrop(); withScrollLock(() => { editor.scrollTop = Math.max(0, sourceY(match.start) - 45); syncBackdrop(); });
  const block = blocks.find(item => item.start <= match.start && item.end > match.start); clearHighlights(); if (block) { block.element.classList.add('corresponding'); revealPreview(block.element); }
}
function showSearch(replace = false) { $('searchbar').hidden = false; $('replace-row').hidden = !replace; if (replace && mode === 'preview-only') setMode('split'); $('find-input').focus(); $('find-input').select(); updateSearch(); }
$('btn-find').onclick = () => showSearch(); $('find-input').oninput = () => { matchIndex = 0; updateSearch(); };
function nextMatch(direction) { if (!matches.length) return; matchIndex = (matchIndex + direction + matches.length) % matches.length; updateSearch(); }
$('find-next').onclick = () => nextMatch(1); $('find-prev').onclick = () => nextMatch(-1);
$('find-input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); nextMatch(event.shiftKey ? -1 : 1); } };
$('find-close').onclick = () => { $('searchbar').hidden = true; mirroredSelection = null; rebuildBackdrop(); clearHighlights(); if (mode !== 'preview-only') editor.focus(); };
$('replace-one').onclick = () => { const match = matches[matchIndex]; if (!match) return; replaceRange($('replace-input').value, match.start, match.end); render(); updateSearch(); };
$('replace-all').onclick = () => { if (!matches.length) return; let text = editor.value; for (const match of [...matches].reverse()) text = text.slice(0, match.start) + $('replace-input').value + text.slice(match.end); replaceRange(text, 0, editor.value.length, 0, 0); render(); updateSearch(); };
const divider = $('divider');
function setSplit(percent) { const value = Math.max(20, Math.min(80, percent)); workspace.style.setProperty('--split-ratio', value / 100); divider.setAttribute('aria-valuenow', Math.round(value)); localStorage.setItem('split-width', value); }
setSplit(Number(localStorage.getItem('split-width')) || 50);
divider.onpointerdown = event => { divider.setPointerCapture(event.pointerId); divider.classList.add('dragging'); };
divider.onpointermove = event => { if (!divider.hasPointerCapture(event.pointerId)) return; const rect = workspace.getBoundingClientRect(); const outline = $('outline').hidden ? 0 : $('outline').offsetWidth; setSplit(100 * (event.clientX - rect.left - outline) / (rect.width - outline)); };
divider.onpointerup = event => { divider.releasePointerCapture(event.pointerId); divider.classList.remove('dragging'); };
divider.onkeydown = event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); setSplit(Number(divider.getAttribute('aria-valuenow')) + (event.key === 'ArrowLeft' ? -2 : 2)); } };
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('searchbar').hidden) { $('find-close').click(); return; }
  if (closing) return;
  const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
  if (command) {
    const global = { s: () => { remember(); saveTab(current(), event.shiftKey); }, o: () => $('btn-open').click(), n: newTab, w: () => closeTab(currentTabId), f: () => showSearch(), h: () => showSearch(true) };
    if (global[key]) { event.preventDefault(); global[key](); }
    else if (event.key === 'Tab') { event.preventDefault(); const index = tabs.indexOf(current()); switchTab(tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id); }
    else if (document.activeElement === editor && mode !== 'preview-only') {
      if (key === 'b' || key === 'i') { event.preventDefault(); actions[key === 'b' ? 'bold' : 'italic'](); }
      else if (key === 'z' || key === 'y') { event.preventDefault(); undo(key === 'y' || event.shiftKey); }
    }
    return;
  }
  if (document.activeElement !== editor || event.isComposing) return;
  if (event.key === 'Tab') {
    event.preventDefault();
    if (event.shiftKey || editor.selectionStart !== editor.selectionEnd) {
      const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
      const selectedEnd = editor.selectionEnd > editor.selectionStart && editor.value[editor.selectionEnd - 1] === '\n' ? editor.selectionEnd - 1 : editor.selectionEnd;
      let end = editor.value.indexOf('\n', selectedEnd); if (end < 0) end = editor.value.length;
      const text = editor.value.slice(start, end).split('\n').map(line => event.shiftKey ? line.replace(/^ {1,2}|^\t/, '') : '  ' + line).join('\n');
      replaceRange(text, start, end, start, start + text.length);
    } else replaceRange('  ');
  }
  if (event.key === 'Enter' && editor.selectionStart === editor.selectionEnd) {
    const start = editor.value.lastIndexOf('\n', editor.selectionStart - 1) + 1;
    const line = editor.value.slice(start, editor.selectionStart), match = line.match(/^(\s*)([-+*]|\d+\.)(\s+)(\[[ xX]\]\s+)?(.*)$/);
    if (match) { event.preventDefault(); if (!match[5]) replaceRange('', start, editor.selectionStart); else { const marker = /\d/.test(match[2]) ? `${parseInt(match[2]) + 1}.` : match[2]; replaceRange(`\n${match[1]}${marker} ${match[4] ? '[ ] ' : ''}`); } }
  }
});
window.mdApi.onOpenPath(openDocument);
window.mdApi.onRequestClose(async () => {
  if (closing) return; closing = true; remember(); editor.readOnly = true;
  let ready = false;
  try {
    const modified = tabs.filter(dirty);
    const choice = modified.length ? await request(window.mdApi.confirmClose(null)) : 'save';
    if (!choice || choice === 'cancel') return;
    if (choice === 'save') { for (const tab of modified) if (!await saveTab(tab)) return; }
    else {
      for (const tab of modified) tab.content = tab.savedContent;
      tabs = tabs.filter(tab => tab.path || tab.content);
      const active = current(); editor.value = active?.content || '';
    }
    persist(); ready = true;
  } finally { if (!ready) { closing = false; editor.readOnly = false; } await request(window.mdApi.finishClose(ready)); }
});
window.addEventListener('beforeunload', persist);
window.addEventListener('blur', persist);
new ResizeObserver(() => { scrollAnchors = null; syncBackdrop(); }).observe(workspace);
new ResizeObserver(() => { scrollAnchors = null; syncBackdrop(); }).observe(editor);
preview.addEventListener('load', () => { scrollAnchors = null; }, true);
try {
  const session = JSON.parse(localStorage.getItem('md-session-v1') || 'null');
  if (session?.tabs?.length) {
    for (const item of session.tabs) if (typeof item.content === 'string' && typeof item.savedContent === 'string') { const tab = createTab(item); tab.history = []; tab.future = []; delete tab.asking; }
    nextTabId = Math.max(...tabs.map(tab => tab.id), 0) + 1;
    mode = session.mode; const tab = tabs.find(item => item.id === session.active) || tabs[0]; if (tab) switchTab(tab.id);
  }
} catch { notify('The previous session could not be restored. Saved files are unaffected.'); }
if (!tabs.length) switchTab(createTab({ content: WELCOME, savedContent: WELCOME, name: 'Welcome', welcome: true }).id);
setMode(mode); theme(localStorage.getItem('theme') || 'dark'); renderTabs();
