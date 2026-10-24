import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalizeSources, createSnapshot, hashBytes, normalizeSourceText, validateSnapshot } from '../src/source.mjs';
import { byteColumnToUtf16Column, parseClangDiagnostics } from '../src/diagnostics.mjs';

const vectors = JSON.parse(await readFile(new URL('../../contracts/source-hash-vectors.json', import.meta.url), 'utf8'));

for (const vector of vectors.vectors) {
  test(`browser source hashing matches shared fixed vector: ${vector.name}`, () => {
    const snapshot = createSnapshot(vector.inputFiles, vector.translationUnit, { snapshotId: vector.name });
    assert.equal(canonicalizeSources(vector.inputFiles, vector.translationUnit).canonicalJSON, vector.canonicalJSON);
    assert.equal(snapshot.sourceHash, vector.sourceHash);
    for (const file of snapshot.files) assert.equal(file.contentHash, vector.contentHashes[file.path]);
    assert.equal(validateSnapshot(snapshot), true);
  });
}

test('SHA-256 covers padding boundaries, multiple blocks and byte subviews', () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000, 100000]) {
    const buffer = Uint8Array.from({ length: length + 6 }, (_, i) => (i * 37) % 256);
    const bytes = buffer.subarray(3, length + 3);
    assert.equal(hashBytes(bytes), `sha256:${createHash('sha256').update(bytes).digest('hex')}`, `length=${length}`);
  }
});

test('normalization preserves Unicode and whitespace but rejects unsafe sources', () => {
  assert.equal(normalizeSourceText('\ufeff\t e\u0301 中😀 \r\n\r\n'), '\t e\u0301 中😀 \n\n');
  for (const path of ['/main.cpp', 'a\\b', 'a//b', './a', '../a', 'a/../b', 'a/', 'C:a', 'a\0b', '\ud800.cpp']) {
    assert.throws(() => createSnapshot([{ path, role: 'user', text: '' }], path, { snapshotId: 'invalid' }));
  }
  for (const text of ['a\ud800', '\udc00', '\ud800A']) assert.throws(() => normalizeSourceText(text), /well-formed/);
  assert.throws(() => createSnapshot([{ path: 'a', role: 'library', text: '' }], 'a', { snapshotId: 'invalid' }), /role/);
  assert.throws(() => createSnapshot([{ path: 'a', role: 'user', text: '' }], 'b', { snapshotId: 'invalid' }), /missing/);
  assert.throws(() => createSnapshot([{ path: 'a', role: 'user', text: '' }, { path: 'a', role: 'driver', text: '' }], 'a', { snapshotId: 'invalid' }), /Duplicate/);
});

test('source operations work without newer String methods or WebCrypto', () => {
  const wellFormed = Object.getOwnPropertyDescriptor(String.prototype, 'isWellFormed');
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(String.prototype, 'isWellFormed', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    const vector = vectors.vectors[1];
    const snapshot = createSnapshot(vector.inputFiles, vector.translationUnit, { snapshotId: 'provided-by-host' });
    assert.equal(snapshot.sourceHash, vector.sourceHash);
    assert.equal(validateSnapshot(snapshot), true);
    assert.throws(() => normalizeSourceText('\ud800'), /well-formed/);
    assert.throws(() => createSnapshot(vector.inputFiles, vector.translationUnit), /Provide snapshotId/);
  } finally {
    if (wellFormed) Object.defineProperty(String.prototype, 'isWellFormed', wellFormed);
    else delete String.prototype.isWellFormed;
    if (crypto) Object.defineProperty(globalThis, 'crypto', crypto);
    else delete globalThis.crypto;
  }
});

test('validation rejects tampering and noncanonical snapshots without repairing them', () => {
  const original = createSnapshot([
    { path: 'main.cpp', role: 'driver', text: 'int main(){}\n' },
    { path: 'a.hpp', role: 'user', text: '// abc\n' },
  ], 'main.cpp', { snapshotId: 'unchanged' });
  for (const change of [
    snapshot => { snapshot.files[0].text += 'x'; },
    snapshot => { snapshot.files[0].contentHash = hashBytes('other'); },
    snapshot => { snapshot.sourceHash = hashBytes('other'); },
    snapshot => { snapshot.files.reverse(); },
    snapshot => { snapshot.files[0].text = '// abc\r\n'; },
    snapshot => { snapshot.files[0].extra = true; },
    snapshot => { snapshot.encoding = 'utf-16'; },
    snapshot => { snapshot.snapshotId = ''; },
  ]) {
    const modified = structuredClone(original);
    change(modified);
    assert.throws(() => validateSnapshot(modified));
  }
  assert.equal(validateSnapshot(original), true);
});

