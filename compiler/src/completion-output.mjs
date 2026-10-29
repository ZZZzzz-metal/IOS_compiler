import { hashBytes } from './source.mjs';

function displayChunks(chunks) {
  return chunks.replace(/\[#(.*?)#\]/gu, '$1 ').replace(/<#(.*?)#>/gu, '$1')
    .replace(/\{#/gu, '[').replace(/#\}/gu, ']').replace(/\s+/gu, ' ').trim();
}

// Parse only the pinned Clang CLI's emitted declarations. It does not expose AST
// cursor kinds/priorities/availability; do not invent those from spelling or regex.
export function parseCompletionOutput(stdout, context, { maxItems = 200 } = {}) {
  const items = [], seen = new Set();
  let isIncomplete = false;
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.startsWith('COMPLETION: ')) continue;
    const value = line.slice(12), separator = value.indexOf(' : ');
    let name = separator < 0 ? value : value.slice(0, separator);
    const chunks = separator < 0 ? name : value.slice(separator + 3);
    const tags = / \(((?:Hidden|Inaccessible|InBase)(?:,(?:Hidden|Inaccessible|InBase))*)\)$/u.exec(name);
    if (tags) {
      if (tags[1].split(',').some(tag => tag === 'Hidden' || tag === 'Inaccessible')) continue;
      name = name.slice(0, tags.index);
    }
    // The CLI also uses Pattern as a record category. Real declarations named
    // Pattern have typed text Pattern after their result/informative chunks.
    const unannotated = chunks.replace(/\[#.*?#\]/gu, '');
    if (!name || (name === 'Pattern' && !/^Pattern(?=$|[^\p{ID_Continue}$])/u.test(unannotated)) || !name.startsWith(context.prefix) || /[\u0000-\u001F\u007F]/u.test(name) ||
        chunks.includes('(requires fix-it:')) continue;
    const key = `${name}\n${chunks}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (items.length >= maxItems) { isIncomplete = true; continue; }
    items.push({ id: hashBytes(key), label: name, kind: 'unknown',
      detail: displayChunks(chunks), insertText: name,
      replaceRange: { ...context.replaceRange }, filterText: name });
  }
  return { items, isIncomplete };
}
