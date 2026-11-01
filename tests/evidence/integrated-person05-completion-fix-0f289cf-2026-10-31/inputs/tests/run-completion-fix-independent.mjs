// Fixed repair stage. Original fixtures/oracle remain immutable; identity is independently derived.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadCompletionFixtures} from './lib/completion-fixtures.mjs';
import {requestFromFixture, evaluateCompletion, evaluateNativePosition} from './lib/completion-oracle.mjs';
import {evaluateCompletionFix} from './lib/completion-fix-oracle.mjs';
import {generateCompletionFixFixtures} from './lib/completion-fix-fixtures.mjs';
import {generateCompletionFixLateFixtures} from './lib/completion-fix-late-fixtures.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo), args = process.argv.slice(2), options = {};
while (args.length) {
  const key = args.shift();
  assert(['--target-root', '--target-commit', '--evidence-dir', '--identity-summary', '--nonce', '--list'].includes(key) && !(key in options), key);
  options[key] = key === '--list' ? true : args.shift(); assert(options[key] !== undefined);
}
const nonce = options['--nonce'] ?? randomBytes(6).toString('hex');
const original = await loadCompletionFixtures();
const extraPath = 'tests/evidence/integrated-person05-completion-runtime-bddae576-2026-10-30/availability-run-01/fixture.json';
const extraBytes = await readFile(new URL(extraPath, repo));
const extra = JSON.parse(extraBytes);
assert.equal(extra.id, 'attribute-availability-supplement');
assert.deepEqual(extra.expect.contains, ['personAllowed', 'personDeprecated']);
assert.deepEqual(extra.expect.inaccessibleOrAbsent, ['personBlocked']);
const fixtures = [
  ...original.filter(fixture => fixture.expect.trigger !== 'none').map(fixture => ({...fixture, group: 'original33-backend'})),
  {...extra, group: 'original-extra'},
  ...generateCompletionFixFixtures(nonce).map(fixture => ({...fixture, group: 'randomized11'})),
  ...generateCompletionFixLateFixtures(nonce).map(fixture => ({...fixture, group: 'late2'}))
];
assert.equal(fixtures.length, 44);
if (options['--list']) {
  console.log(JSON.stringify({stage: 'list-only', nonce, actualProviderCalls: 0,
    groups: {original33Backend: 30, originalExtra: 1, randomized: 11, late: 2, unchangedUiInherited: 3},
    cases: fixtures.map(({id, group, expect, signatures}) => ({id, group, expect, signatures}))}, null, 2));
} else {
  assert.match(options['--target-commit'] ?? '', /^[a-f0-9]{40}$/);
  assert(options['--target-root'] && options['--evidence-dir'] && options['--identity-summary']);
  const expectedCommit = options['--target-commit'], targetPath = resolve(options['--target-root']);
  const target = pathToFileURL(targetPath + sep), evidencePath = resolve(options['--evidence-dir']);
  assert.match(relative(resolve(cwd, 'tests/evidence'), evidencePath).replaceAll('\\', '/'), /^integrated-[a-z0-9.-]+\/queries$/);
  const evidence = pathToFileURL(evidencePath + sep);
  const identityBytes = await readFile(resolve(options['--identity-summary']));
  const identity = JSON.parse(identityBytes);
  assert.equal(identity.passed, true, 'Independent derivation must pass before provider execution');
  assert.equal(identity.expectedCommit, expectedCommit);
  assert.equal(resolve(identity.targetPath), targetPath);
  const resources = identity.resources;
  assert.equal(resources.toolchainId, 'binji-wasm-clang-648c4a89997a+completion-semantics.1');
  assert.equal(resources.compilerResourceHash, 'sha256:b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901');
  const git = (...argv) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...argv],
    {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const productPaths = ['app', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'compiler/resources/completion-semantics-v1.md',
    'compiler/resources/completion-semantics-v1.cpp.patch', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json'];
  assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit);
  git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
  assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '');
  assert.deepEqual(await readFile(new URL('contracts/completion.d.ts', target)), await readFile(new URL('contracts/completion.d.ts', repo)));
  const sourcePaths = git('ls-files', '--', ...productPaths).trim().split(/\r?\n/u).filter(Boolean);
  const fingerprint = async () => Promise.all(sourcePaths.map(async file => {
    const bytes = await readFile(new URL(file, target));
    return {file, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  }));
  const before = await fingerprint(), lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', target)));
  assert.equal(resources.sysrootResourceHash, `sha256:${lock.files.find(file => file.filename === 'sysroot.tar').sha256}`);
  await mkdir(evidence); // Refuse overwrite of any earlier success or failure.
  const save = async (path, value) => {
    const destination = new URL(path, evidence); await mkdir(new URL('./', destination), {recursive: true});
    await writeFile(destination, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  };
  await save('.gitattributes', '* -text\n');
  await save('identity-input.json', identityBytes); await save('original-extra-fixture.json', extraBytes);
  await save('target-before.json', {expectedCommit, targetPath, resources, sourceFingerprints: before});
  await save('inventory.json', {nonce, groups: {original33Backend: 30, originalExtra: 1, randomized11: 11, late2: 2, inheritedUi: 3}, fixtures});
  for (const path of ['tests/run-completion-fix-independent.mjs', 'tests/lib/completion-native-worker.mjs',
    'tests/lib/completion-fixtures.mjs', 'tests/lib/completion-oracle.mjs', 'tests/lib/completion-fix-oracle.mjs',
    'tests/lib/completion-fix-fixtures.mjs', 'tests/lib/completion-fix-late-fixtures.mjs'])
    await save(`inputs/${path}`, await readFile(new URL(path, repo)));
  const runId = randomUUID(), records = [], progress = [], workers = [], replies = new Map(), cleanupErrors = [];
  const requests = fixtures.map((fixture, index) => ({fixture, request: requestFromFixture(fixture, `p05-fix-${runId}-${fixture.id}`, index + 1)}));
  async function observe(route, fixture, request, action) {
    await save(`${route}/${fixture.id}/request.json`, request);
    const started = performance.now();
    try {
      const actual = await action(), result = route === 'native' ? actual.result : actual;
      await save(`${route}/${fixture.id}/actual.json`, actual);
      if (actual.native) {
        await save(`${route}/${fixture.id}/clang-stdout.txt`, actual.native.stdout ?? '');
        await save(`${route}/${fixture.id}/clang-stderr.txt`, actual.native.stderr ?? '');
      }
      const evaluation = fixture.group.startsWith('original') ? evaluateCompletion(fixture, request, result, resources) :
        evaluateCompletionFix(fixture, request, result, resources);
      const position = route === 'native' ? evaluateNativePosition(fixture, request, actual.native) : null;
      if (position && !position.passed) {
        evaluation.verdict = 'failed'; evaluation.errors.push({category: 'coordinate', code: 'native-position', detail: position});
      }
      let equivalent = null;
      if (route === 'adapter') replies.set(fixture.id, result);
      else {
        try { assert.deepEqual(result, replies.get(fixture.id)); equivalent = true; }
        catch { equivalent = false; evaluation.verdict = 'failed'; evaluation.errors.push({category: 'route', code: 'public-native-disagree'}); }
      }
      const record = {id: fixture.id, group: fixture.group, route, elapsedMs: performance.now() - started, ...evaluation, position, equivalent};
      records.push(record); await save(`${route}/${fixture.id}/evaluation.json`, record);
      console.log(`${route} ${fixture.id}: ${record.verdict}`);
    } catch (error) {
      const record = {id: fixture.id, group: fixture.group, route, verdict: 'infrastructure-failed', error: {message: error.message, stack: error.stack}};
      records.push(record); await save(`${route}/${fixture.id}/error.json`, record);
      console.log(`${route} ${fixture.id}: infrastructure-failed ${error.message}`);
    }
  }
  const {CompletionAdapter} = await import(new URL('compiler/src/completion-adapter.mjs', target));
  let currentCase;
  const adapter = new CompletionAdapter({lock, timeoutMs: 45000, onProgress: event => progress.push({id: currentCase, event}), createWorker: () => {
    const worker = new Worker(new URL('compiler/src/completion-worker.mjs', target), {execArgv: []});
    const record = {worker, initialThreadId: worker.threadId}; workers.push(record);
    worker.once('exit', code => {record.exitCode = code;}); return worker;
  }});
  try {
    for (const {fixture, request} of requests) {
      currentCase = fixture.id; await observe('adapter', fixture, request, () => adapter.complete(request));
    }
  } finally {
    try { await adapter.dispose(); } catch (error) { cleanupErrors.push({phase: 'adapter-dispose', message: error.message}); }
    for (const record of workers) if (record.worker.threadId !== -1) await record.worker.terminate();
  }
  const nativeWorker = new Worker(new URL('./lib/completion-native-worker.mjs', import.meta.url), {workerData: {targetRootHref: target.href}, execArgv: []});
  const nativeState = {worker: nativeWorker, initialThreadId: nativeWorker.threadId}; workers.push(nativeState);
  const pending = new Map(); let dead = null;
  const fail = error => {dead = error; for (const task of pending.values()) task.reject(error); pending.clear();};
  nativeWorker.once('error', fail);
  nativeWorker.once('exit', code => {nativeState.exitCode = code; fail(new Error(`Native evidence Worker exited ${code}`));});
  nativeWorker.on('message', message => {
    const task = pending.get(message.id); if (!task) return; pending.delete(message.id);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve({...message.actual, resourceReads: message.reads});
  });
  const native = request => new Promise((done, reject) => {
    if (dead) {reject(dead); return;}
    const timer = setTimeout(() => {fail(new Error('Native harness deadline 45000ms')); void nativeWorker.terminate();}, 45000);
    pending.set(request.requestId, {resolve: value => {clearTimeout(timer); done(value);}, reject: error => {clearTimeout(timer); reject(error);}});
    nativeWorker.postMessage({id: request.requestId, lock, request});
  });
  try {for (const {fixture, request} of requests) await observe('native', fixture, request, () => native(request));}
  finally {try {await nativeWorker.terminate();} catch (error) {cleanupErrors.push({phase: 'native-terminate', message: error.message});}}
  const after = await fingerprint();
  let targetUnchanged = JSON.stringify(before) === JSON.stringify(after) && git('rev-parse', 'HEAD').trim() === expectedCommit;
  try {git('diff', '--exit-code', expectedCommit, '--', ...productPaths);} catch {targetUnchanged = false;}
  const workerRecords = workers.map(({worker, ...state}) => ({...state, finalThreadId: worker.threadId}));
  const logical = fixtures.map(fixture => {
    const rows = records.filter(record => record.id === fixture.id);
    return {id: fixture.id, group: fixture.group, passed: rows.length === 2 && rows.every(row => row.verdict === 'passed')};
  });
  const passed = targetUnchanged && cleanupErrors.length === 0 && workerRecords.every(record => record.finalThreadId === -1) && logical.every(row => row.passed);
  await save('progress.json', progress); await save('worker-release.json', workerRecords);
  await save('target-after.json', {expectedCommit, targetUnchanged, sourceFingerprints: after});
  await save('summary.json', {requestId: 'CC-20261030-05', expectedCommit, targetPath, nonce, passed, resources, targetUnchanged,
    logicalCases: logical.length, providerResponses: records.filter(row => row.verdict !== 'infrastructure-failed').length,
    groups: Object.fromEntries(['original33-backend', 'original-extra', 'randomized11', 'late2'].map(group => [group,
      {passed: logical.filter(row => row.group === group && row.passed).length, total: logical.filter(row => row.group === group).length}])),
    logical, records, cleanupErrors, workers: workerRecords,
    scope: 'Repair semantics on the fixed compiler branch. Three original UI cases reuse previous unchanged UI evidence; no new bundle/browser/iPad acceptance.'});
  console.log(JSON.stringify({passed, expectedCommit, nonce, logicalPass: logical.filter(row => row.passed).length, logicalTotal: logical.length, replies: records.length}, null, 2));
  if (!passed) process.exitCode = 1;
}
