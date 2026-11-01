import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { COMPLETION_SEMANTICS, completionResourceIdentity, deriveCompletionCompiler } from '../src/completion-semantics.mjs';
import { completeWithClang, loadCompletionToolchain } from '../src/completion-engine.mjs';
import { createSnapshot } from '../src/source.mjs';

const resourceRoot = new URL('../resources/', import.meta.url);
const lock = JSON.parse(await readFile(new URL('toolchain.lock.json', resourceRoot), 'utf8'));
const original = await readFile(new URL(`${lock.vendorDirectory}/clang`, resourceRoot));
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const nonce = `probe_${randomBytes(8).toString('hex')}`;
const names = Object.fromEntries(['mutate', 'view', 'static', 'same', 'blocked', 'old', 'ordinary', 'deleted', 'inherited'].map(name => [name, `${nonce}_${name}`]));
const readNames = [];
const toolchain = await loadCompletionToolchain(lock, async path => {
  readNames.push(path.split('/').at(-1));
  return readFile(new URL(path, resourceRoot));
});

function request(marked, { sourcePath = 'main.cpp', translationUnit = sourcePath, files = [] } = {}) {
  assert.equal(marked.split('@').length, 2, 'one completion cursor');
  return { requestId: randomUUID(), documentVersion: 7, language: 'cpp', standard: 'c++17',
    sourcePath, offset: marked.indexOf('@'),
    snapshot: createSnapshot([{ path: sourcePath, role: 'user', text: marked.replace('@', '') }, ...files], translationUnit) };
}
const complete = async (marked, options) => {
  const observation = await completeWithClang(request(marked, options), toolchain);
  assert.equal(observation.result.status, 'succeeded');
  return observation;
};
const matching = (observation, name) => observation.result.items.filter(item => item.label === name);

// This deliberately reads section framing independently of the production Wasm inspector.
function sections(bytes) {
  assert.deepEqual([...bytes.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0]);
  let offset = 8;
  const result = [];
  const readULEB = () => {
    let value = 0, shift = 0, byte;
    do {
      assert.ok(offset < bytes.length && shift < 35, 'bounded section ULEB');
      byte = bytes[offset++]; value += (byte & 127) * 2 ** shift; shift += 7;
    } while (byte & 128);
    return value;
  };
  while (offset < bytes.length) {
    const id = bytes[offset++], byteLength = readULEB(), start = offset;
    offset += byteLength;
    assert.ok(offset <= bytes.length, 'section stays within binary');
    result.push({ id, start, byteLength, bytes: bytes.subarray(start, offset) });
  }
  assert.equal(offset, bytes.length);
  return result;
}

test('completion compiler derivation preserves pinned original and has exact independent SHA and valid section framing', async () => {
  const beforeBytes = Uint8Array.from(original);
  assert.equal(sha256(original), COMPLETION_SEMANTICS.sourceHash);
  const derived = await deriveCompletionCompiler(original);
  assert.deepEqual(original, Buffer.from(beforeBytes), 'derivation must not mutate the full compilation compiler');
  assert.equal(derived.byteLength, COMPLETION_SEMANTICS.byteLength);
  assert.equal(sha256(derived), COMPLETION_SEMANTICS.compilerResourceHash);
  assert.equal(WebAssembly.validate(derived), true);
  const before = sections(original), after = sections(derived);
  assert.deepEqual(after.map(section => section.id), before.map(section => section.id));
  assert.equal(after.filter(section => section.id === 10).length, 1);
  for (let i = 0; i < before.length; i++) {
    const source = before[i], output = after[i];
    assert.equal(output.byteLength - source.byteLength, source.id === 10 ? 22 : 0);
    if (source.id !== 10) assert.deepEqual(Buffer.from(output.bytes), Buffer.from(source.bytes), `section ${source.id} remains byte-identical`);
  }
  assert.notEqual(toolchain.identity.compilerResourceHash, sha256(original));
  assert.deepEqual(readNames, ['memfs', 'sysroot.tar', 'clang']);
});

