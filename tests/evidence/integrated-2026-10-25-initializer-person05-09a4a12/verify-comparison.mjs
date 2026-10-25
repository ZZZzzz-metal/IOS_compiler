import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const positive = new URL('./', import.meta.url);
const root = new URL('../../../', import.meta.url);
const negative = new URL('tests/evidence/integrated-2026-10-25-initializer-person05-v0.2.1/', root);
const fixedRevision = '09a4a12378e69c5bef98e713fd51cedbf6525ca5';
const json = async (directory, name) => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${fileURLToPath(root).replace(/[\\/]$/, '')}`, '-C', fileURLToPath(root), ...args], { maxBuffer: 8 * 1024 * 1024 });
const before = await json(negative, 'initializer-lifetime.json'), after = await json(positive, 'initializer-lifetime.json');
assert.deepEqual(before.counts, { passed: 0, failed: 6 });
assert.deepEqual(after.counts, { passed: 6, failed: 0 });
assert.equal(after.compilerRevision, fixedRevision); assert.equal(after.debuggerRevision, fixedRevision);
assert.equal(git('diff', '--name-only', 'integration-v0.2.1', '--', 'compiler', 'debugger', 'app', 'contracts').toString().trim(), '');
for (const input of after.extraInputHashes) {
  const bytes = await readFile(new URL(input.path, root)); assert.equal(hash(bytes), input.sha256); assert.equal(bytes.length, input.byteLength);
}
const binaries = [];
for (const compiled of before.observations.compilations) {
  const current = after.observations.compilations.find(item => item.id === compiled.id); assert.ok(current);
  assert.equal(current.sourceHash, compiled.sourceHash); assert.equal(current.executableRef.sha256, compiled.executableRef.sha256);
  binaries.push({ id: compiled.id, sourceHash: compiled.sourceHash, artifactSHA256: compiled.executableRef.sha256, sameActualArtifact: true });
}
for (const result of before.results) {
  assert.equal(result.failures.length, 2);
  const second = result.samples.filter(sample => sample.cycle === 1 && ['initializer-callee', 'returned-before-store'].includes(sample.stage));
  assert.equal(second.length, 2); for (const sample of second) { assert.equal(sample.current.availability, 'available'); assert.equal(sample.current.displayValue, '40'); }
}
for (const result of after.results) {
  assert.equal(result.failures.length, 0);
  for (const sample of result.samples.filter(sample => sample.current)) {
    if (sample.stage === 'after-store') { assert.equal(sample.current.availability, 'available'); assert.equal(sample.current.displayValue, String(40 + sample.cycle)); }
    else assert.notEqual(sample.current.availability, 'available');
    if (sample.ready) { assert.equal(sample.ready.availability, 'available'); assert.equal(sample.first.displayValue, '9'); assert.equal(sample.second.displayValue, '4'); }
  }
}
assert.deepEqual((await json(positive, 'independent.json')).counts, { passed: 21, failed: 0 });
for (const name of ['shadow', 'loop-header']) assert.equal((await json(positive, `regression-${name}.json`)).status, 'passed');
for (const name of ['acceptance', 'modules', 'integration']) assert.equal((await json(positive, `${name}-command.json`)).exitCode, 0);
for (const command of await json(positive, 'shared-checks.json')) assert.equal(command.exitCode, 0);
const moduleOutput = await readFile(new URL('modules-output.txt', positive), 'utf8');
assert.match(moduleOutput, /tests 94/); assert.match(moduleOutput, /pass 94/);
const preserved = [];
for (const prefix of ['tests/evidence/', 'tests/evidence/integrated-2026-10-25/', 'tests/evidence/integrated-2026-10-25-person05-v0.2.1/']) {
  for (const entry of JSON.parse(await readFile(new URL(prefix + 'SHA256SUMS.json', root), 'utf8'))) {
    const bytes = await readFile(new URL(prefix + entry.file, root));
    assert.equal(hash(bytes), entry.sha256.replace(/^sha256:/, '')); assert.equal(bytes.length, entry.byteLength);
    preserved.push({ path: prefix + entry.file, sha256: hash(bytes), byteLength: bytes.length });
  }
}
const testedRoot = after.extraInputHashes.length && after.provenance.sourceHashes.find(item => item.path === 'debugger/src/node-worker.mjs').base;
const integrationCandidate = await (await import(new URL('app/integration/candidate.mjs', testedRoot))).createIntegrationCandidate();
await writeFile(new URL('integration-profile.json', positive), JSON.stringify({ profile: integrationCandidate.profile, resources: integrationCandidate.resources }, null, 2) + '\n');
await writeFile(new URL('history-preservation.json', positive), JSON.stringify({ preserved, fileCount: preserved.length, noOldEvidenceOverwritten: true }, null, 2) + '\n');
const summary = { recordedAt: new Date().toISOString(), owner: '05 independent follow-up', defect: 'VAL-003 initializer lifetime / stale previous-iteration value',
  validationRoot: root.href, validationRevisionAtRun: after.validationRevisionAtStart, fixedRevision,
  before: { productCode: 'integration-v0.2.1', workspaceRevision: before.debuggerRevision, counts: before.counts, exitCode: 1, profile: before.profile.compatibilityId },
  after: { counts: after.counts, exitCode: 0, profile: after.profile.compatibilityId, integrationProfile: integrationCandidate.profile.compatibilityId },
  sameSourceAndWasm: binaries, priorAcceptance: { passed: 21, failed: 0 }, oldMinimalRegressions: { passed: 2, failed: 0 },
  moduleRegression: { compiler: 27, debugger: 67, totalPassed: 94, failed: 0 }, integrationPipeline: { passed: 3, failed: 0 },
  contractChecks: { passed: 10, failed: 0 }, historyEvidenceFilesVerified: preserved.length,
  conclusion: 'New issue independently reproduced on old integrated code and fixed in the tested 03 branch. It is not yet an integration release sign-off.',
  pending: ['01 integration of the 03 fix and 05 regression contribution', '04 fixed UI/storage handoff before independent UI acceptance', 'real iPad complete-offline, interface and draft workflow acceptance'] };
await writeFile(new URL('summary.json', positive), JSON.stringify(summary, null, 2) + '\n');
for (const directory of [negative, positive]) {
  const entries = [];
  for (const file of (await readdir(directory)).sort()) {
    if (file === 'SHA256SUMS.json') continue;
    const bytes = await readFile(new URL(file, directory)); entries.push({ file, byteLength: bytes.length, sha256: hash(bytes) });
  }
  await writeFile(new URL('SHA256SUMS.json', directory), JSON.stringify(entries, null, 2) + '\n');
}
console.log(JSON.stringify({ before: summary.before.counts, after: summary.after.counts, identicalPrograms: binaries.length,
  moduleRegression: summary.moduleRegression, preservedHistoricalFiles: preserved.length, integrationProfile: integrationCandidate.profile.compatibilityId }, null, 2));