test('Clang UTF-8 columns convert to UTF-16, including tabs and emoji', () => {
  const line = '\t中😀x';
  assert.equal(byteColumnToUtf16Column(line, 1), 1);
  assert.equal(byteColumnToUtf16Column(line, 2), 2);
  assert.equal(byteColumnToUtf16Column(line, 5), 3);
  assert.equal(byteColumnToUtf16Column(line, 9), 5);
  assert.equal(byteColumnToUtf16Column(line, 10), 6);
  for (const invalid of [0, 3, 4, 6, 7, 8, 11, NaN, 2.5]) assert.throws(() => byteColumnToUtf16Column(line, invalid));
});

test('Clang diagnostics preserve severity/options and only map actual project sources', () => {
  const snapshot = createSnapshot([
    { path: 'main.cpp', role: 'user', text: '// 中😀\n中😀 wrong\n' },
    { path: 'include/vector', role: 'user', text: 'int user;\n' },
  ], 'main.cpp', { snapshotId: 'diagnostics' });
  const stderr = [
    "project/main.cpp:2:9: error: use of undeclared identifier 'wrong'",
    '\u001b[1m/project/main.cpp:2:1: warning: Chinese warning [-Wunicode]\u001b[0m',
    'main.cpp:1:1: note: previous declaration is here',
    '/sysroot/include/vector:1:1: fatal error: system header error',
    '/tmp/private/project/main.cpp:1:1: error: unknown local file',
    'project/main.cpp:2:5: warning: invalid byte position',
    'project/main.cpp:99:1: error: invalid line',
    'clang++: error: unable to execute command: program not executable',
    'wasm-ld: error: undefined symbol: missing',
    'fatal error: too many errors emitted, stopping now [-ferror-limit=]',
    '  2 | 中😀 wrong',
    '    |      ^',
    '3 errors generated.',
  ].join('\n');
  const diagnostics = parseClangDiagnostics(stderr, snapshot);
  assert.equal(diagnostics.length, 10);
  assert.deepEqual(diagnostics[0].range, { start: { sourcePath: 'main.cpp', line: 2, column: 5 } });
  assert.equal(diagnostics[1].code, '-Wunicode');
  assert.equal(diagnostics[1].severity, 'warning');
  assert.equal(diagnostics[1].message, 'Chinese warning');
  assert.equal(diagnostics[2].severity, 'note');
  assert.equal(diagnostics[3].severity, 'fatal');
  for (const diagnostic of diagnostics.slice(3)) assert.equal(diagnostic.range, undefined);
  assert.equal(diagnostics[7].message, 'unable to execute command: program not executable');
  assert.equal(diagnostics[8].message, 'undefined symbol: missing');
  assert.equal(diagnostics[9].severity, 'fatal');
  assert.equal(diagnostics[9].code, '-ferror-limit=');
});

test('virtual-root prefix wins over an ambiguous same-named subdirectory', () => {
  const snapshot = createSnapshot([
    { path: 'main.cpp', role: 'user', text: 'main\n' },
    { path: 'project/main.cpp', role: 'generated', text: 'nested\n' },
  ], 'main.cpp', { snapshotId: 'root-prefix' });
  const diagnostics = parseClangDiagnostics([
    'project/main.cpp:1:1: error: main',
    '/project/project/main.cpp:1:1: error: nested',
    'project/MAIN.CPP:1:1: error: different case',
    'main.cpp:1: error: missing column',
    'error: driver failed',
  ].join('\n'), snapshot);
  assert.equal(diagnostics[0].range.start.sourcePath, 'main.cpp');
  assert.equal(diagnostics[1].range.start.sourcePath, 'project/main.cpp');
  assert.equal(diagnostics[2].range, undefined);
  assert.equal(diagnostics[3].range, undefined);
  assert.equal(diagnostics[4].message, 'driver failed');
});
