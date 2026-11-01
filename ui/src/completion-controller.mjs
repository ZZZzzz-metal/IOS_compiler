const identifierStart = /[_\p{ID_Start}]/u;
const identifierPart = /[_\p{ID_Continue}]/u;
const kinds = new Set(['variable','function','field','method','class','struct','namespace','keyword','enum','enumMember','type','unknown']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const boundary = (text, offset) => integer(offset) && offset <= text.length && !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset]));
const point = (text, offset) => String.fromCodePoint(text.codePointAt(offset));
const wellFormed = text => {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code >= 0xD800 && code <= 0xDFFF) return false;
  }
  return true;
};
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** A lexical guard only: names and members always come from the semantic provider. */
export function completionLexicalContext(text, offset, manual = false) {
  if (typeof text !== 'string' || !boundary(text, offset)) return null;
  let i = 0, previous = null, identifier = null;
  while (i < offset) {
    const start = i, char = point(text, i);
    if (/\s/u.test(char)) { i += char.length; continue; }
    if (text.startsWith('//', i)) {
      let end = text.indexOf('\n', i + 2);
      // Translation-phase line splices continue a // comment onto the next line.
      while (end >= 0 && text[end - 1] === '\\') end = text.indexOf('\n', end + 1);
      if (end < 0 || offset <= end) return null;
      i = end + 1; continue;
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0 || offset < end + 2) return null;
      i = end + 2; continue;
    }
    const raw = /^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(text.slice(i));
    if (raw) {
      const close = `)${raw[1]}"`, end = text.indexOf(close, i + raw[0].length);
      if (end < 0 || offset < end + close.length) return null;
      i = end + close.length; previous = {kind:'literal',end:i}; continue;
    }
    if (char === '"' || char === "'") {
      const quote = char; let closed = false; i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += Math.min(2, text.length - i); continue; }
        if (text[i] === quote) { i++; closed = true; break; }
        if (text[i] === '\n') break;
        i++;
      }
      if (offset < i || (!closed && offset === i)) return null;
      previous = {kind:'literal',end:i}; continue;
    }
    // A C/C++ preprocessing number includes decimal points, suffixes and exponent signs.
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[i + 1] ?? ''))) {
      i++;
      while (i < text.length) {
        const next = point(text, i);
        if (identifierPart.test(next) || next === '.' || next === "'") i += next.length;
        else if ((next === '+' || next === '-') && /[eEpP]/.test(text[i - 1])) i++;
        else break;
      }
      if (offset <= i) return null;
      previous = {kind:'number',end:i}; continue;
    }
    if (identifierStart.test(char)) {
      i += char.length;
      while (i < text.length && identifierPart.test(point(text, i))) i += point(text, i).length;
      if (offset <= i) { identifier = {start,end:i,prefix:text.slice(start, offset)}; break; }
      previous = {kind:'identifier',end:i}; continue;
    }
    const pair = text.slice(i, i + 2);
    const value = pair === '->' || pair === '::' ? pair : char;
    i += value.length; previous = {kind:'operator',value,end:i};
  }
  // A caret immediately before an identifier still replaces its complete suffix.
  if (!identifier && offset < text.length && identifierStart.test(point(text, offset))) {
    let end = offset + point(text, offset).length;
    while (end < text.length && identifierPart.test(point(text, end))) end += point(text, end).length;
    identifier = {start:offset,end,prefix:''};
  }
  const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  if (/^\s*#\s*(?:include|include_next)\s*<[^>]*$/.test(line)) return null;
  const member = previous?.end === (identifier?.start ?? offset) && ['.','->','::'].includes(previous?.value) ? previous.value : null;
  const prefix = identifier?.prefix ?? '';
  if (!manual && !prefix && !member) return null;
  return {start:identifier?.start ?? offset,end:identifier?.end ?? offset,prefix,trigger:manual ? 'manual' : prefix ? 'identifier' : member};
}

/** Consume frozen CompletionAdapter results without DOM, storage or generated candidates.
 * Context text/offsets and the snapshot file must already be normalized to LF/no BOM.
 * invalidate()/dispose() return a drain promise, suitable for awaiting before compilation.
 */
