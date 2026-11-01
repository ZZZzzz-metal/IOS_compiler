// Independent real-Worker lifecycle observations. No synthetic Worker or provider.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {appendFileSync, writeFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {loadCompletionFixtures} from './lib/completion-fixtures.mjs';
import {requestFromFixture, evaluateCompletion} from './lib/completion-oracle.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo), args = process.argv.slice(2), options = {};
while (args.length) {
  const key = args.shift(); assert(['--target-root', '--target-commit', '--evidence-dir'].includes(key) && !(key in options), `Invalid argument ${key}`);
  options[key] = args.shift(); assert(options[key] && !options[key].startsWith('--'), `${key} needs a value`);
}
assert.match(options['--target-commit'] ?? '', /^[0-9a-f]{40}$/);
assert(options['--target-root'] && options['--evidence-dir']);
const targetPath = resolve(options['--target-root']), target = pathToFileURL(targetPath + sep), expectedCommit = options['--target-commit'];
const evidencePath = resolve(options['--evidence-dir']);
const withinEvidence = relative(resolve(cwd, 'tests/evidence'), evidencePath).replaceAll('\\', '/');
assert.match(withinEvidence, /^integrated-[a-z0-9.-]+(?:\/[a-z0-9.-]+)*$/, 'Evidence must be within this repository tests/evidence/integrated-*');
const evidence = pathToFileURL(evidencePath + sep);
const git = (...argv) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...argv], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const productPaths = ['compiler/src', 'compiler/resources/toolchain.lock.json', 'contracts'];
assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit, 'Fixed target HEAD');
git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '', 'Untracked runtime inputs');
const runtimePaths = git('ls-files', '--', ...productPaths).trim().split(/\r?\n/u).filter(Boolean);
const fingerprint = async () => Promise.all(runtimePaths.map(async file => {
  const bytes = await readFile(new URL(file, target));
  return {file, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
}));
const before = await fingerprint();
await mkdir(evidence); // No overwrite, including failed earlier attempts.
await writeFile(new URL('.gitattributes', evidence), '* -text\n', {flag: 'wx'});
const save = (file, value) => writeFileSync(new URL(file, evidence), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
save('test-source.mjs', await readFile(new URL('tests/completion-lifecycle-independent.mjs', repo), 'utf8'));
save('oracle-source.mjs', await readFile(new URL('tests/lib/completion-oracle.mjs', repo), 'utf8'));
save('fixture-loader-source.mjs', await readFile(new URL('tests/lib/completion-fixtures.mjs', repo), 'utf8'));
save('target-before.json', {targetPath, expectedCommit, sourceFingerprints: before});

const started = performance.now(), runId = randomUUID(), timeline = [], checks = [], scenarios = [], contexts = [], allWorkers = [];
let sequence = 0, requestNumber = 0, scenarioName = 'setup', fatalError = null, after = null, targetUnchanged = false;
const event = (kind, detail = {}) => {
  const entry = {sequence: ++sequence, elapsedMs: performance.now() - started, at: new Date().toISOString(), scenario: scenarioName, kind, ...detail};
  timeline.push(entry); appendFileSync(new URL('events.jsonl', evidence), JSON.stringify(entry) + '\n'); return entry;
};
const describeError = error => ({name: error.name, message: error.message, stack: error.stack});
const bounded = async (promise, label, timeoutMs = 30000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: harness deadline ${timeoutMs}ms`)), timeoutMs); })]); }
  finally { clearTimeout(timer); }
};
function check(name, action) {
  let error = null;
  try { action(); } catch (caught) { error = describeError(caught); }
  const entry = {scenario: scenarioName, name, passed: error === null, ...(error ? {error} : {})};
  checks.push(entry); event('check', entry); return entry.passed;
}
async function scenario(name, action) {
  scenarioName = name; const first = checks.length; event('scenario-start');
  try { await bounded(action(), name, 45000); }
  catch (error) { check('scenario completed without infrastructure error', () => { throw error; }); }
  const entry = {name, passed: checks.length > first && checks.slice(first).every(item => item.passed), checks: checks.slice(first)};
  scenarios.push(entry); save(`${name}.json`, entry); event('scenario-end', {passed: entry.passed});
}
const identities = request => ({requestId: request.requestId, documentVersion: request.documentVersion,
  snapshotId: request.snapshot.snapshotId, sourceHash: request.snapshot.sourceHash, sourcePath: request.sourcePath, offset: request.offset});
function assertTerminal(task, status) {
  assert.equal(task.result?.status, status);
  for (const [key, value] of Object.entries(identities(task.request))) assert.equal(task.result[key], value, key);
  if (status !== 'succeeded') assert.deepEqual(task.result.items, []);
}
function assertReleased(state, beforeSequence) {
  assert(state, 'Expected a real Worker'); assert(state.exit, 'Worker exit event observed');
  assert(state.terminateSettled, 'Native terminate Promise observed');
  assert.equal(state.worker.threadId, -1); assert(state.exit.sequence < beforeSequence);
  assert(state.terminateSettled.sequence < beforeSequence);
}

try {
  const fixtures = await loadCompletionFixtures(), typeA = fixtures.find(item => item.id === 'type-a'), vector = fixtures.find(item => item.id === 'vector');
  assert(typeA && vector);
  const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', target), 'utf8'));
  const resources = {toolchainId: lock.toolchainId, compilerResourceHash: `sha256:${lock.files.find(file => file.filename === 'clang').sha256}`,
    sysrootResourceHash: `sha256:${lock.files.find(file => file.filename === 'sysroot.tar').sha256}`};
  save('toolchain-lock.json', lock);
  const {CompletionAdapter} = await import(new URL('compiler/src/completion-adapter.mjs', target));
  function context(label, timeoutMs = 15000) {
    const ctx = {label, workers: [], hook: null, terminationOrigin: 'adapter', currentRequestId: null}; contexts.push(ctx);
    ctx.adapter = new CompletionAdapter({lock, timeoutMs, onProgress: progress => {
      event('public-progress', {adapter: label, requestId: ctx.currentRequestId, progress});
      if (ctx.hook) { try { ctx.hook(progress); } catch (error) { event('harness-hook-error', {error: describeError(error)}); throw error; } }
    }, createWorker: () => {
      const worker = new Worker(new URL('compiler/src/completion-worker.mjs', target), {execArgv: []});
      const state = {worker, id: `${label}-worker-${ctx.workers.length + 1}`, terminateCalls: [], origin: 'adapter'};
      state.created = event('worker-created', {adapter: label, worker: state.id, threadId: worker.threadId});
      ctx.workers.push(state); allWorkers.push(state);
      worker.on('message', message => event('worker-message', {adapter: label, worker: state.id, message}));
      worker.on('error', error => event('worker-error', {adapter: label, worker: state.id, error: describeError(error)}));
      worker.once('exit', code => { state.exit = event('worker-exit', {adapter: label, worker: state.id, code, threadId: worker.threadId}); });
      const originalPost = worker.postMessage.bind(worker), originalTerminate = worker.terminate.bind(worker);
      worker.postMessage = (...input) => { event('worker-post-message', {adapter: label, worker: state.id, message: input[0]}); return originalPost(...input); };
      worker.terminate = (...input) => {
        const call = event('worker-terminate-called', {adapter: label, worker: state.id, origin: ctx.terminationOrigin, threadId: worker.threadId}); state.terminateCalls.push(call);
        try {
          return Promise.resolve(originalTerminate(...input)).then(code => {
            const settled = event('worker-terminate-settled', {adapter: label, worker: state.id, origin: call.origin, code, threadId: worker.threadId});
            state.terminateSettled ??= settled; return code;
          }, error => { event('worker-terminate-rejected', {adapter: label, worker: state.id, error: describeError(error)}); throw error; });
        } catch (error) { event('worker-terminate-threw', {adapter: label, worker: state.id, error: describeError(error)}); throw error; }
      };
      return worker;
    }});
    return ctx;
  }
  function complete(ctx, fixture, label) {
    const request = requestFromFixture(fixture, `${runId}-${++requestNumber}-${label}`, requestNumber);
    const task = {ctx, fixture, request, label}; ctx.currentRequestId = request.requestId;
    task.called = event('complete-called', {adapter: ctx.label, label, request}); save(`${label}-request.json`, request);
    task.promise = ctx.adapter.complete(request).then(result => {
      task.result = result; task.settled = event('complete-settled', {adapter: ctx.label, label, result});
      save(`${label}-response.json`, result); return result;
    }, error => { task.error = error; task.settled = event('complete-rejected', {adapter: ctx.label, label, error: describeError(error)}); throw error; });
    return task;
  }
  function cancel(ctx, requestId, label) {
    const call = {called: event('cancel-called', {adapter: ctx.label, requestId, label})};
    call.promise = ctx.adapter.cancel(requestId).then(() => { call.settled = event('cancel-settled', {adapter: ctx.label, requestId, label}); },
      error => { call.settled = event('cancel-rejected', {adapter: ctx.label, requestId, label, error: describeError(error)}); throw error; });
    return call;
  }
  function positive(task) {
    const evaluation = evaluateCompletion(task.fixture, task.request, task.result, resources);
    event('semantic-evaluation', {label: task.label, evaluation}); assert.equal(evaluation.verdict, 'passed', JSON.stringify(evaluation));
  }

  const primary = context('primary'); let cancelled, restart, recent, replacement, cancellationPair = [], callbackSeen = false;
  await scenario('01-active-double-cancel', async () => {
    primary.hook = progress => {
      if (progress.phase !== 'completion-started' || callbackSeen) return;
      callbackSeen = true; primary.hook = null;
      // Calls must start synchronously here; awaiting first would allow a result race.
      cancellationPair = [cancel(primary, cancelled.request.requestId, 'active-first'), cancel(primary, cancelled.request.requestId, 'active-second')];
    };
    cancelled = complete(primary, vector, 'active-cancelled');
    await bounded(cancelled.promise, 'active completion');
    await bounded(Promise.all(cancellationPair.map(call => call.promise)), 'double cancel');
    check('completion-started callback synchronously initiated both cancels', () => { assert(callbackSeen); assert.equal(cancellationPair.length, 2); });
    check('cancelled response preserves all identities and has no items', () => assertTerminal(cancelled, 'cancelled'));
    check('real Worker exited and terminate settled before complete', () => assertReleased(primary.workers[0], cancelled.settled.sequence));
    check('both cancel Promises settle after actual release and complete', () => {
      for (const call of cancellationPair) { assertReleased(primary.workers[0], call.settled.sequence); assert(cancelled.settled.sequence < call.settled.sequence); }
    });
    check('double cancel made exactly one native terminate call', () => assert.equal(primary.workers[0].terminateCalls.length, 1));
  });
  await scenario('02-same-adapter-restart', async () => {
    primary.hook = null; restart = complete(primary, typeA, 'restart-success'); await bounded(restart.promise, 'restart');
    check('same public adapter succeeds on a new valid request', () => positive(restart));
    check('replacement Worker starts only after old Worker released', () => {
      assert.equal(primary.workers.length, 2); assertReleased(primary.workers[0], primary.workers[1].created.sequence);
    });
    check('successful Worker remains warm before explicit cancellation', () => { assert(primary.workers[1].worker.threadId > 0); assert.equal(primary.workers[1].terminateCalls.length, 0); });
  });
  await scenario('03-cancel-recent-completed', async () => {
    recent = cancel(primary, restart.request.requestId, 'recent-completed'); await bounded(recent.promise, 'recent cancel');
    check('cancel of most recent completed ID releases idle warm Worker', () => assertReleased(primary.workers[1], recent.settled.sequence));
    check('warm release is after successful complete, with no new Worker', () => { assert(restart.settled.sequence < recent.called.sequence); assert.equal(primary.workers.length, 2); });
  });
  await scenario('04-old-id-does-not-kill-new-active', async () => {
    let seen = false, oldCancel;
    primary.hook = progress => {
      if (progress.phase !== 'completion-started' || seen) return;
      seen = true; primary.hook = null; oldCancel = cancel(primary, restart.request.requestId, 'old-id-during-new-active');
    };
    replacement = complete(primary, typeA, 'old-id-new-success'); await bounded(replacement.promise, 'new active');
    if (oldCancel) await bounded(oldCancel.promise, 'old ID cancel');
    check('old ID cancellation was initiated while new request had started', () => { assert(seen && oldCancel); assert(oldCancel.called.sequence < replacement.settled.sequence); });
    check('new active completion still succeeds', () => positive(replacement));
    check('old ID did not terminate or replace the new warm Worker', () => {
      assert.equal(primary.workers.length, 3); assert.equal(primary.workers[2].terminateCalls.length, 0); assert(primary.workers[2].worker.threadId > 0);
    });
  });
  await scenario('05-dispose-idle-and-reject-new', async () => {
    primary.hook = null; const called = event('dispose-called', {adapter: primary.label});
    await bounded(primary.adapter.dispose(), 'idle dispose'); const settled = event('dispose-settled', {adapter: primary.label});
    check('idle dispose releases actual last Worker before returning', () => assertReleased(primary.workers[2], settled.sequence));
    const createdCount = primary.workers.length, rejected = complete(primary, typeA, 'after-dispose-failed'); await bounded(rejected.promise, 'after dispose');
    check('new valid request after dispose fails with identity and no items', () => {
      assertTerminal(rejected, 'failed'); assert(rejected.result.diagnostics.some(item => /disposed/iu.test(item.message)));
    });
    check('disposed adapter creates no new Worker', () => assert.equal(primary.workers.length, createdCount));
    const terminations = primary.workers.reduce((sum, worker) => sum + worker.terminateCalls.length, 0);
    await bounded(primary.adapter.dispose(), 'second dispose');
    check('repeated idle dispose has no additional terminate side effect', () => {
      assert.equal(primary.workers.reduce((sum, worker) => sum + worker.terminateCalls.length, 0), terminations); assert(called.sequence < settled.sequence);
    });
  });
  await scenario('06-active-supersede', async () => {
    const ctx = context('supersede'); let oldTask, newTask, seen = false;
    ctx.hook = progress => {
      if (progress.phase !== 'completion-started' || seen) return;
      seen = true; ctx.hook = null; newTask = complete(ctx, typeA, 'supersede-new-success');
    };
    oldTask = complete(ctx, vector, 'supersede-old-cancelled'); await bounded(oldTask.promise, 'superseded old');
    check('replacement started synchronously from real old request progress', () => assert(seen && newTask));
    check('old request returns cancelled with no stale candidates', () => { assertTerminal(oldTask, 'cancelled'); assert.equal(oldTask.result.reason, 'superseded'); });
    if (newTask) await bounded(newTask.promise, 'superseding new');
    check('new request succeeds on same public adapter', () => { assert(newTask); positive(newTask); });
    check('old Worker release and old complete precede new Worker creation', () => {
      assert.equal(ctx.workers.length, 2); assertReleased(ctx.workers[0], ctx.workers[1].created.sequence); assert(oldTask.settled.sequence < ctx.workers[1].created.sequence);
    });
  });
  await scenario('07-short-timeout-real-worker-release', async () => {
    const ctx = context('timeout', 1), task = complete(ctx, typeA, 'short-timeout-failed'); await bounded(task.promise, 'short timeout');
    check('short timeout returns failed identity and no items', () => { assertTerminal(task, 'failed'); assert.equal(task.result.reason, 'completion-timeout'); });
    check('real Worker was created then released before timeout result', () => { assert.equal(ctx.workers.length, 1); assertReleased(ctx.workers[0], task.settled.sequence); });
    event('timeout-scope', {note: 'Only real Worker creation/termination is claimed. A 1ms timeout does not prove entry into Clang or interruption of a particular Wasm instruction.'});
  });
} catch (error) {
  fatalError = describeError(error); event('fatal-error', {error: fatalError});
} finally {
  scenarioName = 'harness-cleanup';
  for (const ctx of contexts) {
    ctx.hook = null; ctx.terminationOrigin = 'harness-cleanup-adapter';
    try { await bounded(ctx.adapter.dispose(), `${ctx.label} cleanup dispose`, 5000); }
    catch (error) { check(`${ctx.label} cleanup dispose completed`, () => { throw error; }); }
    for (const state of ctx.workers) {
      if (state.worker.threadId === -1) continue;
      ctx.terminationOrigin = 'harness-forced';
      try { await bounded(state.worker.terminate(), `${state.id} forced cleanup`, 5000); }
      catch (error) { check(`${state.id} forced cleanup completed`, () => { throw error; }); }
    }
  }
  check('all created real Workers have emitted exit and have threadId -1', () => {
    assert(allWorkers.length > 0); assert(allWorkers.every(state => state.exit && state.worker.threadId === -1));
  });
  try {
    after = await fingerprint();
    targetUnchanged = JSON.stringify(before) === JSON.stringify(after) && git('rev-parse', 'HEAD').trim() === expectedCommit;
    git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
    assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '');
    check('fixed product inputs and HEAD remain unchanged', () => assert(targetUnchanged));
  } catch (error) { check('fixed target final verification completed', () => { throw error; }); }
  const workerSummary = allWorkers.map(state => ({id: state.id, created: state.created, exit: state.exit ?? null,
    threadIdAfter: state.worker.threadId, terminateCalls: state.terminateCalls, terminateSettled: state.terminateSettled ?? null}));
  const summary = {kind: 'independent-real-node-worker-lifecycle', requestId: 'CC-20261029-05', expectedCommit, targetPath,
    fixtureScope: 'type-a and vector only; no const-boundary acceptance', actualCompleteCalls: requestNumber,
    scenarioCount: scenarios.length, scenarioPass: scenarios.filter(item => item.passed).length,
    checkPass: checks.filter(item => item.passed).length, checkFail: checks.filter(item => !item.passed).length,
    targetUnchanged, fatalError, workers: workerSummary, scenarios, checks,
    scope: 'Public CompletionAdapter and real Node Workers. Cancellation is initiated at observed completion-started, not proof of a specific Wasm instruction being interrupted. No browser/UI/physical iPad or full compilation was exercised.',
    passed: !fatalError && scenarios.length === 7 && scenarios.every(item => item.passed) && checks.every(item => item.passed) && targetUnchanged};
  save('target-after.json', {expectedCommit, sourceFingerprints: after}); save('checks.json', checks); save('summary.json', summary);
  console.log(JSON.stringify({evidence: evidencePath, passed: summary.passed, scenarios: `${summary.scenarioPass}/${summary.scenarioCount}`,
    checks: {pass: summary.checkPass, fail: summary.checkFail}, actualCompleteCalls: requestNumber, workers: workerSummary.length, targetUnchanged}, null, 2));
  if (!summary.passed) process.exitCode = 1;
}
