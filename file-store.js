const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { randomUUID } = require('crypto');

function fileKey(filePath) {
  const absolute = path.resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

async function readDocument(filePath) {
  const resolved = await fs.realpath(path.resolve(filePath));
  return {
    path: resolved,
    key: fileKey(resolved),
    baseUrl: pathToFileURL(path.dirname(resolved) + path.sep).href,
    content: (await fs.readFile(resolved, 'utf8')).replace(/\r\n?/g, '\n')
  };
}

async function writeDocument(filePath, content, expectedContent) {
  let target = path.resolve(filePath);
  try { target = await fs.realpath(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const checkConflict = async () => {
    if (typeof expectedContent !== 'string') return;
    let disk;
    try { disk = (await fs.readFile(target, 'utf8')).replace(/\r\n?/g, '\n'); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('The file was removed outside MD Editor. Use Save as to keep your changes.');
      throw error;
    }
    if (disk !== expectedContent) throw new Error('The file changed outside MD Editor. Use Save as to keep your version without overwriting those changes.');
  };
  await checkConflict();
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    let mode;
    try { mode = (await fs.stat(target)).mode; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const handle = await fs.open(temporary, 'wx', mode);
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await checkConflict();
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { path: target, key: fileKey(target), baseUrl: pathToFileURL(path.dirname(target) + path.sep).href, content };
}

module.exports = { fileKey, readDocument, writeDocument };