export function createCompletionController({getContext,complete,cancel,onChange=()=>{},onApply,delayMs=180,maxItems=80,makeRequestId} = {}) {
  if (typeof getContext !== 'function' || typeof complete !== 'function' || typeof onApply !== 'function') throw new TypeError('Completion callbacks are required');
  let serial = 0, requestSerial = 0, timer = null, active = null, disposed = false;
  let drain = Promise.resolve();
  let state = freeze({phase:'idle',items:[],selectedIndex:-1,token:0,message:''});
  const limit = integer(maxItems) && maxItems > 0 ? Math.min(maxItems, 1000) : 80;
  const wait = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 180;
  // Retain used IDs for this controller lifecycle so even injected ID factories
  // cannot accidentally reuse an old worker identity (bounded by request count).
  const requestIds = new Set();

  function emit(phase, items = [], selectedIndex = -1, message = '') {
    state = freeze({phase,items,selectedIndex,token:serial,message});
    onChange(state);
  }
  function capture(manual) {
    let context;
    try { context = getContext(); } catch { return null; }
    if (!context?.enabled || !context.focused || context.composing || !integer(context.documentVersion) ||
        typeof context.text !== 'string' || !boundary(context.text, context.offset) || context.selectionEnd !== context.offset) return null;
    const sourcePath = context.sourcePath ?? context.filePath;
    const snapshot = context.snapshot;
    const language = context.language ?? 'cpp', standard = context.standard ?? (language === 'c' ? 'c11' : 'c++17');
    if (typeof sourcePath !== 'string' || !sourcePath || !snapshot || typeof snapshot.snapshotId !== 'string' || !snapshot.snapshotId ||
        typeof snapshot.sourceHash !== 'string' || !snapshot.sourceHash || !Array.isArray(snapshot.files) ||
        snapshot.files.filter(file => file.path === sourcePath).length !== 1 || snapshot.files.find(file => file.path === sourcePath)?.text !== context.text ||
        !((language === 'c' && standard === 'c11') || (language === 'cpp' && standard === 'c++17'))) return null;
    const lexical = completionLexicalContext(context.text, context.offset, manual);
    if (!lexical) return null;
    try {
      const snapshotCopy = freeze(structuredClone(snapshot));
      const fingerprint = JSON.stringify([context.documentVersion,sourcePath,context.text,context.offset,context.selectionEnd,language,standard,snapshotCopy]);
      return {documentVersion:context.documentVersion,sourcePath,text:context.text,offset:context.offset,language,standard,snapshot:snapshotCopy,lexical,fingerprint};
    } catch { return null; }
  }
  function current(operation) {
    if (disposed || active !== operation || operation.serial !== serial) return false;
    const context = capture(operation.manual);
    return context?.fingerprint === operation.context.fingerprint;
  }
  function invalidate() {
    serial++;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    const previous = active; active = null;
    if (previous?.started && !previous.settled && !previous.cancelled) {
      previous.cancelled = true;
      let cancellation;
      try { cancellation = cancel?.(previous.request.requestId); } catch (error) { cancellation = Promise.reject(error); }
      // Wait for both worker cancellation and its request settlement, even if cancel rejects.
      // This drain alone does not prove release succeeded: the adapter owner must
      // retain cancellation errors and gate compilation until actual release is confirmed.
      drain = Promise.allSettled([drain, cancellation, previous.settlement]).then(() => undefined);
    }
    if (!disposed) emit('idle');
    return drain;
  }
  function rejectChanged(operation) {
    if (active === operation && !disposed) invalidate();
  }
  function itemsFor(result, operation) {
    if (!Array.isArray(result.items) || result.items.length > 20000) return null;
    const {context} = operation, {start,end,prefix} = context.lexical;
    const ids = new Set(), items = [];
    for (const item of result.items) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return null;
      ids.add(item.id);
      if (typeof item.label !== 'string' || !item.label || item.label.length > 4096 ||
          typeof item.insertText !== 'string' || !item.insertText || item.insertText.length > 65536 || !wellFormed(item.insertText) ||
          /[\r\n\0]/.test(item.insertText) || /\$(?:\d|\{|[A-Za-z_])/.test(item.insertText) ||
          !kinds.has(item.kind) || typeof item.detail !== 'string' || item.detail.length > 16384 ||
          (item.filterText !== undefined && typeof item.filterText !== 'string') ||
          (item.sortText !== undefined && typeof item.sortText !== 'string')) continue;
      const range = item.replaceRange;
      // Only a complete identifier or its typed prefix may be replaced. Expand the latter
      // over the right-hand suffix, preventing `pri|nt` -> `printnt` corruption.
      if (!range || !boundary(context.text, range.startOffset) || !boundary(context.text, range.endOffset) ||
          range.startOffset !== start || (range.endOffset !== context.offset && range.endOffset !== end)) continue;
      const filter = item.filterText ?? item.label;
      if (prefix && !filter.toLocaleLowerCase('en-US').startsWith(prefix.toLocaleLowerCase('en-US'))) continue;
      items.push({id:item.id,label:item.label,insertText:item.insertText,kind:item.kind,detail:item.detail,
        ...(item.filterText !== undefined ? {filterText:item.filterText} : {}),
        ...(item.sortText !== undefined ? {sortText:item.sortText} : {}),replaceRange:{startOffset:start,endOffset:end}});
    }
    return items.sort((a,b) => {
      const first = a.sortText ?? a.label, second = b.sortText ?? b.label;
      return first < second ? -1 : first > second ? 1 : 0;
    }).slice(0, limit);
  }
  async function perform(operation) {
    await drain;
    if (!current(operation)) { rejectChanged(operation); return state; }
    let finish;
    operation.settlement = new Promise(resolve => { finish = resolve; });
    operation.started = true;
    let result, failure;
    try { result = await complete(operation.request); } catch (error) { failure = error; }
    finally { operation.settled = true; finish(); }
    if (!current(operation)) { rejectChanged(operation); return state; }
    if (failure) { emit('error', [], -1, '代码提示暂不可用，请继续输入或稍后重试。'); return state; }
    const {request} = operation;
    if (!result || result.requestId !== request.requestId || result.documentVersion !== request.documentVersion ||
        result.snapshotId !== request.snapshot.snapshotId || result.sourceHash !== request.snapshot.sourceHash ||
        result.sourcePath !== request.sourcePath || result.offset !== request.offset) {
      emit('error', [], -1, '代码提示结果已失效。'); return state;
    }
    if (result.status === 'cancelled') { emit('idle'); return state; }
    if (result.status !== 'succeeded') {
      emit('error', [], -1, result.status === 'unsupported' ? '当前代码暂不支持语义提示。' : '代码提示暂不可用，请继续输入或稍后重试。'); return state;
    }
    const items = itemsFor(result, operation);
    if (items === null) emit('error', [], -1, '代码提示结果格式无效。');
    else emit(items.length ? 'open' : 'empty', items, items.length ? 0 : -1, items.length ? '' : '没有匹配的代码提示。');
    return state;
  }
  function begin(manual, captured) {
    if (disposed) return Promise.resolve(state);
    const context = captured ?? capture(manual);
    if (!context) return Promise.resolve(state);
    let requestId;
    try { requestId = makeRequestId?.() ?? `completion-${++requestSerial}`; }
    catch { emit('error', [], -1, '代码提示请求标识无效。'); return Promise.resolve(state); }
    if (typeof requestId !== 'string' || !requestId || requestIds.has(requestId)) {
      emit('error', [], -1, '代码提示请求标识无效。'); return Promise.resolve(state);
    }
    requestIds.add(requestId);
    const request = freeze({requestId,documentVersion:context.documentVersion,snapshot:context.snapshot,
      sourcePath:context.sourcePath,offset:context.offset,trigger:context.lexical.trigger,language:context.language,standard:context.standard});
    const operation = {serial,manual,context,request,started:false,settled:false,cancelled:false};
    active = operation; emit('pending');
    return perform(operation);
  }
  return {
    input() {
      invalidate();
      if (disposed) return;
      const context = capture(false), scheduledSerial = serial;
      if (!context) return;
      timer = setTimeout(() => {
        timer = null;
        if (disposed || scheduledSerial !== serial || capture(false)?.fingerprint !== context.fingerprint) return;
        void begin(false, context);
      }, wait);
    },
    request() { invalidate(); return begin(true); },
    invalidate,
    move(delta) {
      if (state.phase !== 'open' || !state.items.length || !Number.isSafeInteger(delta) || !active) return false;
      if (!current(active)) { invalidate(); return false; }
      const index = ((state.selectedIndex + delta) % state.items.length + state.items.length) % state.items.length;
      emit('open', state.items, index); return true;
    },
    choose(index, token) {
      if (state.phase !== 'open' || token !== state.token || !integer(index) || index >= state.items.length || !active) return false;
      if (!current(active)) { invalidate(); return false; }
      const item = state.items[index], edit = {start:item.replaceRange.startOffset,end:item.replaceRange.endOffset,
        text:item.insertText,caret:item.replaceRange.startOffset + item.insertText.length,token};
      const operation = active;
      // Consume before the callback: synchronous input/selection events or a second click
      // cannot apply this result twice. Parent supplies one undoable edit and one save.
      invalidate();
      if (disposed || serial !== token + 1 || active || capture(operation.manual)?.fingerprint !== operation.context.fingerprint) return false;
      try { return onApply(edit) === true; } catch { return false; }
    },
    dispose() { const pending = invalidate(); disposed = true; return pending; },
    get state() { return state; }
  };
}
