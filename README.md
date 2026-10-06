# MD Editor

A simple desktop app for reading and editing Markdown files, built with Electron.

![MD Editor — rendered preview](docs/screenshot_1.png)

## Download

**[Download the latest installer for Windows](https://github.com/ermellinka/md-editor/releases/latest)** — no Git or Node.js required. Grab the `.exe` from the latest release, run it, and you're set. Double-clicking any `.md` file will open it in MD Editor.

> Windows may show a SmartScreen warning because the app is not code-signed. Click "More info" -> "Run anyway".

## Features

- **Live preview** — write on the left, see the rendered result on the right, with synchronized scrolling

  ![MD Editor — split view](docs/screenshot_3.png)
- **Tabs** — work with multiple files at once
- **Linked selection** — select text in either split pane to highlight the matching source or rendered text without moving keyboard focus
- **Content-based scroll sync** — follows corresponding Markdown blocks; use **Sync** to turn it off
- **Find and replace** — Ctrl+F / Ctrl+H, previous/next match, replace one or all
- **Session recovery** — restores open tabs, unsaved drafts, selection, scroll positions and view mode
- **Outline and resizable panes** — jump to headings and drag the divider (or focus it and use arrow keys)
- **Per-tab undo/redo** — Ctrl+Z / Ctrl+Y, including toolbar edits and replace-all
- **Relative images and links** — resolved from the Markdown file's folder; Markdown links open as tabs, web links open in your browser
- **Safer saving** — temporary-file replacement, visible errors and external-change checks before overwriting
- **Toolbar** — bold, italic, headings, lists, quotes, links, tables
- **Dark & light themes** — your choice is remembered

  ![MD Editor — dark theme](docs/screenshot_2.png)
- **Open & save** `.md` files with hotkeys: Ctrl+O / Ctrl+S / Ctrl+Shift+S
- **Three view modes** — editor only / split / preview only
- **Unsaved changes protection** — warns before closing with unsaved edits
- **Editing shortcuts** — Ctrl+W closes a tab, Ctrl+Tab switches tabs, Tab/Shift+Tab indent, Enter continues lists
- **File association** — after installing, double-clicking a `.md` file opens it in MD Editor

## Getting started

Requires [Node.js LTS](https://nodejs.org/).

```bash
npm install
npm start
```

### Linked selection and recovery

The preview retains source positions for ordinary text, inline formatting, link labels,
table cells, blockquotes and code. Repeated words map to their own occurrences.
Selections without a direct text counterpart (for example Markdown delimiters, images
or raw HTML) fall back to the enclosing block. Custom embedded HTML does not receive
character-level mapping. The renderer still sanitizes HTML and removes inline styles.

Draft recovery is stored locally in the application's browser storage, shortly after
editing and when the window loses focus. It does not automatically overwrite your
Markdown files. **Don't save** discards the affected changes from recovery as well.
If a file changes outside the editor, save your version under a different name with
**Save as** to preserve both versions. External files are not watched or reloaded live.

### Checks

```bash
npm test
npm run test:renderer
```

The renderer suite runs an isolated offscreen Electron window with temporary app data
and mocked file dialogs. It checks source mapping, real mouse selection, scrolling,
tabs, undo, search, recovery and save/close cancellation. Visual captures are written
to the ignored `tests/.artifacts/` directory. File-system tests exercise real temporary
files, conflict detection and replacement saves. Native dialogs and installer execution
are not automated by these tests.

## Building the Windows installer

```bash
npm run dist
```

The NSIS installer (`.exe`) appears in `dist/`. After installation, `.md` files can be associated with MD Editor.

## Project structure

```
md-editor/
├── main.js          # main process: window, open/save dialogs
├── preload.js       # secure renderer ↔ main bridge (contextBridge)
├── file-store.js    # async reads, conflict checks and replacement writes
├── renderer/
│   ├── index.html   # layout: toolbar, editor, preview, status bar
│   ├── style.css    # themes (CSS variables) and preview styles
│   ├── app.js       # documents, editing, selection/scroll sync, recovery, search
│   └── source-preview.js # token source positions and sanitized preview
├── tests/          # filesystem and offscreen Electron checks
└── package.json
```

## Tech notes

- Markdown rendering: [marked](https://github.com/markedjs/marked), sanitized with [DOMPurify](https://github.com/cure53/DOMPurify)
- Renderer is isolated from Node.js — all file access goes through `contextBridge` in `preload.js`
- Packaged with [electron-builder](https://www.electron.build/)

## Roadmap ideas

- Syntax highlighting in code blocks (highlight.js)
- Export to HTML/PDF
- Folder file tree sidebar
- Live detection and reload of externally edited files

## License

[MIT](LICENSE)