test('derivation rejects truncated and same-length corrupted source compiler', async () => {
  await assert.rejects(deriveCompletionCompiler(original.subarray(0, original.length - 1)), /source integrity failed/u);
  const corrupted = Uint8Array.from(original);
  corrupted[18774355] ^= 1;
  await assert.rejects(deriveCompletionCompiler(corrupted), /source integrity failed/u);
  assert.equal(sha256(original), COMPLETION_SEMANTICS.sourceHash);
});

test('isolated faulty recipes reject instruction/header guard and incorrect derived SHA', async () => {
  const sourceURL = new URL('../src/completion-semantics.mjs', import.meta.url);
  const source = (await readFile(sourceURL, 'utf8')).replace(/from '(\.\/[^']+)'/gu,
    (_match, relative) => `from '${new URL(relative, sourceURL).href}'`);
  for (const [from, to, error] of [
    ['0acfdd800cb2a803', '0bcfdd800cb2a803', /instruction\/header guard failed/u],
    ['0240200a2802184103470d00200641106a', '0340200a2802184103470d00200641106a', /instruction\/header guard failed/u],
    ['b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901',
      'c15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901', /derived integrity failed/u],
  ]) {
    assert.equal(source.split(from).length, 2, 'one exact recipe fault injection target');
    const faultySource = source.replace(from, to);
    const isolated = await import(`data:text/javascript;base64,${Buffer.from(faultySource).toString('base64')}`);
    await assert.rejects(isolated.deriveCompletionCompiler(original), error);
  }
  assert.equal(sha256(original), COMPLETION_SEMANTICS.sourceHash);
});

test('completion resource identity binds the exact source compiler ID, SHA and length', () => {
  assert.deepEqual(completionResourceIdentity(lock), {
    toolchainId: COMPLETION_SEMANTICS.toolchainId,
    compilerResourceHash: COMPLETION_SEMANTICS.compilerResourceHash,
    sysrootResourceHash: `sha256:${lock.files.find(file => file.filename === 'sysroot.tar').sha256}`,
  });
  for (const mutate of [
    value => { value.toolchainId += '-different'; },
    value => { value.files.find(file => file.filename === 'clang').sha256 = '0'.repeat(64); },
    value => { value.files.find(file => file.filename === 'clang').byteLength += 1; },
  ]) {
    const wrong = clone(lock); mutate(wrong);
    assert.throws(() => completionResourceIdentity(wrong), /Unsupported source compiler/u);
  }
});

test('real const receiver drops instance template mutation and retains static template and const template', async () => {
  const declarations = `struct N{template<class T>void ${names.mutate}(T);template<class T>int ${names.view}(T)const;template<class T>static void ${names.static}(T);};`;
  const immutable = await complete(`${declarations}void f(){const N n{};n.@;}`);
  assert.equal(matching(immutable, names.mutate).length, 0);
  assert.equal(matching(immutable, names.view).length, 1);
  assert.equal(matching(immutable, names.static).length, 1);
  const mutable = await complete(`${declarations}void f(){N n{};n.@;}`);
  for (const name of [names.mutate, names.view, names.static]) assert.equal(matching(mutable, name).length, 1);
});

test('real same-name const and nonconst member template overloads are filtered individually', async () => {
  const declarations = `struct N{template<class T>void ${names.same}(T);template<class T>void ${names.same}(T)const;};`;
  const immutable = await complete(`${declarations}void f(){const N n{};n.@;}`);
  assert.equal(matching(immutable, names.same).length, 1);
  assert.match(matching(immutable, names.same)[0].detail, /\bconst\b/u);
  const mutable = await complete(`${declarations}void f(){N n{};n.@;}`);
  assert.equal(matching(mutable, names.same).length, 2);
  assert.equal(new Set(matching(mutable, names.same).map(item => item.id)).size, 2);
});

