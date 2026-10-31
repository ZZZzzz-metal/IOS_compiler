// Real complete-program call controls. Run only against an explicitly fixed target.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {generateCompletionFixFixtures} from './lib/completion-fix-fixtures.mjs';
import {generateCompletionFixLateFixtures} from './lib/completion-fix-late-fixtures.mjs';
import {callabilitySemanticExpectation, evaluateCallabilityControl} from './lib/completion-fix-callability-oracle.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo), args = process.argv.slice(2), options = {};
while (args.length) {
  const key = args.shift();
  assert(['--target-root', '--target-commit', '--evidence-dir', '--nonce'].includes(key) && !(key in options), `Invalid argument ${key}`);
  options[key] = args.shift(); assert(options[key] && !options[key].startsWith('--'), `${key} needs a value`);
}
assert.match(options['--target-commit'] ?? '', /^[0-9a-f]{40}$/u);
assert.match(options['--nonce'] ?? '', /^[0-9a-f]{8,24}$/u);
assert(options['--target-root'] && options['--evidence-dir']);
const targetPath = resolve(options['--target-root']), target = pathToFileURL(targetPath + sep), expectedCommit = options['--target-commit'];
const evidencePath = resolve(options['--evidence-dir']);
const withinEvidence = relative(resolve(cwd, 'tests/evidence'), evidencePath).replaceAll('\\', '/');
assert.match(withinEvidence, /^integrated-[a-z0-9.-]+\/callability(?:-[a-z0-9.-]+)?$/u, 'Callability evidence must be a new integrated round subdirectory');
const evidence = pathToFileURL(evidencePath + sep), nonce = options['--nonce'];
const git = (...argv) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...argv],
  {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const productPaths = ['app', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json'];
function checkTarget() {
  assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit, 'Fixed target HEAD changed');
  git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
  assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '', 'Untracked product inputs');
}
checkTarget();
const sourcePaths = git('ls-files', '--', ...productPaths).trim().split(/\r?\n/u).filter(Boolean);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fingerprint = async paths => Promise.all(paths.map(async file => {
  const bytes = await readFile(new URL(file, target)); return {file, byteLength: bytes.length, sha256: sha(bytes)};
}));
const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', target), 'utf8'));
assert(Array.isArray(lock.files) && lock.vendorDirectory === 'vendor/wasm-clang');
const resourcePaths = lock.files.map(entry => `compiler/resources/${lock.vendorDirectory}/${entry.filename}`);
const before = await fingerprint(sourcePaths), resourcesBefore = await fingerprint(resourcePaths);
for (const [index, actual] of resourcesBefore.entries()) {
  assert.equal(actual.byteLength, lock.files[index].byteLength, actual.file);
  assert.equal(actual.sha256, `sha256:${lock.files[index].sha256}`, actual.file);
}
const fullCompilerResources = {toolchainId: lock.toolchainId,
  compilerResourceHash: `sha256:${lock.files.find(entry => entry.filename === 'clang').sha256}`,
  linkerResourceHash: `sha256:${lock.files.find(entry => entry.filename === 'lld').sha256}`,
  sysrootResourceHash: `sha256:${lock.files.find(entry => entry.filename === 'sysroot.tar').sha256}`};
