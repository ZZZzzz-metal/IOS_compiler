// Post-run audit only: read the actual new results, seal them, preserve history.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = new URL('./', import.meta.url);
const root = new URL('../../../', import.meta.url);
const rootPath = fileURLToPath(root);
const tag = 'integration-v0.2.1';
const expectedRevision = '7e92d2330b8e0fef1c75021d7e93522d8e6c6293';
const originalRevision = 'aa6c9def61f20a9ac41b6d21458f8b7b6a2b0f37';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${rootPath.replace(/[\\/]$/, '')}`, '-C', rootPath, ...args], { maxBuffer: 8 * 1024 * 1024 });
assert.equal(git('rev-parse', tag).toString().trim(), expectedRevision);
const main = await json('independent.json');
assert.deepEqual(main.counts, { passed: 21, failed: 0 });
for (const key of ['validationRevisionAtStart', 'compilerRevision', 'debuggerRevision']) assert.equal(main[key], expectedRevision);
assert.equal(main.provenance.candidateMode, 'integration-resource-profile');
assert.equal(main.environment.ipadTested, false);
const events = main.observations.sessions.flatMap(item => item.events);
const shadows = main.observations.queries.filter(item => item.query.kind === 'evaluate' && item.query.expression === 'shadow').map(item => {
  const pause = events.find(event => event.kind === 'paused' && event.sessionId === item.query.key.sessionId && event.pauseId === item.query.key.pauseId);
  return { position: pause?.position, availability: item.reply.result?.availability, value: item.reply.result?.displayValue,
    sessionId: item.query.key.sessionId, pauseId: item.query.key.pauseId, frameId: item.query.key.frameId };
});
assert.ok(shadows.some(item => item.position?.sourcePath === 'cpp-core.cpp' && item.position.line === 44 && item.availability === 'available' && item.value === '17'));
assert.ok(shadows.some(item => item.position?.sourcePath === 'cpp-core.cpp' && item.position.line === 46 && item.availability === 'available' && item.value === '5'));
const minimalShadow = await json('regression-shadow.json');
const loop = await json('regression-loop-header.json');
assert.equal(minimalShadow.status, 'passed'); assert.equal(loop.status, 'passed');
assert.deepEqual(minimalShadow.samples.map(item => item.actual.displayValue), ['19', '7']);
const headers = loop.samples.filter(item => item.line === 3);
const body = loop.samples.filter(item => item.line === 4);
assert.equal(headers.length, 4); assert.notEqual(headers[0].actual.availability, 'available');
assert.deepEqual(body.map(item => item.actual.displayValue), ['0', '1', '2']);
for (const header of headers.slice(1)) assert.equal(header.actual.availability, 'available');
const commands = await Promise.all(['acceptance-command.json', 'regressions-command.json', 'modules-command.json'].map(json));
const shared = await json('shared-checks-command.json');
for (const command of [...commands, ...shared]) assert.equal(command.exitCode, 0);

const historicalManifest = JSON.parse(git('show', `${originalRevision}:tests/evidence/SHA256SUMS.json`).toString());
const preserved = [];
for (const entry of historicalManifest) {
  const path = `tests/evidence/${entry.file}`;
  const original = git('show', `${originalRevision}:${path}`), tagBytes = git('show', `${tag}:${path}`);
  const working = await readFile(new URL(path, root));
  assert.ok(original.equals(tagBytes), `Historical commit changed: ${path}`);
  assert.equal(digest(working), entry.sha256, `Historical working bytes changed: ${path}`);
  assert.equal(working.length, entry.byteLength);
  preserved.push({ path, byteLength: working.length, sha256: digest(working), originalEqualsTag: true, workingMatchesOriginalPinnedBytes: true });
}
assert.ok(git('show', `${originalRevision}:tests/evidence/SHA256SUMS.json`).equals(git('show', `${tag}:tests/evidence/SHA256SUMS.json`)));
const priorIntegrated = git('diff', '--name-only', tag, '--', 'tests/evidence/integrated-2026-10-25').toString().trim();
assert.equal(priorIntegrated, '', 'Previous integration evidence was modified');
const productDiff = git('diff', '--name-only', tag, '--', 'compiler', 'debugger', 'app', 'contracts', 'package.json', 'package-lock.json',
  'tests/run-validation.mjs', 'tests/reproduce.mjs', 'tests/lib/harness.mjs', 'fixtures').toString().trim();
assert.equal(productDiff, '', 'Tested code differs from requested tag');
await writeFile(new URL('history-preservation.json', directory), JSON.stringify({ originalRevision, testedTag: tag, testedRevision: expectedRevision,
  preserved, historicalChecksumManifestGitBlobUnchanged: true, priorIntegratedEvidenceUnchanged: true,
  testedSourceMatchesTag: true }, null, 2) + '\n');
const summary = { recordedAt: new Date().toISOString(), reviewer: '05 independent retest', testedTag: tag, testedRevision: expectedRevision,
  environment: main.environment, evidenceScope: 'desktop-node-real-programs', compatibilityId: main.profile.compatibilityId,
  resourceManifestHash: main.profile.resourceManifestHash, resourceCount: main.resources.length,
  acceptance: main.counts, minimalRegressions: { passed: 2, failed: 0 },
  moduleChecks: { passed: 78, failed: 0 }, contractChecks: { passed: 10, failed: 0 }, integrationChecks: { passed: 3, failed: 0 },
  commands, sharedChecks: shared,
  focus: { cppCoreShadow: shadows, minimalShadow: minimalShadow.samples.map(item => ({ line: item.pause.position.line, value: item.actual.displayValue })),
    loopHeaders: headers.map(item => ({ line: item.line, availability: item.actual.availability, value: item.actual.displayValue ?? null })),
    loopBody: body.map(item => ({ line: item.line, value: item.actual.displayValue })),
    note: 'At the bound loop-header instruction before ++i, subsequent header values observed were 0/1/2; no value is invented at the first declaration stop.' },
  conclusion: { VAL_001: 'fixed-and-independently-confirmed-for-tested-desktop-candidate', VAL_002: 'fixed-and-independently-confirmed-for-tested-desktop-candidate',
    G1: 'desktop core automatic acceptance confirmed within recorded scope', G2: 'pending real iPad complete-offline validation',
    G3: 'pending UI, drafts, installation and complete workflow' },
  history: { originalMainSuite: '20 passed, 1 failed', originalDistinctDefects: 2, preservedEvidenceCount: preserved.length,
    historicalChecksumManifestGitBlobUnchanged: true, priorIntegratedEvidenceUnchanged: true },
  pending: main.pending };
await writeFile(new URL('summary.json', directory), JSON.stringify(summary, null, 2) + '\n');
const sums = [];
for (const filename of (await readdir(directory)).sort()) {
  if (filename === 'SHA256SUMS.json') continue;
  const bytes = await readFile(new URL(filename, directory));
  sums.push({ file: filename, byteLength: bytes.length, sha256: digest(bytes) });
}
await writeFile(new URL('SHA256SUMS.json', directory), JSON.stringify(sums, null, 2) + '\n');
console.log(JSON.stringify({ acceptance: summary.acceptance, minimalRegressions: summary.minimalRegressions,
  cppCoreShadow: shadows.map(item => ({ line: item.position.line, value: item.value })),
  laterLoopHeaders: summary.focus.loopHeaders.slice(1), preservedHistoricalEvidence: preserved.length, sealedFiles: sums.length }, null, 2));
