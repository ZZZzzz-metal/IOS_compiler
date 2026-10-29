import test from 'node:test';
import assert from 'node:assert/strict';
import { completionContext, completionPosition, validateCompletionRequest } from '../src/completion-source.mjs';
import { parseCompletionOutput } from '../src/completion-output.mjs';
import { createSnapshot } from '../src/source.mjs';

test('normalized UTF16 insertion points map to real UTF8 byte columns and whole token ranges', () => {
  const raw = '\uFEFFint n;\r\nvoid f(){ const char* s="中文😀"; alphaSuffix; }';
  const snapshot = createSnapshot([{ path: 'main.cpp', role: 'user', text: raw }], 'main.cpp');
  const text = snapshot.files[0].text, offset = text.indexOf('alphaSuffix') + 2;
  const point = completionPosition(text, offset), prefix = text.slice(text.indexOf('\n') + 1, offset);
  assert.equal(point.line, 2); assert.equal(point.byteColumn, new TextEncoder().encode(prefix).length + 1);
  assert.deepEqual(completionContext(text, offset).replaceRange, { startOffset: text.indexOf('alphaSuffix'), endOffset: text.indexOf('alphaSuffix') + 11 });
  assert.equal(completionContext(text, offset).prefix, 'al');
  const request = { requestId: 'unicode', documentVersion: 0, language: 'cpp', standard: 'c++17', snapshot, sourcePath: 'main.cpp', offset };
  validateCompletionRequest(request);
  assert.throws(() => validateCompletionRequest({ ...request, offset: text.indexOf('😀') + 1 }), /UTF16/u);
  assert.throws(() => validateCompletionRequest({ ...request, offset: text.length + 1 }), /UTF16/u);
  assert.throws(() => validateCompletionRequest({ ...request, documentVersion: -1 }), /identity/u);
  assert.throws(() => validateCompletionRequest({ ...request, sourcePath: 'missing.cpp' }), /sourcePath/u);
  const tampered = structuredClone(request); tampered.snapshot.files[0].text = raw;
  assert.throws(() => validateCompletionRequest(tampered), /integrity/u);
});

test('comments, escaped strings/chars and raw strings suppress; closed literals and digit separators do not', () => {
  for (const text of ['// obj.', '/* obj.', '"obj.', "'x", "case'a", "sizeof'a", 'u8"abc\\" obj.', 'R"tag(quote " obj.', 'u8R"xx(multi\n obj.', '// comment\\\nobj.']) {
    assert.equal(completionContext(text, text.length).suppressed, true, text);
  }
  for (const text of ['/* done */ obj.', '// done\nobj.', '"done"; obj.', "'x'; obj.", 'R"tag(quote " done)tag"; obj.', "int n=1'000; obj.", "case'a': obj.", "sizeof'a'; obj.", "auto n=0x1'ff; obj."]) {
    assert.equal(completionContext(text, text.length).suppressed, false, text);
  }
});

test('native tags determine visibility, overload signatures survive, pattern chunks never insert', () => {
  const context = { prefix: '', replaceRange: { startOffset: 5, endOffset: 5 } };
  const native = ['COMPLETION: secret (Inaccessible) : [#int#]secret', 'COMPLETION: hidden (Hidden) : [#double#]hidden',
    'COMPLETION: inherited (InBase) : [#int#][#Base::#]inherited', 'COMPLETION: alpha : [#int#]alpha(<#int x#>)',
    'COMPLETION: alpha : [#double#]alpha(<#double x#>{#, <#int n=2#>#})', 'COMPLETION: Pattern : for (<#x#>)', 'OVERLOAD: alpha(int)'].join('\n');
  const parsed = parseCompletionOutput(native, context);
  assert.deepEqual(parsed.items.map(i => i.label), ['inherited', 'alpha', 'alpha']);
  assert.equal(new Set(parsed.items.map(i => i.id)).size, 3);
  assert.ok(parsed.items.every(i => i.kind === 'unknown' && !i.insertText.includes('<#')));
  assert.notEqual(parsed.items[1].detail, parsed.items[2].detail);
  assert.equal(parseCompletionOutput(native, context, { maxItems: 1 }).isIncomplete, true);
});
