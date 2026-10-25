import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationCandidate } from '../candidate.mjs';
import { createNodeHost } from '../node-host.mjs';
import { exerciseCpp, exerciseC, exerciseStopRestart } from '../node-demo.mjs';

// Each scenario compiles fresh source through CompilerAdapter, persists its Wasm,
// and executes that exact BuildManifest in a separate real debugger Worker.
test('integrated C++17 build preserves breakpoints, all steps, live variables and recursive frames', { timeout: 180000 }, async () => {
  const candidate = await createIntegrationCandidate();
  const evidence = await exerciseCpp(createNodeHost(candidate));
  assert.equal(evidence.status, 'succeeded');
  assert.equal(evidence.build.language.standard, 'c++17');
  assert.equal(evidence.build.profile.resourceManifestHash, candidate.profile.resourceManifestHash);
  assert.equal(evidence.persistedSHA256, evidence.build.executable.sha256);
  assert.equal(evidence.steps.total, '15'); assert.equal(evidence.steps.changed, '23'); assert.equal(evidence.steps.vector, '23');
  assert.deepEqual(evidence.recursion.map(item => item.indices), [['0'], ['1', '0'], ['2', '1', '0']]);
  assert.equal(evidence.steps.stalePauseRejected, true);
  assert.equal(evidence.termination.exitCode, 0);
  assert.equal(evidence.output, 'cpp total=15 changed=23 vector=23\n');
});

test('integrated C11 build consumes stdin and prints values read from real memory', { timeout: 180000 }, async () => {
  const evidence = await exerciseC(createNodeHost(await createIntegrationCandidate()));
  assert.equal(evidence.status, 'succeeded'); assert.equal(evidence.build.language.standard, 'c11');
  assert.equal(evidence.first, '2'); assert.equal(evidence.large, '9223372036854775806');
  assert.equal(evidence.output, 'sum=20 first=2 int64=9223372036854775806\n');
  assert.equal(evidence.termination.exitCode, 0);
});

test('stopping a compiled infinite loop permits a new source build and new Worker session', { timeout: 240000 }, async () => {
  const evidence = await exerciseStopRestart(createNodeHost(await createIntegrationCandidate()));
  assert.equal(evidence.infinite.status, 'succeeded'); assert.equal(evidence.stopped.reason, 'stop');
  assert.ok(evidence.stopMs < 3000); assert.equal(evidence.staleQueryRejected, true);
  assert.equal(evidence.recovered.status, 'succeeded');
  assert.notEqual(evidence.infinite.build.sourceHash, evidence.recovered.build.sourceHash);
  assert.notEqual(evidence.infinite.build.buildId, evidence.recovered.build.buildId);
  assert.equal(evidence.output, 'recompiled=47\n'); assert.equal(evidence.termination.exitCode, 0);
});