await mkdir(evidence); // Refuse to overwrite any previous attempt.
async function save(file, value) {
  const destination = new URL(file, evidence); await mkdir(new URL('./', destination), {recursive: true});
  await writeFile(destination, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
await save('.gitattributes', '* -text\n');
const inputs = ['tests/run-completion-fix-callability.mjs', 'tests/lib/completion-fix-fixtures.mjs',
  'tests/lib/completion-fix-late-fixtures.mjs', 'tests/lib/completion-fix-callability-oracle.mjs',
  'tests/completion-fix-callability-oracle-checks.mjs'];
for (const file of inputs) await save(`inputs/${file}`, await readFile(new URL(file, repo)));
await save('target-before.json', {expectedCommit, targetPath, fingerprints: before, resources: resourcesBefore, fullCompilerResources});
await save('invocation.json', {argv: process.argv, node: process.version, nonce, startedAt: new Date().toISOString()});
const original = generateCompletionFixFixtures(nonce), late = generateCompletionFixLateFixtures(nonce);
assert.equal(original.length, 11); assert.equal(original.reduce((count, item) => count + item.controls.length, 0), 24);
assert.equal(late.length, 2); assert.equal(late.reduce((count, item) => count + item.controls.length, 0), 3);
const fixtures = [...original.map(fixture => ({...fixture, controlSet: 'original-11-controls'})),
  ...late.map(fixture => ({...fixture, controlSet: 'late-controls'}))];
await save('controls-inventory.json', {nonce, originalFixtureQueries: 11, originalControls: 24, lateFixtureQueries: 2, lateControls: 3,
  notes: 'These complete programs are callability controls, not additional completion queries or replacements for original incomplete inputs.', fixtures});
const {CompilerProbe} = await import(new URL('compiler/src/compiler-probe.mjs', target));
const {createSnapshot} = await import(new URL('compiler/src/source.mjs', target));
const {evidenceJSON} = await import(new URL('compiler/src/toolchain-engine.mjs', target));
const records = [], workers = [], infrastructureErrors = [], runId = randomUUID(), began = performance.now();
let sequence = 0, actualCompilerProbeCalls = 0, actualCompilerProbeResponses = 0;
const event = (kind, detail = {}) => {
  const record = {sequence: ++sequence, at: new Date().toISOString(), elapsedMs: performance.now() - began, kind, ...detail};
  appendFileSync(new URL('events.jsonl', evidence), JSON.stringify(record) + '\n'); return record;
};
const errorJSON = error => ({message: error.message, stack: error.stack});
async function bounded(promise, label, milliseconds) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: independent deadline ${milliseconds}ms`)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
function trackedWorker(label) {
  const worker = new Worker(new URL('compiler/src/compiler-worker.mjs', target), {execArgv: []});
  const state = {worker, label, startedThreadId: worker.threadId, terminations: []}; workers.push(state);
  state.exitPromise = new Promise(done => worker.once('exit', code => { state.exit = event('worker-exit', {label, code, threadIdAfter: worker.threadId}); done(state.exit); }));
  worker.on('error', error => { state.error = errorJSON(error); event('worker-error', {label, error: state.error}); });
  const terminate = worker.terminate.bind(worker);
  worker.terminate = (...args) => {
    event('worker-terminate-called', {label, threadId: worker.threadId});
    const promise = Promise.resolve(terminate(...args)).then(code => { event('worker-terminate-settled', {label, code, threadIdAfter: worker.threadId}); return code; });
    state.terminations.push(promise); return promise;
  };
  event('worker-created', {label, threadId: worker.threadId}); return worker;
}
async function release(states) {
  for (const state of states) {
    if (state.worker.threadId !== -1) await bounded(state.worker.terminate(), `${state.label} terminate`, 10000);
    await bounded(Promise.all(state.terminations), `${state.label} terminate settlement`, 10000);
    await bounded(state.exitPromise, `${state.label} exit event`, 10000);
    assert.equal(state.worker.threadId, -1, `${state.label}: Worker must be released`);
  }
}

for (const fixture of fixtures) {
  for (const control of fixture.controls) {
    const id = `${fixture.id}/${control.id}`, folder = `controls/${id}/`, startedAt = new Date().toISOString(), started = performance.now();
    const firstWorker = workers.length;
    let probe, request;
    const record = {fixtureId: fixture.id, controlId: control.id, controlSet: fixture.controlSet, startedAt, passed: false};
    try {
      checkTarget();
      const semantic = callabilitySemanticExpectation(fixture, control, nonce);
      const snapshot = createSnapshot(control.files, control.translationUnit);
      const expectedFiles = control.files.map(({path, role, text}) => ({path, role, text})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      assert.deepEqual(snapshot.files.map(({path, role, text}) => ({path, role, text})), expectedFiles, 'Snapshot must preserve the exact independent control source');
      assert.equal(snapshot.sourceHash, sha(Buffer.from(JSON.stringify({version: 1, translationUnit: control.translationUnit, files: expectedFiles}), 'utf8')), 'Independent canonical control source hash');
      request = {requestId: `person05-fix-call-${runId}-${fixture.id}-${control.id}`, snapshot,
        language: fixture.language.language, standard: fixture.language.standard, mode: 'run', optimization: 'O0'};
      await save(`${folder}expectation.json`, {expected: control.expect, semantic});
      await save(`${folder}snapshot.json`, snapshot); await save(`${folder}request.json`, request);
      for (const file of control.files) {
        assert.match(file.path, /^[A-Za-z0-9_-]+\.(?:cpp|c|inc)$/u);
        await save(`${folder}source/${file.path}`, file.text);
      }
      probe = new CompilerProbe({timeoutMs: 120000, createWorker: () => trackedWorker(id),
        onProgress: progress => event('compile-progress', {id, progress})});
      event('compile-started', {id, requestId: request.requestId, sourceHash: snapshot.sourceHash});
      actualCompilerProbeCalls++; record.actualCompilerProbeCall = true;
      const result = await bounded(probe.compile(request, {smokeStdin: ''}), id, 135000);
      actualCompilerProbeResponses++;
      const binaryEvidence = {};
      for (const [key, extension] of [['executable', 'wasm'], ['object', 'o']]) if (result[key] instanceof Uint8Array) {
        const bytes = result[key], filename = `${folder}main.${extension}`;
        await save(filename, bytes); binaryEvidence[key] = {file: filename, byteLength: bytes.length, sha256: sha(bytes)};
      }
      await save(`${folder}actual.json`, {...evidenceJSON(result), binaryEvidence});
      await save(`${folder}raw-diagnostics.txt`, result.rawDiagnostics ?? '');
      if (result.smoke) {
        await save(`${folder}smoke.json`, result.smoke);
        await save(`${folder}stdout.txt`, result.smoke.stdout ?? ''); await save(`${folder}stderr.txt`, result.smoke.stderr ?? '');
      }
      const evaluation = evaluateCallabilityControl(control, request, result, fullCompilerResources, semantic);
      await save(`${folder}evaluation.json`, evaluation);
      Object.assign(record, {sourceHash: snapshot.sourceHash, actualStatus: result.status, reason: result.reason ?? null,
        elapsedMs: performance.now() - started, ...evaluation, binaryEvidence,
        actualCompilerIdentity: {toolchainId: result.toolchainId ?? null, compilerResourceHash: result.compilerResourceHash ?? null,
          linkerResourceHash: result.linkerResourceHash ?? null, sysrootResourceHash: result.sysrootResourceHash ?? null}});
      event('compile-evaluated', {id, passed: record.passed, status: result.status, errors: evaluation.errors});
    } catch (error) {
      record.infrastructureError = errorJSON(error); infrastructureErrors.push({id, ...record.infrastructureError});
      await save(`${folder}infrastructure-error.json`, record.infrastructureError); event('compile-infrastructure-error', {id, error: record.infrastructureError});
    } finally {
      try {
        if (probe && request) await probe.cancel(request.requestId);
        await release(workers.slice(firstWorker));
        record.workersReleased = workers.slice(firstWorker).every(state => state.exit && state.worker.threadId === -1);
        assert(workers.length > firstWorker && record.workersReleased, 'Each actual compile must create and release a real worker');
      } catch (error) {
        record.passed = false; record.cleanupError = errorJSON(error); infrastructureErrors.push({id, phase: 'cleanup', ...record.cleanupError});
        await save(`${folder}cleanup-error.json`, record.cleanupError);
      }
      record.elapsedMs = performance.now() - started;
      await save(`${folder}record.json`, record); records.push(record);
    }
  }
}
let targetUnchanged = false;
try {
  const after = await fingerprint(sourcePaths), resourcesAfter = await fingerprint(resourcePaths);
  checkTarget(); assert.deepEqual(after, before, 'Fixed product bytes drifted'); assert.deepEqual(resourcesAfter, resourcesBefore, 'Original locked resource bytes drifted');
  targetUnchanged = true;
  await save('target-after.json', {expectedCommit, targetPath, fingerprints: after, resources: resourcesAfter, targetUnchanged});
} catch (error) {
  infrastructureErrors.push({phase: 'target-after', ...errorJSON(error)}); await save('target-after-error.json', errorJSON(error));
}
await save('workers.json', workers.map(state => ({label: state.label, startedThreadId: state.startedThreadId,
  exit: state.exit ?? null, threadIdAfter: state.worker.threadId, terminateCalls: state.terminations.length, error: state.error ?? null})));
const passed = targetUnchanged && infrastructureErrors.length === 0 && records.length === 27 && actualCompilerProbeCalls === 27 && actualCompilerProbeResponses === 27 && records.every(record => record.passed && record.workersReleased);
const summary = {requestId: 'CC-20261030-05', kind: 'independent-real-callability-controls', expectedCommit, targetPath, nonce,
  passed, targetUnchanged, originalFixtureQueriesUnchanged: 11, originalControlCount: 24, lateFixtureQueries: 2, lateControlCount: 3,
  attemptedControls: records.length, actualCompilerProbeCalls, actualCompilerProbeResponses, actualCompletionQueries: 0, actualBrowserObservations: 0,
  counts: {passed: records.filter(record => record.passed).length, failed: records.filter(record => !record.passed).length,
    infrastructureErrors: infrastructureErrors.length}, fullCompilerResources, records, infrastructureErrors,
  notes: ['These complete programs are separate callability controls; incomplete original completion inputs remain unchanged.',
    'A compiler-exit alone never satisfies a negative: the expected user call and its error/candidate-note reason must match.',
    'Full compilation uses the original locked compiler. Failed CompilerProbe results do not invent absent resource identity or native exitCode.',
    'No completion-provider, browser, debugger or physical-iPad acceptance is claimed by this callability runner.']};
await save('summary.json', summary);
console.log(JSON.stringify({expectedCommit, nonce, evidencePath, passed, targetUnchanged, counts: summary.counts, actualCompilerProbeCalls, actualCompilerProbeResponses}, null, 2));
if (!passed) process.exitCode = 1;
