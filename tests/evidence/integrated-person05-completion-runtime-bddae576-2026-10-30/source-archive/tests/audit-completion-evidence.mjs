// Independent post-run audit; a preserved product failure is never relabelled a pass.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadCompletionFixtures} from './lib/completion-fixtures.mjs';
import {createIntegrationCandidate} from '../app/integration/candidate.mjs';
const repo = new URL('../', import.meta.url), name = process.argv[2];
assert.match(name ?? '', /^integrated-person05-completion-runtime-[a-z0-9.-]+$/);
const evidence = new URL(`tests/evidence/${name}/`, repo), json = async path => JSON.parse(await readFile(new URL(path, evidence), 'utf8'));
const output = new URL('post-audit/', evidence); await mkdir(output);
const save = (file, value) => writeFile(new URL(file, output), JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const sha = text => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const fixtures = await loadCompletionFixtures(), summary = await json('summary.json'), comparisons = [];
for (const fixture of fixtures.filter(item => item.expect.trigger !== 'none')) {
  const adapter = await json(`adapter/${fixture.id}/actual.json`), native = await json(`native/${fixture.id}/actual.json`);
  const request = await json(`native/${fixture.id}/request.json`);
  assert.deepEqual(adapter, native.result, `${fixture.id}: public adapter and raw-engine result differ`);
  assert.deepEqual(request, await json(`adapter/${fixture.id}/request.json`));
  for (const file of request.snapshot.files) assert.equal(file.contentHash, sha(file.text));
  const files = request.snapshot.files.map(({path, role, text}) => ({path, role, text}));
  assert.equal(request.snapshot.sourceHash, sha(JSON.stringify({version: 1, translationUnit: request.snapshot.translationUnit, files})));
  const position = await json(`native/${fixture.id}/evaluation.json`); assert.equal(position.position.passed, true);
  const reads = native.resourceReads;
  assert.deepEqual(reads.map(item => item.path.split('/').at(-1)), ['memfs', 'sysroot.tar', 'clang']);
  comparisons.push({caseId: fixture.id, sourceHash: request.snapshot.sourceHash, identicalResults: true,
    nativeExitCode: native.native?.exitCode, itemCount: adapter.items.length, isIncomplete: adapter.isIncomplete,
    verdict: position.verdict, position: position.position, resourceReads: reads});
}
assert.equal(summary.targetUnchanged, true); assert.equal(summary.completedProviderResponses, 60);
const constResponse = await json('native/const-string/actual.json');
const append = constResponse.result.items.filter(item => item.insertText === 'append');
assert(append.length > 0); assert.equal((await json('native/const-string/evaluation.json')).verdict, 'boundary-failed');
const candidate = await createIntegrationCandidate();
assert.equal(candidate.resources.length, 35);
for (const suffix of ['adapter', 'worker', 'engine', 'source', 'output']) assert(candidate.resources.some(item => item.relativePath === `compiler/src/completion-${suffix}.mjs`));
await save('candidate.json', {profile: candidate.profile, resources: candidate.resources});
const checks = await json('verification/summary.json'); assert.equal(checks.allCommandsPassed, true);
const counts = {};
for (const id of ['contracts', 'modules', 'pipeline', 'ui-storage', 'offline', 'oracle-infrastructure']) {
  const text = await readFile(new URL(`verification/${id}.stdout.txt`, evidence), 'utf8');
  const tests = /(?:#|ℹ) tests (\d+)/u.exec(text), pass = /(?:#|ℹ) pass (\d+)/u.exec(text), fail = /(?:#|ℹ) fail (\d+)/u.exec(text);
  assert(tests && pass && fail, `${id}: unrecognized count format (raw output retained)`);
  counts[id] = {tests: Number(tests[1]), passed: Number(pass[1]), failed: Number(fail[1])};
  assert.equal(counts[id].failed, 0); assert.equal(counts[id].tests, counts[id].passed);
}
const main = await json('verification/details/main-21/independent.json');
const shadow = main.observations.queries.filter(item => item.query.kind === 'evaluate' && item.query.expression === 'shadow').map(item => item.reply.result);
assert(shadow.some(item => item.availability === 'available' && item.displayValue === '17'));
assert(shadow.some(item => item.availability === 'available' && item.displayValue === '5'));
const shadowMinimal = await json('verification/details/regressions-2/regression-shadow.json'); assert.equal(shadowMinimal.status, 'passed');
const loop = await json('verification/details/regressions-2/regression-loop-header.json'); assert.equal(loop.status, 'passed');
assert(loop.samples.filter(item => item.actual.availability === 'available').length >= 6);
const routineCount = ['contracts', 'modules', 'pipeline', 'ui-storage'].reduce((sum, id) => sum + counts[id].passed, 0) + 21 + 2 + 6;
assert.equal(routineCount, 276); assert.equal(counts.offline.passed, 23); assert.equal(counts['oracle-infrastructure'].passed, 16);
await save('provider-and-regression-audit.json', {auditPassed: true, productEligibilityVerdict: '29 passed, const-string boundary failed, 3 UI-only pending',
  candidateIdentity: candidate.profile.compatibilityId, routineCount, offlineChecks: counts.offline.passed,
  oracleInfrastructureChecks: counts['oracle-infrastructure'].passed, parsedCounts: counts,
  shadowValues: shadow, minimalShadow: shadowMinimal.samples.map(item => ({expected: item.expected, actual: item.actual})),
  loopSamples: loop.samples.map(item => ({line: item.line, actual: item.actual})),
  appendInConstString: append, comparisons});
console.log(JSON.stringify({auditPassed: true, identicalAdapterNativeResults: comparisons.length, routineCount, offlineChecks: 23,
  oracleInfrastructureChecks: 16, preservedBoundaryFailure: 'const-string', appendCount: append.length, candidateIdentity: candidate.profile.compatibilityId}, null, 2));
