import { validateSnapshot } from './source.mjs';

const encoder = new TextEncoder();
const identifier = /[\p{ID_Continue}$]/u;

export function isUtf16Boundary(text, offset) {
  return Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length &&
    !(offset > 0 && offset < text.length && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset]));
}

export function validateCompletionRequest(request) {
  if (!request || typeof request.requestId !== 'string' || !request.requestId ||
      !Number.isSafeInteger(request.documentVersion) || request.documentVersion < 0) throw new Error('Invalid completion request identity');
  validateSnapshot(request.snapshot);
  if (!(request.language === 'c' && request.standard === 'c11') && !(request.language === 'cpp' && request.standard === 'c++17')) throw new Error('Completion supports C11/C++17');
  if (request.trigger !== undefined && !['identifier', '.', '->', '::', 'manual'].includes(request.trigger)) throw new Error('Invalid completion trigger');
  const file = request.snapshot.files.find(file => file.path === request.sourcePath);
  if (!file || !isUtf16Boundary(file.text, request.offset)) throw new Error('Completion offset must be a UTF16 boundary in sourcePath');
  if (request.snapshot.files.reduce((n, file) => n + encoder.encode(file.text).length, 0) > 1024 * 1024) throw new Error('Completion snapshot exceeds 1 MiB');
  for (const file of request.snapshot.files) if (encoder.encode(`project/${file.path}`).length > 900) throw new Error('Completion source path exceeds toolchain limit');
  return file;
}

export function completionPosition(text, offset) {
  if (!isUtf16Boundary(text, offset)) throw new RangeError('Invalid UTF16 insertion point');
  const before = text.slice(0, offset), start = before.lastIndexOf('\n') + 1;
  return { line: before.split('\n').length, byteColumn: encoder.encode(before.slice(start)).length + 1 };
}

// This lexer only suppresses requests in literals/comments and finds the edit range.
// All symbol lookup, types, visibility and scope come from Clang, never this lexer.
export function completionContext(text, offset) {
  if (!isUtf16Boundary(text, offset)) throw new RangeError('Invalid UTF16 insertion point');
  // Translation phase 2 splices escaped newlines before recognizing comments.
  const before = text.slice(0, offset).replace(/\\\n/gu, '');
  let state = 'code', quote = '', rawEnd = '';
  for (let i = 0; i < before.length; i++) {
    const ch = before[i], next = before[i + 1];
    if (state === 'line-comment') { if (ch === '\n') state = 'code'; continue; }
    if (state === 'block-comment') { if (ch === '*' && next === '/') { state = 'code'; i++; } continue; }
    if (state === 'raw-string') {
      if (before.startsWith(rawEnd, i)) { i += rawEnd.length - 1; state = 'code'; }
      continue;
    }
    if (state === 'literal') {
      if (ch === '\\') i++;
      else if (ch === quote || ch === '\n') state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { state = 'line-comment'; i++; }
    else if (ch === '/' && next === '*') { state = 'block-comment'; i++; }
    else if (/[0-9]/u.test(ch) && !identifier.test(before[i - 1] ?? '')) {
      // Consume a preprocessing number as one token. A quote is a separator only
      // inside that token, never because a preceding keyword ends in a hex letter
      // (case'a' and sizeof'a' are valid character literals).
      while (i + 1 < before.length) {
        const next = before[i + 1], previous = before[i];
        if (/[\p{ID_Continue}.]/u.test(next) ||
            (next === "'" && /[\p{ID_Continue}]/u.test(before[i + 2] ?? '')) ||
            ((next === '+' || next === '-') && /[eEpP]/u.test(previous))) i++;
        else break;
      }
    }
    else if (ch === 'R' && next === '"') {
      const raw = /^R"([^ ()\\\t\r\n]{0,16})\(/u.exec(before.slice(i));
      if (raw) { state = 'raw-string'; rawEnd = `)${raw[1]}"`; i += raw[0].length - 1; }
    } else if (ch === '"' || ch === "'") {
      state = 'literal'; quote = ch;
    }
  }
  let startOffset = offset, endOffset = offset;
  while (startOffset > 0) {
    let previous = startOffset - 1;
    if (previous > 0 && /[\uDC00-\uDFFF]/u.test(text[previous])) previous--;
    if (!identifier.test(text.slice(previous, startOffset))) break;
    startOffset = previous;
  }
  while (endOffset < text.length) {
    const ch = String.fromCodePoint(text.codePointAt(endOffset));
    if (!identifier.test(ch)) break;
    endOffset += ch.length;
  }
  const left = text.slice(0, startOffset).trimEnd();
  const member = left.endsWith('.') || left.endsWith('->');
  return { suppressed: state !== 'code', reason: state, prefix: text.slice(startOffset, offset),
    replaceRange: { startOffset, endOffset }, member };
}

export function completionIdentity(request) {
  return { requestId: request?.requestId ?? '', documentVersion: request?.documentVersion ?? 0,
    snapshotId: request?.snapshot?.snapshotId ?? '', sourceHash: request?.snapshot?.sourceHash ?? '',
    sourcePath: request?.sourcePath ?? '', offset: request?.offset ?? 0 };
}

export function emptyCompletion(request, status, reason, diagnostics = []) {
  return { ...completionIdentity(request), status, items: [], isIncomplete: false, diagnostics, ...(reason ? { reason } : {}) };
}
