// Read-only semantic evidence audit; does not repeat provider/compile executions.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {evaluateCallabilityControl, callabilitySemanticExpectation} from './lib/completion-fix-callability-oracle.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo), name = process.argv[2];
assert.match(name ?? '', /^integrated-person05-completion-fix-[a-z0-9.-]+$/);
const evidence = new URL(`tests/evidence/${name}/`, repo);
const read = path => readFile(new URL(path, evidence));
const json = async path => JSON.parse(await read(path));
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const stage = await json('summary.json'), queries = await json('queries/summary.json'), calls = await json('callability/summary.json');
assert(stage.passed && queries.passed && calls.passed);
assert.equal(queries.providerResponses, 88); assert.equal(queries.logicalCases, 44);
const inventory = await json('callability/controls-inventory.json'), auditedCalls = [];
for (const fixture of inventory.fixtures) for (const control of fixture.controls) {
  const folder = `callability/controls/${fixture.id}/${control.id}/`;
  const request = await json(`${folder}request.json`), actual = await json(`${folder}actual.json`);
  const sourceFiles = request.snapshot.files.map(({path, role, text}) => ({path, role, text})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const expectedFiles = control.files.map(({path, role, text}) => ({path, role, text})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert.deepEqual(sourceFiles, expectedFiles, 'Exact complete source control, no oracle source substitution');
  assert.equal(request.snapshot.sourceHash, hash(Buffer.from(JSON.stringify({version: 1, translationUnit: control.translationUnit, files: sourceFiles}))));
  for (const file of request.snapshot.files) assert.equal(file.contentHash, hash(Buffer.from(file.text)));
  for (const [key, binary] of Object.entries(actual.binaryEvidence ?? {})) {
    const bytes = await read(`callability/${binary.file}`);
    assert.equal(bytes.length, binary.byteLength); assert.equal(hash(bytes), binary.sha256);
    actual[key] = bytes;
  }
  const semantic = callabilitySemanticExpectation(fixture, control, calls.nonce);
  const evaluation = evaluateCallabilityControl(control, request, actual, calls.fullCompilerResources, semantic);
  assert.equal(evaluation.passed, true, `${fixture.id}/${control.id}: ${JSON.stringify(evaluation.errors)}`);
  auditedCalls.push({id: `${fixture.id}/${control.id}`, status: actual.status, sourceHash: request.snapshot.sourceHash,
    semantic, expectedWarning: control.expect.warningPattern ?? null,
    diagnosticGroupCount: evaluation.diagnosticGroups.length});
}
assert.equal(auditedCalls.length, 27);
const events = (await read('callability/events.jsonl')).toString('utf8').trim().split('\n').map(line => JSON.parse(line));
const eventCounts = Object.fromEntries(['compile-started', 'compile-evaluated', 'worker-created', 'worker-exit'].map(kind => [kind, events.filter(row => row.kind === kind).length]));
for (const count of Object.values(eventCounts)) assert.equal(count, 27);
const workers = await json('callability/workers.json');
assert.equal(workers.length, 27); assert(workers.every(row => row.threadIdAfter === -1 && row.exit));

const originals = [];
const previous = new URL('tests/evidence/integrated-person05-completion-runtime-bddae576-2026-10-30/', repo);
for (const [id, oldPath] of [['const-string', 'adapter/const-string/request.json'],
  ['attribute-availability-supplement', 'availability-run-01/request.json']]) {
  const oldRequest = JSON.parse(await readFile(new URL(oldPath, previous)));
  const current = await json(`queries/adapter/${id}/request.json`);
  assert.equal(current.snapshot.sourceHash, oldRequest.snapshot.sourceHash);
  assert.deepEqual(current.snapshot.files, oldRequest.snapshot.files);
  const adapter = await json(`queries/adapter/${id}/evaluation.json`), native = await json(`queries/native/${id}/evaluation.json`);
  assert.equal(adapter.verdict, 'passed'); assert.equal(native.verdict, 'passed');
  const raw = await json(`queries/native/${id}/actual.json`);
  originals.push({id, sourceHash: current.snapshot.sourceHash, originalSourceUnchanged: true,
    adapterVerdict: adapter.verdict, nativeVerdict: native.verdict, nativeExitCode: raw.native.exitCode,
    rawAvailabilityLines: raw.native.stdout.split(/\r?\n/u).filter(line => /COMPLETION: (?:append|personBlocked|personDeprecated|personAllowed)\b/u.test(line)),
    finalRelevantNames: raw.result.items.filter(item => ['append', 'size', 'c_str', 'personBlocked', 'personDeprecated', 'personAllowed'].includes(item.insertText)).map(item => item.insertText)});
}
const main = await json('regression/independent.json'), initializer = await json('regression/initializer-lifetime.json');
assert.deepEqual(main.counts, {passed: 21, failed: 0}); assert.deepEqual(initializer.counts, {passed: 6, failed: 0});
const shadowValues = main.observations.queries.filter(row => row.reply?.result?.name === 'shadow').map(row => row.reply.result);
assert.deepEqual(shadowValues.map(row => row.displayValue), ['17', '5']);
assert(shadowValues.every(row => row.availability === 'available'));
assert.equal((await json('regression/regression-shadow.json')).status, 'passed');
assert.equal((await json('regression/regression-loop-header.json')).status, 'passed');
const lifecycle = await json('lifecycle/summary.json');
assert(lifecycle.passed && lifecycle.scenarioPass === 7 && lifecycle.checkPass === 25 && lifecycle.checkFail === 0);
const runnerPath = 'tests/run-completion-fix-callability.mjs';
assert.deepEqual(await readFile(new URL(runnerPath, repo)), await read(`inputs/${runnerPath}`));
assert.deepEqual(await read(`inputs/${runnerPath}`), await read(`callability/inputs/${runnerPath}`));
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
git('diff', '--exit-code', '2a0a81dc59dd7a805e7f88b63c5482f7ca90878a', '--', 'tests/evidence', 'fixtures/completion-independent',
  'tests/lib/completion-oracle.mjs', 'tests/lib/completion-fixtures.mjs', 'tests/lib/completion-fix-fixtures.mjs', 'tests/lib/completion-fix-oracle.mjs');
await writeFile(new URL('review/post-audit.json', evidence), JSON.stringify({passed: true, kind: 'raw-evidence-replay-only', originals,
  auditedCalls, uniqueCallControls: auditedCalls.length, actualCallStartEvents: eventCounts['compile-started'], eventCounts,
  constSemanticFailures: auditedCalls.filter(row => row.semantic?.kind === 'const').length,
  unavailableSemanticFailures: auditedCalls.filter(row => row.semantic?.kind === 'unavailable').length,
  deletedSemanticFailures: auditedCalls.filter(row => row.semantic?.kind === 'deleted').length,
  shadowValues, mainCounts: main.counts, initializerCounts: initializer.counts,
  originalInputsAndTrackedHistoryUnchanged: true, currentExecutableMatchesActualRunArchive: true,
  notes: ['No new Clang/provider/CompilerProbe execution in this audit.',
    'Late unexecuted runner hardening is kept separately; actual executed runner restored byte-for-byte.',
    'Canonical source/contents and event counts independently verified over all 27 raw controls.']}, null, 2) + '\n', {flag: 'wx'});
await writeFile(new URL('review/post-audit-script.mjs', evidence), await readFile(new URL('tests/audit-completion-fix-round.mjs', repo)), {flag: 'wx'});
console.log(JSON.stringify({passed: true, originals: originals.map(({id, sourceHash}) => ({id, sourceHash})), uniqueCallControls: 27, eventCounts,
  main21: main.counts.passed, initializer6: initializer.counts.passed, shadow: shadowValues.map(row => row.displayValue)}, null, 2));
