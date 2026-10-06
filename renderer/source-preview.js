/* Source positions belong to parser tokens, never to a global text search. */
window.SourcePreview = (() => {
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const decoder = document.createElement('textarea');
  function decode(value) { decoder.innerHTML = value; return decoder.value; }
  function locate(raw, parent, from) {
    const exact = parent.text.indexOf(raw, from);
    if (exact >= 0) return { text: raw, positions: parent.positions.slice(exact, exact + raw.length), end: exact + raw.length };
    // Blockquotes and indented lists strip prefixes before parsing their children.
    const positions = []; let cursor = from;
    for (const character of raw.split('')) {
      const found = parent.text.indexOf(character, cursor);
      if (found < 0) return null;
      positions.push(parent.positions[found]); cursor = found + 1;
    }
    return { text: raw, positions, end: cursor };
  }
  function visiblePositions(visible, source, decodeEntities = true) {
    let plain = ''; const positions = [];
    for (let i = 0; i < source.text.length;) {
      const entity = decodeEntities && source.text.slice(i).match(/^&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i);
      if (entity) {
        const decoded = decode(entity[0]);
        plain += decoded;
        for (let j = 0; j < decoded.length; j++) positions.push({ start: source.positions[i], end: source.positions[i + entity[0].length - 1] + 1 });
        i += entity[0].length;
      } else {
        plain += source.text[i]; positions.push({ start: source.positions[i], end: source.positions[i] + 1 }); i++;
      }
    }
    const result = []; let cursor = 0;
    for (const character of visible.split('')) {
      let at = plain.indexOf(character, cursor);
      if (at < 0 && /\s/.test(character)) { const match = plain.slice(cursor).search(/\s/); if (match >= 0) at = cursor + match; }
      if (at < 0) return null;
      result.push(positions[at]); cursor = at + 1;
    }
    return result;
  }
  function render(source, preview, baseUrl) {
    const tokens = marked.lexer(source); const leaves = new Map(); const blocks = []; let serial = 0;
    const prefix = crypto.randomUUID();
    function annotate(children, parent) {
      let cursor = 0;
      for (const token of children || []) {
        const local = locate(token.raw || token.text || '', parent, cursor);
        if (!local) continue;
        cursor = local.end;
        if (token.tokens) annotate(token.tokens, local);
        else if (token.items) annotate(token.items, local);
        else if (token.type === 'table') {
          let cellCursor = 0;
          for (const cell of [...token.header, ...token.rows.flat()]) {
            const cellSource = locate(cell.text, local, cellCursor);
            if (cellSource) { annotate(cell.tokens, cellSource); cellCursor = cellSource.end; }
          }
        } else if (['text', 'escape', 'codespan', 'code'].includes(token.type)) {
          const isCode = token.type === 'code';
          const visible = isCode ? token.text : decode(token.text);
          let leafSource = local;
          if (isCode) {
            const fence = local.text.match(/^ {0,3}(`{3,}|~{3,})[^\n]*\n/);
            if (fence) leafSource = { text: local.text.slice(fence[0].length), positions: local.positions.slice(fence[0].length) };
          } else if (token.type === 'codespan') {
            const fence = local.text.match(/^`+/)[0].length;
            leafSource = { text: local.text.slice(fence, -fence), positions: local.positions.slice(fence, -fence) };
          }
          const positions = visiblePositions(visible, leafSource, !isCode && token.type !== 'codespan');
          if (!positions || !positions.length) continue;
          const id = `${prefix}-${++serial}`; leaves.set(id, positions);
          token.text = `<span data-source-leaf="${id}">${escape(visible)}</span>`;
          if (isCode) token.escaped = true;
        }
      }
    }
    let cursor = 0; const fragment = document.createDocumentFragment();
    for (const token of tokens) {
      const start = source.indexOf(token.raw, cursor);
      if (start < 0) continue;
      const end = start + token.raw.length; cursor = end;
      const local = { text: token.raw, positions: Array.from({ length: token.raw.length }, (_, i) => start + i) };
      annotate([token], local);
      const one = [token]; one.links = tokens.links;
      const html = marked.parser(one);
      if (!html.trim()) continue;
      const id = blocks.length;
      const element = document.createElement('section');
      element.className = 'source-block'; element.dataset.sourceBlock = id;
      element.innerHTML = DOMPurify.sanitize(html, { FORBID_ATTR: ['style'] });
      blocks.push({ start, end, element }); fragment.append(element);
    }
    preview.replaceChildren(fragment);
    for (const node of preview.querySelectorAll('[data-source-leaf]')) {
      node.sourcePositions = leaves.get(node.dataset.sourceLeaf);
    }
    const slugs = new Map();
    for (const heading of preview.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      const base = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s/g, '-');
      const count = slugs.get(base) || 0; slugs.set(base, count + 1); heading.id = base + (count ? `-${count}` : '');
    }
    for (const image of preview.querySelectorAll('img')) {
      image.removeAttribute('srcset');
      const src = image.getAttribute('src');
      if (src && baseUrl) { try { image.src = new URL(src, baseUrl).href; } catch {} }
    }
    return blocks;
  }
  return { render, escape };
})();
