// Independent recipe/identity checks. No Clang query, CompilerProbe or browser runs here.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {requestFromFixture} from './lib/completion-oracle.mjs';
import {offsetToClangPosition} from './lib/completion-fixtures.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const options = {}, argv = process.argv.slice(2);
while (argv.length) {
  const key = argv.shift();
  assert(['--target-root', '--target-commit', '--evidence-dir'].includes(key) && !(key in options));
  options[key] = argv.shift(); assert(options[key] && !options[key].startsWith('--'));
}
assert.match(options['--target-commit'] ?? '', /^[a-f0-9]{40}$/);
assert(options['--target-root'] && options['--evidence-dir']);
const targetPath = resolve(options['--target-root']), target = pathToFileURL(targetPath + sep);
const expectedCommit = options['--target-commit'], evidencePath = resolve(options['--evidence-dir']);
assert.match(relative(resolve(cwd, 'tests/evidence'), evidencePath).replaceAll('\\', '/'),
  /^integrated-[a-z0-9.-]+\/identity(?:-[a-z0-9.-]+)?$/);
const evidence = pathToFileURL(evidencePath + sep);
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...args],
  {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const productPaths = ['compiler/src', 'compiler/resources/toolchain.lock.json',
  'compiler/resources/completion-semantics-v1.md', 'compiler/resources/completion-semantics-v1.cpp.patch', 'contracts'];
assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit);
git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '');
const sourcePaths = git('ls-files', '--', ...productPaths).trim().split(/\r?\n/u).filter(Boolean);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fingerprints = async () => Promise.all(sourcePaths.map(async file => {
  const bytes = await readFile(new URL(file, target)); return {file, byteLength: bytes.length, sha256: sha(bytes)};
}));
const before = await fingerprints();
await mkdir(evidence); // Parent round is created by the caller; never overwrite an attempt.
async function save(file, value) {
  const path = new URL(file, evidence); await mkdir(new URL('./', path), {recursive: true});
  await writeFile(path, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
await save('.gitattributes', '* -text\n');
await save('script.mjs', await readFile(new URL('tests/completion-fix-integrity-independent.mjs', repo)));
await save('target-before.json', {targetPath, expectedCommit, fingerprints: before});

// Manually reviewed fixed recipe. No production derivation or Wasm inspector is
// used to generate the independent expected bytes or structure below.
const recipe = {
  sourceToolchainId: 'binji-wasm-clang-648c4a89997a', sourceByteLength: 31214472,
  sourceHash: 'sha256:2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d',
  toolchainId: 'binji-wasm-clang-648c4a89997a+completion-semantics.1', byteLength: 31214494,
  compilerResourceHash: 'sha256:b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901',
  insertionOffset: 18774355, insertionHex: '200228021041ff00714119460440200228021821020b',
  guards: [[0, '0061736d01000000'], [199707, '0acfdd800cb2a803'], [18773317, 'f80a01047f230041'],
    [18106907, '0240200a2802184103470d00200641106a'],
    [18774345, '20012802002202450d00200228021041ff0071414e6a41034b0d00200210cbfb020d00200210e9bd']],
  replacements: [[18106914, '410347', '41014d'], [18773317, 'f80a', '8e0b'], [199708, 'cfdd800c', 'e5dd800c']]
};
const hex = value => Buffer.from(value, 'hex');
const checks = [];
async function check(name, action) {
  try { const detail = await action(); checks.push({name, passed: true, ...(detail === undefined ? {} : {detail})}); return detail; }
  catch (error) { checks.push({name, passed: false, error: {message: error.message, stack: error.stack}}); return undefined; }
}
function readULEB(bytes, cursor, end = bytes.length) {
  let value = 0, shift = 0, byte;
  do {
    assert(cursor.offset < end && shift < 35, 'Bounded unsigned LEB32');
    byte = bytes[cursor.offset++]; value += (byte & 127) * 2 ** shift; shift += 7;
  } while (byte & 128);
  assert(value <= 0xffffffff, 'Unsigned LEB32 range');
  return value;
}
function sections(bytes) {
  assert.deepEqual(bytes.subarray(0, 8), hex('0061736d01000000'), 'Wasm header/version');
  const result = [], cursor = {offset: 8};
  while (cursor.offset < bytes.length) {
    const headerOffset = cursor.offset, id = bytes[cursor.offset++];
    const byteLength = readULEB(bytes, cursor), payloadOffset = cursor.offset, end = payloadOffset + byteLength;
    assert(end <= bytes.length, 'Section payload stays inside file');
    result.push({id, headerOffset, payloadOffset, byteLength, end}); cursor.offset = end;
  }
  assert.equal(cursor.offset, bytes.length); return result;
}
function functionImportCount(bytes, allSections) {
  const imports = allSections.find(section => section.id === 2); if (!imports) return 0;
  const cursor = {offset: imports.payloadOffset}, count = readULEB(bytes, cursor, imports.end); let functions = 0;
  const name = () => { const length = readULEB(bytes, cursor, imports.end); cursor.offset += length; assert(cursor.offset <= imports.end); };
  const limits = () => {
    const flags = readULEB(bytes, cursor, imports.end); assert((flags & ~3) === 0, 'Expected wasm32 limits');
    readULEB(bytes, cursor, imports.end); if (flags & 1) readULEB(bytes, cursor, imports.end);
  };
  for (let index = 0; index < count; index++) {
    name(); name(); assert(cursor.offset < imports.end); const kind = bytes[cursor.offset++];
    if (kind === 0) { functions++; readULEB(bytes, cursor, imports.end); }
    else if (kind === 1) { assert(cursor.offset < imports.end); cursor.offset++; limits(); }
    else if (kind === 2) limits();
    else if (kind === 3) { cursor.offset += 2; assert(cursor.offset <= imports.end); }
    else if (kind === 4) { readULEB(bytes, cursor, imports.end); readULEB(bytes, cursor, imports.end); }
    else assert.fail(`Unknown import kind ${kind}`);
  }
  assert.equal(cursor.offset, imports.end, 'Import section is completely framed'); return functions;
}
function bodies(bytes, allSections) {
  const code = allSections.find(section => section.id === 10); assert(code);
  const cursor = {offset: code.payloadOffset}, count = readULEB(bytes, cursor, code.end);
  const imported = functionImportCount(bytes, allSections), result = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    const headerOffset = cursor.offset, byteLength = readULEB(bytes, cursor, code.end), payloadOffset = cursor.offset;
    const end = payloadOffset + byteLength; assert(end <= code.end, 'Function body stays inside code section');
    result.push({functionIndex: imported + ordinal, headerOffset, payloadOffset, byteLength, end}); cursor.offset = end;
  }
  assert.equal(cursor.offset, code.end, 'All code bytes belong to framed function bodies');
  const functions = allSections.find(section => section.id === 3); assert(functions);
  const declarationCursor = {offset: functions.payloadOffset};
  assert.equal(readULEB(bytes, declarationCursor, functions.end), count, 'Function/code counts agree');
  for (let index = 0; index < count; index++) readULEB(bytes, declarationCursor, functions.end);
  assert.equal(declarationCursor.offset, functions.end); return result;
}

let resources, independentDerivation, fatalError = null, original, originalBefore, lock;
try {
  lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', target), 'utf8'));
  await save('trusted-lock.json', lock); await save('independent-recipe.json', recipe);
  for (const file of ['compiler/src/completion-semantics.mjs', 'compiler/src/completion-adapter.mjs',
    'compiler/resources/completion-semantics-v1.md', 'compiler/resources/completion-semantics-v1.cpp.patch'])
    await save(`target-inputs/${file}`, await readFile(new URL(file, target)));
  const sourceEntry = lock.files.find(file => file.filename === 'clang'), sysrootEntry = lock.files.find(file => file.filename === 'sysroot.tar');
  assert(sourceEntry && sysrootEntry);
  original = await readFile(new URL(`compiler/resources/${lock.vendorDirectory}/clang`, target)); originalBefore = sha(original);
  const sysroot = await readFile(new URL(`compiler/resources/${lock.vendorDirectory}/sysroot.tar`, target));
  resources = {toolchainId: recipe.toolchainId, compilerResourceHash: recipe.compilerResourceHash, sysrootResourceHash: sha(sysroot)};
  await check('independent locked source and sysroot identities', () => {
    assert.equal(lock.toolchainId, recipe.sourceToolchainId); assert.equal(original.length, recipe.sourceByteLength);
    assert.equal(sourceEntry.byteLength, recipe.sourceByteLength); assert.equal(`sha256:${sourceEntry.sha256}`, recipe.sourceHash);
    assert.equal(originalBefore, recipe.sourceHash); assert.equal(sysroot.length, sysrootEntry.byteLength);
    assert.equal(resources.sysrootResourceHash, `sha256:${sysrootEntry.sha256}`);
    return {sourceByteLength: original.length, sourceHash: originalBefore, sysrootByteLength: sysroot.length, resources};
  });
  assert.equal(originalBefore, recipe.sourceHash); assert.equal(original.length, recipe.sourceByteLength);
  const independent = await check('independent binary derivation and complete section/function framing', () => {
    for (const [offset, bytes] of recipe.guards) assert.deepEqual(original.subarray(offset, offset + hex(bytes).length), hex(bytes), `Original guard at ${offset}`);
    const beforeSections = sections(original), beforeBodies = bodies(original, beforeSections);
    const addResult = beforeBodies.find(body => body.headerOffset === 18773317); assert(addResult);
    assert.equal(addResult.functionIndex, 40648); assert.equal(addResult.byteLength, 1400);
    assert(recipe.insertionOffset >= addResult.payloadOffset && recipe.insertionOffset < addResult.end);
    assert.equal(beforeSections.find(section => section.id === 10).byteLength, 25177807);
    const insertion = hex(recipe.insertionHex); assert.equal(insertion.length, 22);
    const bytes = Buffer.concat([original.subarray(0, recipe.insertionOffset), insertion, original.subarray(recipe.insertionOffset)]);
    for (const [offset, beforeHex, afterHex] of recipe.replacements) {
      assert.deepEqual(bytes.subarray(offset, offset + hex(beforeHex).length), hex(beforeHex));
      assert.equal(hex(beforeHex).length, hex(afterHex).length); hex(afterHex).copy(bytes, offset);
    }
    assert.equal(bytes.length, recipe.byteLength); assert.equal(sha(bytes), recipe.compilerResourceHash);
    const afterSections = sections(bytes), afterBodies = bodies(bytes, afterSections);
    assert.deepEqual(afterSections.map(section => section.id), beforeSections.map(section => section.id));
    for (const [index, beforeSection] of beforeSections.entries()) {
      const afterSection = afterSections[index];
      assert.equal(afterSection.byteLength, beforeSection.byteLength + (beforeSection.id === 10 ? 22 : 0));
      assert.equal(afterSection.payloadOffset, beforeSection.payloadOffset + (beforeSection.payloadOffset > recipe.insertionOffset ? 22 : 0));
      if (beforeSection.id !== 10) assert.deepEqual(bytes.subarray(afterSection.payloadOffset, afterSection.end), original.subarray(beforeSection.payloadOffset, beforeSection.end));
    }
    assert.equal(afterBodies.length, beforeBodies.length);
    const changedBodies = [];
    for (const [index, beforeBody] of beforeBodies.entries()) {
      const afterBody = afterBodies[index]; assert.equal(afterBody.functionIndex, beforeBody.functionIndex);
      const beforePayload = original.subarray(beforeBody.payloadOffset, beforeBody.end), afterPayload = bytes.subarray(afterBody.payloadOffset, afterBody.end);
      if (!beforePayload.equals(afterPayload)) changedBodies.push({functionIndex: beforeBody.functionIndex, before: beforeBody, after: afterBody});
    }
    assert.deepEqual(changedBodies.map(body => body.functionIndex), [39589, 40648]);
    assert.equal(changedBodies.find(body => body.functionIndex === 40648).after.byteLength, 1422);
    assert.equal(changedBodies.find(body => body.functionIndex === 39589).after.byteLength,
      changedBodies.find(body => body.functionIndex === 39589).before.byteLength);
    assert.equal(WebAssembly.validate(bytes), true); assert.equal(sha(original), originalBefore);
    independentDerivation = {byteLength: bytes.length, sha256: sha(bytes), insertedBytes: insertion.length,
      sectionCount: afterSections.length, functionBodies: afterBodies.length, changedBodies, sectionsBefore: beforeSections, sectionsAfter: afterSections};
    return bytes;
  });
  // The large derived bytes remain in memory, not in evidence or Git.
  if (independent instanceof Uint8Array) {
    checks.at(-1).detail = independentDerivation;
    const product = await import(new URL('compiler/src/completion-semantics.mjs', target));
    await check('actual production derivation exactly equals independent bytes', async () => {
      const actual = await product.deriveCompletionCompiler(original);
      assert.deepEqual(Buffer.from(actual), independent); assert.equal(sha(original), originalBefore);
      assert.deepEqual(product.completionResourceIdentity(lock), resources);
      return {byteLength: actual.length, sha256: sha(actual), originalUnchanged: true};
    });
    for (const [name, bytes] of [['truncated-source', original.subarray(0, original.length - 1)],
      ['same-length-source-hash-corruption', Buffer.from(original)]]) {
      if (name === 'same-length-source-hash-corruption') bytes[recipe.insertionOffset] ^= 1;
      await check(`production rejects ${name}`, async () => {
        await assert.rejects(product.deriveCompletionCompiler(bytes), /source integrity failed/u);
        return {faultInjection: true, byteLength: bytes.length, inputHash: sha(bytes)};
      });
    }
    const moduleURL = new URL('compiler/src/completion-semantics.mjs', target);
    const moduleSource = (await readFile(moduleURL, 'utf8')).replace(/from '(\.\/[^']+)'/gu,
      (_match, path) => `from '${new URL(path, moduleURL).href}'`);
    const mutations = [
      ['wrong-header-guard', '0acfdd800cb2a803', '0bcfdd800cb2a803', /instruction\/header guard failed/u],
      ['wrong-instruction-before-guard', '0240200a2802184103470d00200641106a', '0340200a2802184103470d00200641106a', /instruction\/header guard failed/u],
      ['wrong-derived-whole-sha', recipe.compilerResourceHash.slice(7), 'c15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901', /derived integrity failed/u],
      ['wrong-function-body-length', "fromHex('8e0b')", "fromHex('8f0b')", /derived integrity failed/u]
    ];
    for (const [name, from, to, expected] of mutations) await check(`isolated faulty production recipe rejects ${name}`, async () => {
      assert.equal(moduleSource.split(from).length, 2, 'One explicit fault injection target');
      const source = moduleSource.replace(from, to); await save(`fault-injection/${name}.mjs`, source);
      const isolated = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      let rejection;
      try { await isolated.deriveCompletionCompiler(original); } catch (error) { rejection = {message: error.message}; }
      assert(rejection, 'Faulty recipe must reject'); assert.match(rejection.message, expected);
      return {faultInjection: true, sourceHash: sha(Buffer.from(source)), rejection};
    });
    const {CompletionAdapter} = await import(new URL('compiler/src/completion-adapter.mjs', target));
    for (const [name, mutate] of [
      ['wrong-source-toolchain-id', value => { value.toolchainId += '-wrong'; }],
      ['wrong-source-compiler-hash', value => { value.files.find(entry => entry.filename === 'clang').sha256 = '0'.repeat(64); }],
      ['wrong-source-compiler-length', value => { value.files.find(entry => entry.filename === 'clang').byteLength++; }]
    ]) await check(`public adapter constructor rejects ${name}`, () => {
      const corrupted = structuredClone(lock); mutate(corrupted);
      assert.throws(() => new CompletionAdapter({lock: corrupted}), /Unsupported source compiler/u);
      return {faultInjection: true};
    });
    const text = 'struct Safe { int member; }; void probe() { Safe value; value. }\n';
    const fixture = {id: 'controlled-identity-only', language: {language: 'cpp', standard: 'c++17'},
      translationUnit: 'main.cpp', sourcePath: 'main.cpp', files: [{path: 'main.cpp', role: 'user', text}],
      coordinates: offsetToClangPosition(text, text.lastIndexOf('.') + 1), expect: {trigger: '.', support: 'required', contains: ['member']}};
    const identityCases = [['correct-derived-identity', {}], ['pretend-original-compiler-hash', {compilerResourceHash: recipe.sourceHash}],
      ['pretend-original-toolchain-id', {toolchainId: recipe.sourceToolchainId}],
      ['wrong-derived-toolchain-id', {toolchainId: `${recipe.toolchainId}-wrong`}],
      ['wrong-derived-compiler-hash', {compilerResourceHash: `sha256:${'0'.repeat(64)}`}]];
    for (const [name, mutation] of identityCases) await check(`public adapter controlled reply: ${name}`, async () => {
      const request = requestFromFixture(fixture, `person05-integrity-${randomUUID()}`, 1), workers = [];
      class ControlledWorker extends EventEmitter {
        constructor() { super(); this.terminateCalls = 0; workers.push(this); }
        postMessage({request: received}) {
          const result = {requestId: received.requestId, documentVersion: received.documentVersion,
            snapshotId: received.snapshot.snapshotId, sourceHash: received.snapshot.sourceHash, sourcePath: received.sourcePath,
            offset: received.offset, status: 'succeeded', isIncomplete: false, diagnostics: [], ...resources, ...mutation,
            items: [{id: 'controlled-member', label: 'member', insertText: 'member', detail: 'int member', kind: 'field',
              replaceRange: {startOffset: received.offset, endOffset: received.offset}}]};
          this.emitted = result; queueMicrotask(() => this.emit('message', {kind: 'result', result}));
        }
        terminate() { this.terminateCalls++; queueMicrotask(() => this.emit('exit', 0)); return Promise.resolve(0); }
      }
      const adapter = new CompletionAdapter({lock, createWorker: () => new ControlledWorker(), timeoutMs: 1000});
      let actual;
      try {
        actual = await adapter.complete(request);
        if (name === 'correct-derived-identity') { assert.equal(actual.status, 'succeeded'); assert.equal(actual.items.length, 1); }
        else {
          assert.equal(actual.status, 'failed'); assert.equal(actual.reason, 'worker-error'); assert.deepEqual(actual.items, []);
          assert(actual.diagnostics.some(item => /Completion resource mismatch:/u.test(item.message)));
        }
      } finally { await adapter.dispose(); }
      assert.equal(workers.length, 1); assert.equal(workers[0].terminateCalls, 1);
      await save(`controlled-adapter/${name}.json`, {kind: 'synthetic-worker-reply-not-real-provider', request,
        emitted: workers[0].emitted, actual, terminateCalls: workers[0].terminateCalls});
      return {controlledWorker: true, actualStatus: actual.status, reason: actual.reason ?? null, terminateCalls: 1};
    });
  }
} catch (error) { fatalError = {message: error.message, stack: error.stack}; }
let targetUnchanged = false;
const after = await fingerprints();
await check('fixed target and original full compiler remain byte-identical', async () => {
  targetUnchanged = JSON.stringify(before) === JSON.stringify(after) && git('rev-parse', 'HEAD').trim() === expectedCommit;
  git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
  assert(targetUnchanged); if (original) {
    assert.equal(sha(original), originalBefore);
    assert.equal(sha(await readFile(new URL(`compiler/resources/${lock.vendorDirectory}/clang`, target))), originalBefore,
      'Original vendor compiler on disk remains unchanged');
    assert.equal(sha(await readFile(new URL(`compiler/resources/${lock.vendorDirectory}/sysroot.tar`, target))), resources.sysrootResourceHash,
      'Original sysroot on disk remains unchanged');
  }
  return {targetUnchanged, originalHash: original ? sha(original) : null};
});
await save('target-after.json', {expectedCommit, fingerprints: after, targetUnchanged});
const passed = !fatalError && targetUnchanged && checks.length > 0 && checks.every(item => item.passed);
await save('summary.json', {requestId: 'CC-20261030-05', kind: 'independent-recipe-and-controlled-adapter-identity',
  expectedCommit, targetPath, passed, resources, independentDerivation, targetUnchanged, checks, fatalError,
  actualProviderQueries: 0, actualCompilerProbeCalls: 0, controlledAdapterReplies: checks.filter(item => item.detail?.controlledWorker).length,
  notes: ['Independent expected bytes and framing do not use production derive/inspect.',
    'Large source/derived binaries are hashed in memory and are not committed.',
    'Faulty recipe modules and worker replies are deliberate negative controls, not actual product failures.',
    'No Clang instruction, compilation, browser or physical iPad execution is performed.']});
console.log(JSON.stringify({passed, expectedCommit, resources, checks: checks.length,
  failures: checks.filter(item => !item.passed).map(item => ({name: item.name, error: item.error})), fatalError, targetUnchanged}, null, 2));
if (!passed) process.exitCode = 1;
