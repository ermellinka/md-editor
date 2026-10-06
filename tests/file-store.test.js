const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readDocument, writeDocument } = require('../file-store');

test('atomic save, normalized baseline and protection against external edits/removal', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'md-editor-files-'));
  const file = path.join(directory, 'document.md');
  try {
    await fs.writeFile(file, 'first\r\nsecond');
    const opened = await readDocument(file);
    assert.equal(opened.content, 'first\nsecond');
    assert.ok(opened.baseUrl.startsWith('file:'));
    await writeDocument(file, 'new version', opened.content);
    assert.equal(await fs.readFile(file, 'utf8'), 'new version');
    await fs.writeFile(file, 'external version');
    await assert.rejects(writeDocument(file, 'overwrite', 'new version'), /changed outside/);
    assert.equal(await fs.readFile(file, 'utf8'), 'external version');
    await fs.unlink(file);
    await assert.rejects(writeDocument(file, 'overwrite', 'external version'), /removed outside/);
    await writeDocument(file, 'new file');
    assert.equal(await fs.readFile(file, 'utf8'), 'new file');
    assert.deepEqual(await fs.readdir(directory), ['document.md']);
  } finally {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('md-editor-files-')) throw new Error('Unexpected test directory');
    await fs.rm(directory, { recursive: true, force: true });
  }
});
