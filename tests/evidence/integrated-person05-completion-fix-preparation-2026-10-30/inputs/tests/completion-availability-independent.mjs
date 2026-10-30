// Supplemental availability boundary outside the original 33 fixtures.
import assert from 'node:assert/strict';
import {readFile, mkdir} from 'node:fs/promises';
import {writeFileSync, appendFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {offsetToClangPosition} from './lib/completion-fixtures.mjs';
import {requestFromFixture, evaluateCompletion, evaluateNativePosition} from './lib/completion-oracle.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo), args = process.argv.slice(2), options = {};
while (args.length) {
  const key = args.shift(); assert(['--target-root', '--target-commit', '--evidence-dir'].includes(key) && !(key in options));
  options[key] = args.shift(); assert(options[key] && !options[key].startsWith('--'));
}
assert.match(options['--target-commit'] ?? '', /^[0-9a-f]{40}$/);
assert(options['--target-root'] && options['--evidence-dir']);
const targetPath = resolve(options['--target-root']), target = pathToFileURL(targetPath + sep), expectedCommit = options['--target-commit'];
const evidencePath = resolve(options['--evidence-dir']);
assert.match(relative(resolve(cwd, 'tests/evidence'), evidencePath).replaceAll('\\', '/'), /^integrated-[a-z0-9.-]+(?:\/[a-z0-9.-]+)*$/);
const evidence = pathToFileURL(evidencePath + sep);
const git = (...argv) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...argv], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const productPaths = ['compiler/src', 'compiler/resources/toolchain.lock.json', 'contracts'];
assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit);
git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '');
const paths = git('ls-files', '--', ...productPaths).trim().split(/\r?\n/u).filter(Boolean);
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fingerprint = async () => Promise.all(paths.map(async file => { const bytes = await readFile(new URL(file, target)); return {file, byteLength: bytes.length, sha256: sha(bytes)}; }));
const before = await fingerprint();
await mkdir(evidence); // Preserve all earlier rounds, including failures.
const save = (file, value) => writeFileSync(new URL(file, evidence), typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
save('.gitattributes', '* -text\n'); save('test-source.mjs', await readFile(new URL('tests/completion-availability-independent.mjs', repo), 'utf8'));
save('native-worker-source.mjs', await readFile(new URL('tests/lib/completion-native-worker.mjs', repo), 'utf8'));
save('oracle-source.mjs', await readFile(new URL('tests/lib/completion-oracle.mjs', repo), 'utf8'));
save('target-before.json', {targetPath, expectedCommit, fingerprints: before});
const began = performance.now(), runId = randomUUID(), checks = [], workers = [], results = {}, evaluations = {}, observations = {};
let sequence = 0, completionAdapter, nativeWorker, fatalError = null, targetUnchanged = false;
const event = (kind, detail = {}) => {
  const entry = {sequence: ++sequence, at: new Date().toISOString(), elapsedMs: performance.now() - began, kind, ...detail};
  appendFileSync(new URL('events.jsonl', evidence), JSON.stringify(entry) + '\n'); return entry;
};
const errorJSON = error => ({message: error.message, stack: error.stack});
const bounded = async (promise, label, ms = 45000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: harness deadline ${ms}ms`)), ms); })]); }
  finally { clearTimeout(timer); }
};
function check(name, action) {
  let error = null; try { action(); } catch (caught) { error = errorJSON(caught); }
  const entry = {name, passed: error === null, ...(error ? {error} : {})}; checks.push(entry); event('check', entry); return entry.passed;
}
function trackWorker(url, label, workerOptions = {}) {
  const worker = new Worker(url, {execArgv: [], ...workerOptions});
  const state = {worker, label, terminations: []}; workers.push(state);
  event('worker-created', {label, threadId: worker.threadId});
  worker.on('message', message => event('worker-message-summary', {label, kind: message.kind, id: message.id,
    requestId: message.result?.requestId ?? message.evidence?.requestId, status: message.result?.status ?? message.evidence?.status}));
  worker.on('error', error => event('worker-error', {label, error: errorJSON(error)}));
  worker.once('exit', code => { state.exit = event('worker-exit', {label, code, threadId: worker.threadId}); });
  const original = worker.terminate.bind(worker);
  worker.terminate = (...input) => {
    event('worker-terminate-called', {label, threadId: worker.threadId});
    const promise = Promise.resolve(original(...input)).then(code => { event('worker-terminate-settled', {label, code, threadId: worker.threadId}); return code; });
    state.terminations.push(promise); return promise;
  };
  return worker;
}
async function releaseAll() {
  if (completionAdapter) {
    try { await bounded(completionAdapter.dispose(), 'completion dispose', 5000); }
    catch (error) { check('completion adapter cleanup', () => { throw error; }); }
    completionAdapter = null;
  }
  for (const state of workers) {
    try {
      if (state.worker.threadId !== -1) await bounded(state.worker.terminate(), `${state.label} terminate`, 5000);
      await bounded(Promise.all(state.terminations), `${state.label} native terminate settlement`, 5000);
    } catch (error) { check(`${state.label} cleanup`, () => { throw error; }); }
  }
}

const declarations = [
  'int personAllowed() { return 1; }',
  '__attribute__((unavailable("person05-unavailable"))) int personBlocked() { return 2; }',
  '__attribute__((deprecated("person05-deprecated"))) int personDeprecated() { return 3; }',
  ''
].join('\n');
const marked = declarations + 'void probe() { per/*<cc>*/ }\n';
const text = marked.replace('/*<cc>*/', ''), offset = marked.indexOf('/*<cc>*/');
const fixture = {id: 'attribute-availability-supplement', language: {language: 'cpp', standard: 'c++17'},
  translationUnit: 'main.cpp', sourcePath: 'main.cpp', files: [{path: 'main.cpp', role: 'user', text}],
  coordinates: offsetToClangPosition(text, offset),
  expect: {trigger: 'identifier', prefix: 'per', support: 'boundary', contains: ['personAllowed', 'personDeprecated'],
    excludes: [], inaccessibleOrAbsent: ['personBlocked']}};
const request = requestFromFixture(fixture, `${runId}-availability`, 1);
save('declarations.cpp', declarations); save('completion-marked.cpp', marked); save('completion-source.cpp', text);
save('fixture.json', fixture); save('request.json', request);
try {
  const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', target), 'utf8'));
  const resources = {toolchainId: lock.toolchainId, compilerResourceHash: `sha256:${lock.files.find(file => file.filename === 'clang').sha256}`,
    sysrootResourceHash: `sha256:${lock.files.find(file => file.filename === 'sysroot.tar').sha256}`};
  save('toolchain-lock.json', lock);
  const [{CompletionAdapter}, {CompilerProbe}] = await Promise.all([
    import(new URL('compiler/src/completion-adapter.mjs', target)), import(new URL('compiler/src/compiler-probe.mjs', target))]);
  completionAdapter = new CompletionAdapter({lock, onProgress: progress => event('completion-progress', {progress}),
    createWorker: () => trackWorker(new URL('compiler/src/completion-worker.mjs', target), 'public-completion')});
  results.adapter = await bounded(completionAdapter.complete(request), 'public completion');
  save('adapter-actual.json', results.adapter);
  evaluations.adapter = evaluateCompletion(fixture, request, results.adapter, resources); save('adapter-evaluation.json', evaluations.adapter);
  await bounded(completionAdapter.dispose(), 'release warm public completion'); completionAdapter = null;

  nativeWorker = trackWorker(new URL('./lib/completion-native-worker.mjs', import.meta.url), 'native-completion-evidence', {workerData: {targetRootHref: target.href}});
  results.native = await bounded(new Promise((resolveReply, rejectReply) => {
    nativeWorker.once('error', rejectReply);
    nativeWorker.once('exit', code => rejectReply(new Error(`Native evidence Worker exited before response: ${code}`)));
    nativeWorker.once('message', message => {
      if (message.error) rejectReply(new Error(message.error.message));
      else if (message.id !== request.requestId) rejectReply(new Error('Native evidence request identity mismatch'));
      else resolveReply({...message.actual, resourceReads: message.reads});
    });
    nativeWorker.postMessage({id: request.requestId, request, lock});
  }), 'native completion');
  save('native-actual.json', results.native);
  save('clang-stdout.txt', results.native.native?.stdout ?? ''); save('clang-stderr.txt', results.native.native?.stderr ?? '');
  evaluations.native = evaluateCompletion(fixture, request, results.native.result, resources);
  const position = evaluateNativePosition(fixture, request, results.native.native); save('native-position.json', position);
  if (!position.passed) { evaluations.native.verdict = 'failed'; evaluations.native.errors.push({category: 'coordinate', code: 'native-position', detail: position}); }
  save('native-evaluation.json', evaluations.native);
  await bounded(nativeWorker.terminate(), 'release native completion'); nativeWorker = null;
  check('both real routes returned eligible ordinary and deprecated declarations', () => {
    for (const route of ['adapter', 'native']) {
      const response = route === 'adapter' ? results.adapter : results.native.result;
      assert.equal(response.status, 'succeeded');
      for (const name of ['personAllowed', 'personDeprecated']) assert(response.items.some(item => item.insertText === name && item.label === name));
    }
  });
  check('public and native candidate spellings agree', () => {
    assert.deepEqual([...new Set(results.adapter.items.map(item => item.insertText))].sort(), [...new Set(results.native.result.items.map(item => item.insertText))].sort());
  });
  check('native completion coordinates use independent UTF8 byte position', () => assert(position.passed));
  for (const name of ['personAllowed', 'personBlocked', 'personDeprecated']) {
    const lines = (results.native.native?.stdout ?? '').split(/\r?\n/u).filter(line => line.startsWith(`COMPLETION: ${name} : `) || line.startsWith(`COMPLETION: ${name} (`));
    observations[name] = {rawLines: lines, emittedByClang: lines.length > 0,
      explicitAvailabilityTags: lines.map(line => /^COMPLETION: [^:]*? \(([^)]*)\) : /u.exec(line)?.[1] ?? null),
      nativeConfirmable: results.native.result.items.some(item => item.insertText === name),
      publicConfirmable: results.adapter.items.some(item => item.insertText === name)};
  }
  save('raw-availability-observations.json', observations);
  // Record the limit as a failing boundary whenever an unavailable function is
  // returned. Deprecated remains callable, and absence of warning metadata is
  // reported separately rather than requiring deprecated candidates to vanish.
  for (const route of ['adapter', 'native']) check(`${route}: unavailable function must not be confirmable`, () => {
    const evaluation = evaluations[route]; assert.equal(evaluation.verdict, 'passed', JSON.stringify(evaluation));
  });
  await releaseAll();

  const compileOne = async (label, call) => {
    const source = declarations + `int main() { return ${call}; }\n`;
    const compileFixture = {...fixture, files: [{path: 'main.cpp', role: 'user', text: source}]};
    const snapshot = requestFromFixture(compileFixture, `${runId}-${label}`, 2).snapshot;
    const compileRequest = {requestId: `${runId}-${label}`, snapshot, language: 'cpp', standard: 'c++17', mode: 'debug', optimization: 'O0'};
    save(`${label}-source.cpp`, source); save(`${label}-request.json`, compileRequest);
    const firstWorker = workers.length;
    const probe = new CompilerProbe({onProgress: progress => event('compile-progress', {label, progress}),
      createWorker: () => trackWorker(new URL('compiler/src/compiler-worker.mjs', target), label)});
    let actual;
    try {
      actual = await bounded(probe.compile(compileRequest, {smokeStdin: ''}), label);
      const {executable, object, ...metadata} = actual;
      const binaries = {};
      for (const [key, value] of Object.entries({executable, object})) if (value) {
        const file = `${label}-${key}.${key === 'executable' ? 'wasm' : 'o'}`; save(file, value); binaries[key] = {file, byteLength: value.length, sha256: sha(value)};
      }
      save(`${label}-actual.json`, {...metadata, binaryEvidence: binaries});
      save(`${label}-raw-diagnostics.txt`, actual.rawDiagnostics ?? '');
      check(`${label}: request/source identities match actual public result`, () => {
        assert.equal(actual.requestId, compileRequest.requestId); assert.equal(actual.sourceHash, snapshot.sourceHash);
      });
      return actual;
    } finally {
      for (const state of workers.slice(firstWorker)) {
        if (state.worker.threadId !== -1) await bounded(state.worker.terminate(), `${label} release`, 5000);
        await bounded(Promise.all(state.terminations), `${label} actual termination`, 5000);
      }
    }
  };
  results.blockedCall = await compileOne('blocked-call', 'personBlocked() - 2');
  check('calling unavailable function really fails with its declared diagnostic', () => {
    assert.equal(results.blockedCall.status, 'failed'); assert.equal(results.blockedCall.reason, 'compiler-exit');
    assert.match(results.blockedCall.rawDiagnostics, /person05-unavailable/u);
    assert(results.blockedCall.diagnostics.some(item => ['error', 'fatal'].includes(item.severity) && /unavailable/iu.test(item.message)));
    assert(!('executable' in results.blockedCall));
  });
  results.deprecatedCall = await compileOne('deprecated-call', 'personDeprecated() - 3');
  check('deprecated function remains callable, compiles and actually exits zero', () => {
    assert.equal(results.deprecatedCall.status, 'compiled'); assert.equal(results.deprecatedCall.smoke?.exitCode, 0);
    assert.match(results.deprecatedCall.rawDiagnostics, /person05-deprecated/u);
    assert(results.deprecatedCall.diagnostics.some(item => item.severity === 'warning' && /deprecated/iu.test(item.message)));
    assert(results.deprecatedCall.executable?.length > 0);
  });
} catch (error) {
  fatalError = errorJSON(error); event('fatal-error', {error: fatalError}); save('fatal-error.json', fatalError);
} finally {
  await releaseAll();
  check('all real Workers were released before the final record', () => assert(workers.length > 0 && workers.every(state => state.exit && state.worker.threadId === -1)));
  try {
    const after = await fingerprint(); targetUnchanged = JSON.stringify(before) === JSON.stringify(after) && git('rev-parse', 'HEAD').trim() === expectedCommit;
    git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
    assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '');
    save('target-after.json', {expectedCommit, fingerprints: after}); check('fixed target and runtime bytes unchanged', () => assert(targetUnchanged));
  } catch (error) { check('target verification completed', () => { throw error; }); }
  const boundaryFailed = Object.values(evaluations).some(value => value.verdict === 'boundary-failed');
  const summary = {kind: 'supplemental-availability-boundary', requestId: 'CC-20261029-05', expectedCommit,
    originalFixtureCountUnchanged: 33, supplementalLogicalCases: 1,
    completionRoutes: {adapter: evaluations.adapter ?? null, native: evaluations.native ?? null},
    boundaryFailed, observations, controls: {unavailableCallStatus: results.blockedCall?.status ?? null,
      deprecatedCallStatus: results.deprecatedCall?.status ?? null, deprecatedSmokeExitCode: results.deprecatedCall?.smoke?.exitCode ?? null},
    checkPass: checks.filter(item => item.passed).length, checkFail: checks.filter(item => !item.passed).length,
    targetUnchanged, fatalError, workers: workers.map(state => ({label: state.label, exit: state.exit ?? null, threadIdAfter: state.worker.threadId})),
    scope: 'Supplemental case outside the original 33. Frozen CompletionItem has no availability/deprecation metadata. Deprecated is callable; confirmable unavailable candidates remain a failed boundary. CompilerProbe failed status has no invented native exitCode. No browser or iPad acceptance.',
    passed: !fatalError && !boundaryFailed && checks.length > 0 && checks.every(item => item.passed) && targetUnchanged};
  save('checks.json', checks); save('summary.json', summary);
  console.log(JSON.stringify({evidence: evidencePath, passed: summary.passed, boundaryFailed, completionRoutes: summary.completionRoutes,
    controls: summary.controls, checks: {pass: summary.checkPass, fail: summary.checkFail}, targetUnchanged}, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
