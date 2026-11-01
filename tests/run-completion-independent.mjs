// Requires an explicitly fixed product checkout; never imports an implementation on --list.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadCompletionFixtures, completionFixtureInventory} from './lib/completion-fixtures.mjs';
import {requestFromFixture, evaluateCompletion, evaluateNativePosition} from './lib/completion-oracle.mjs';

const repo = new URL('../', import.meta.url), fixtures = await loadCompletionFixtures();
const argv = process.argv.slice(2), options = {};
while (argv.length) {
  const key = argv.shift(); assert(['--list', '--target-root', '--target-commit', '--evidence-name', '--mode'].includes(key), `Unknown argument ${key}`);
  assert(!(key in options), `Duplicate argument ${key}`);
  options[key] = key === '--list' ? true : argv.shift();
  assert(options[key] !== undefined, `${key} needs a value`);
}
if (options['--list']) {
  console.log(JSON.stringify({kind: 'preparation-only', actualProviderCalls: 0, ...completionFixtureInventory(fixtures)}, null, 2));
} else {
  const expectedCommit = options['--target-commit']; assert.match(expectedCommit ?? '', /^[0-9a-f]{40}$/);
  assert(options['--target-root'], '--target-root must identify the fixed checkout');
  const targetPath = resolve(options['--target-root']), target = pathToFileURL(targetPath + sep);
  const mode = options['--mode'] ?? 'both'; assert(['adapter', 'native', 'both'].includes(mode));
  const name = options['--evidence-name']; assert.match(name ?? '', /^integrated-person05-completion-runtime-[a-z0-9.-]+$/);
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const productPaths = ['app', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json'];
  assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit, 'Target HEAD drifted');
  git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
  assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '', 'Untracked runtime inputs');
  const sourcePaths = git('ls-files', '--', ...productPaths).trim().split(/\r?\n/).filter(Boolean);
  for (const file of ['completion-adapter', 'completion-worker', 'completion-engine', 'completion-source', 'completion-output'])
    assert(sourcePaths.includes(`compiler/src/${file}.mjs`), `Fixed target lacks ${file}.mjs`);
  assert.deepEqual(await readFile(new URL('contracts/completion.d.ts', target)), await readFile(new URL('contracts/completion.d.ts', repo)), 'Completion API differs from the frozen acceptance API');
  const fingerprint = async (base, paths) => Promise.all(paths.map(async path => {
    const bytes = await readFile(new URL(path, base));
    return {file: path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  }));
  const before = await fingerprint(target, sourcePaths);
  const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', target), 'utf8'));
  const resources = {toolchainId: lock.toolchainId, compilerResourceHash: `sha256:${lock.files.find(file => file.filename === 'clang').sha256}`,
    sysrootResourceHash: `sha256:${lock.files.find(file => file.filename === 'sysroot.tar').sha256}`};
  const evidence = new URL(`tests/evidence/${name}/`, repo); await mkdir(evidence); // no overwrite
  const save = async (file, value) => {
    const destination = new URL(file, evidence); await mkdir(new URL('./', destination), {recursive: true});
    await writeFile(destination, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  };
  await save('.gitattributes', '* -text\n');
  const runId = randomUUID(), records = [], progress = [], workers = [], cleanupErrors = [];
  const requests = fixtures.filter(f => f.expect.trigger !== 'none').map((fixture, index) => ({fixture, request: requestFromFixture(fixture, `person05-${runId}-${fixture.id}`, index + 1)}));
  await save('fixture-inventory.json', completionFixtureInventory(fixtures));
  await save('target-before.json', {expectedCommit, targetPath, mode, resources, sourceFingerprints: before});
  const inputs = ['tests/run-completion-independent.mjs', 'tests/lib/completion-native-worker.mjs', 'tests/lib/completion-oracle.mjs',
    'tests/lib/completion-fixtures.mjs', 'fixtures/completion-independent/cases.json'];
  for (const file of inputs) await save(`inputs/${file}`, await readFile(new URL(file, repo), 'utf8'));
  async function observe(path, fixture, request, action) {
    const startedAt = new Date().toISOString(), started = performance.now();
    await save(`${path}/${fixture.id}/request.json`, request);
    try {
      const actual = await action(); const result = path === 'native' ? actual.result : actual;
      // Preserve the unmodified reply before any oracle assertion can fail.
      await save(`${path}/${fixture.id}/actual.json`, actual);
      if (actual.native) {
        await save(`${path}/${fixture.id}/clang-stdout.txt`, actual.native.stdout ?? '');
        await save(`${path}/${fixture.id}/clang-stderr.txt`, actual.native.stderr ?? '');
      }
      const evaluation = evaluateCompletion(fixture, request, result, resources);
      const position = path === 'native' ? evaluateNativePosition(fixture, request, actual.native) : null;
      if (position && !position.passed) { evaluation.verdict = 'failed'; evaluation.errors.push({category: 'coordinate', code: 'native-position', detail: position}); }
      const record = {caseId: fixture.id, path, startedAt, elapsedMs: performance.now() - started, ...evaluation}; records.push(record);
      await save(`${path}/${fixture.id}/evaluation.json`, {...record, position});
    } catch (error) {
      const record = {caseId: fixture.id, path, verdict: 'infrastructure-failed', startedAt, elapsedMs: performance.now() - started,
        error: {message: error.message, stack: error.stack}}; records.push(record); await save(`${path}/${fixture.id}/error.json`, record);
    }
  }
  if (mode !== 'native') {
    const {CompletionAdapter} = await import(new URL('compiler/src/completion-adapter.mjs', target));
    let currentCase;
    const adapter = new CompletionAdapter({lock, onProgress: event => progress.push({caseId: currentCase, event}), createWorker: () => {
      const worker = new Worker(new URL('compiler/src/completion-worker.mjs', target), {execArgv: []}); workers.push(worker); return worker;
    }});
    try { for (const {fixture, request} of requests) { currentCase = fixture.id; await observe('adapter', fixture, request, () => adapter.complete(request)); } }
    finally {
      try { await adapter.dispose(); } catch (error) { cleanupErrors.push({phase: 'adapter-dispose', message: error.message, stack: error.stack}); }
      const terminated = await Promise.allSettled(workers.map(async worker => worker.terminate()));
      for (const result of terminated) if (result.status === 'rejected') cleanupErrors.push({phase: 'adapter-worker-terminate', message: String(result.reason)});
    }
  }
  if (mode !== 'adapter') {
    const worker = new Worker(new URL('./lib/completion-native-worker.mjs', import.meta.url), {workerData: {targetRootHref: target.href}, execArgv: []});
    const pending = new Map(); let dead;
    const fail = error => { dead = error; for (const task of pending.values()) task.reject(error); pending.clear(); };
    worker.on('error', fail); worker.on('exit', code => fail(new Error(`Native evidence worker exited ${code}`)));
    worker.on('message', message => { const task = pending.get(message.id); if (!task) return; pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve({...message.actual, resourceReads: message.reads}); });
    const native = request => new Promise((resolveReply, rejectReply) => {
      if (dead) { rejectReply(dead); return; }
      const timer = setTimeout(() => { fail(new Error('Native evidence worker timed out after 45000ms')); void worker.terminate(); }, 45000);
      pending.set(request.requestId, {resolve: result => {clearTimeout(timer); resolveReply(result);}, reject: error => {clearTimeout(timer); rejectReply(error);}});
      try { worker.postMessage({id: request.requestId, request, lock}); }
      catch (error) { pending.get(request.requestId).reject(error); pending.delete(request.requestId); }
    });
    try { for (const {fixture, request} of requests) await observe('native', fixture, request, () => native(request)); }
    finally { try { await worker.terminate(); } catch (error) { cleanupErrors.push({phase: 'native-worker-terminate', message: error.message, stack: error.stack}); } }
  }
  const after = await fingerprint(target, sourcePaths);
  const targetUnchanged = JSON.stringify(before) === JSON.stringify(after) && git('rev-parse', 'HEAD').trim() === expectedCommit;
  git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
  const grouped = fixtures.map(fixture => {
    const actual = records.filter(record => record.caseId === fixture.id);
    return {caseId: fixture.id, support: fixture.expect.support, verdict: fixture.expect.trigger === 'none' ? 'ui-pending' :
      actual.some(record => record.verdict === 'infrastructure-failed') ? 'infrastructure-failed' : actual.some(record => record.verdict === 'failed') ? 'failed' :
      actual.some(record => record.verdict === 'boundary-failed') ? 'boundary-failed' : actual.length ? 'passed' : 'pending', observations: actual};
  });
  const summary = {requestId: 'CC-20261029-05', expectedCommit, targetPath, mode, targetUnchanged,
    attemptedProviderCalls: records.length, completedProviderResponses: records.filter(record => record.verdict !== 'infrastructure-failed').length, cleanupErrors,
    featureAcceptance: 'partial-provider-evidence-only; UI/offline-package/iPad remain pending',
    counts: Object.fromEntries(['passed', 'failed', 'boundary-failed', 'infrastructure-failed', 'ui-pending', 'pending'].map(verdict => [verdict, grouped.filter(item => item.verdict === verdict).length])), cases: grouped};
  await save('progress.json', progress); await save('target-after.json', {expectedCommit, sourceFingerprints: after}); await save('summary.json', summary);
  console.log(JSON.stringify({name, expectedCommit, mode, targetUnchanged, attemptedProviderCalls: records.length,
    completedProviderResponses: summary.completedProviderResponses, cleanupErrors, counts: summary.counts}, null, 2));
  if (!targetUnchanged || cleanupErrors.length || grouped.some(item => ['failed', 'boundary-failed', 'infrastructure-failed', 'pending'].includes(item.verdict))) process.exitCode = 1;
}