test('real unavailable and deleted free overloads do not hide same-name legal overloads', async () => {
  const observation = await complete(`__attribute__((unavailable("probe"))) int ${names.blocked}(int);int ${names.blocked}(double);int ${names.deleted}(char)=delete;int ${names.deleted}(long);void f(){${nonce}_@;}`);
  assert.equal(matching(observation, names.blocked).length, 1);
  assert.match(matching(observation, names.blocked)[0].detail, /double/u);
  assert.equal(matching(observation, names.deleted).length, 1);
  assert.match(matching(observation, names.deleted)[0].detail, /long/u);
  assert.match(observation.native.stdout, new RegExp(`COMPLETION: ${names.blocked} \\(Inaccessible\\)`));
});

test('real deprecated free and member templates stay selectable while unavailable templates are removed', async () => {
  const free = await complete(`template<class T>__attribute__((unavailable("probe"))) int ${names.blocked}(T);template<class T>__attribute__((deprecated)) int ${names.old}(T);int ${names.ordinary}(int);void f(){${nonce}_@;}`);
  assert.equal(matching(free, names.blocked).length, 0);
  assert.equal(matching(free, names.old).length, 1);
  assert.equal(matching(free, names.ordinary).length, 1);
  const member = await complete(`struct N{template<class T>__attribute__((unavailable("probe"))) void ${names.blocked}(T)const;template<class T>__attribute__((deprecated)) void ${names.old}(T)const;};void f(){const N n{};n.@;}`);
  assert.equal(matching(member, names.blocked).length, 0);
  assert.equal(matching(member, names.old).length, 1);
});

test('real inherited and redeclared availability survives qualified and using lookup', async () => {
  const inherited = await complete(`struct Base{__attribute__((unavailable("probe"))) int ${names.blocked}()const;template<class T>void ${names.mutate}(T);template<class T>void ${names.view}(T)const;};struct N:Base{};void f(){const N n{};n.@;}`);
  assert.equal(matching(inherited, names.blocked).length, 0);
  assert.equal(matching(inherited, names.mutate).length, 0);
  assert.equal(matching(inherited, names.view).length, 1);
  const declarations = `namespace Space{__attribute__((unavailable("probe"))) int ${names.blocked}(int);int ${names.blocked}(int);int ${names.ordinary}();}using Space::${names.blocked};using Space::${names.ordinary};`;
  for (const expression of ['', 'Space::']) {
    const result = await complete(`${declarations}void f(){${expression}${nonce}_@;}`);
    assert.equal(matching(result, names.blocked).length, 0);
    assert.equal(matching(result, names.ordinary).length, 1);
  }
});

test('real aliased const objects and pointer receivers retain legal template overloads', async () => {
  const declarations = `struct N{template<class T>void ${names.mutate}(T);template<class T>void ${names.view}(T)const;};using Alias=const N;`;
  for (const [object, selector] of [['Alias n{};', 'n.'], ['Alias* p=nullptr;', 'p->']]) {
    const result = await complete(`${declarations}void f(){${object}${selector}@;}`);
    assert.equal(matching(result, names.mutate).length, 0);
    assert.equal(matching(result, names.view).length, 1);
  }
  const string = await complete('#include <string>\nusing Alias=const std::string;void f(){Alias s;s.@;}');
  assert.equal(matching(string, 'append').length, 0);
  assert.equal(matching(string, 'assign').length, 0);
  assert.ok(matching(string, 'substr').length > 0);
});

test('real driver translation unit applies semantics at user.inc UTF16 cursor and keeps native source mapping', async () => {
  const marked = `using Alias=const std::string;void solve(){const char* note="中文😀";Alias s;s.@;}`;
  const result = await complete(marked, { sourcePath: 'user.inc', translationUnit: 'driver.cpp', files: [
    { path: 'driver.cpp', role: 'driver', text: '#include <string>\n#include "user.inc"\nint main(){solve();}' },
  ] });
  assert.equal(matching(result, 'append').length, 0);
  assert.ok(matching(result, 'substr').length > 0);
  assert.equal(result.result.sourcePath, 'user.inc');
  assert.equal(result.native.argv.at(-1), '/project/driver.cpp');
  assert.ok(result.native.argv.some(arg => arg.startsWith('-code-completion-at=/project/user.inc:1:')));
});
