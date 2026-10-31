// Owner02 self-check of the frozen owner05 PREP controls. This is not independent
// acceptance. Pass owner05's checkout as argv[2]; it is read, never modified.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { loadCompletionToolchain, completeWithClang } from '../../src/completion-engine.mjs';
import { loadToolchain, compileArtifact, evidenceJSON } from '../../src/toolchain-engine.mjs';
import { ToolFileSystem } from '../../src/wasm-host.mjs';
import { createSnapshot } from '../../src/source.mjs';

if (isMainThread) {
  assert(process.argv[2], 'Pass the owner05 checkout path');
  const worker = new Worker(new URL(import.meta.url), { workerData: { oraclePath: resolve(process.argv[2]) } });
  await new Promise((done, reject) => {
    worker.on('error', reject);
    worker.on('exit', code => code === 0 ? done() : reject(new Error(`Verification worker exited ${code}`)));
  });
} else {
  const compiler = new URL('../../', import.meta.url), oracle = pathToFileURL(workerData.oraclePath + sep);
  const frozen = 'bef7bc973780e55d5eecdcdfc0e7da1c3d1c6fad';
  const out = new URL(`evidence/completion-fix-2026-10-30/controls-${new Date().toISOString().replace(/[:.]/gu, '-')}/`, compiler);
  await mkdir(out, { recursive: true });
  const save = (path, value) => writeFile(new URL(path, out), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const inputs = [];
  for (const path of ['tests/lib/completion-fix-fixtures.mjs', 'tests/lib/completion-fix-oracle.mjs', 'tests/lib/completion-fixtures.mjs', 'tests/lib/completion-oracle.mjs']) {
    const source = await readFile(new URL(path, oracle));
    const committed = execFileSync('git', ['show', `${frozen}:${path}`], { cwd: workerData.oraclePath, maxBuffer: 4 * 1024 * 1024 });
    assert.deepEqual(source, committed, `Independent preparation input drifted: ${path}`);
    inputs.push({ path, sha256: hash(source), byteLength: source.length });
  }
  const { generateCompletionFixFixtures } = await import(new URL('tests/lib/completion-fix-fixtures.mjs', oracle));
  const { requestFromFixture } = await import(new URL('tests/lib/completion-oracle.mjs', oracle));
  const { evaluateCompletionFix } = await import(new URL('tests/lib/completion-fix-oracle.mjs', oracle));
  const nonce = randomBytes(8).toString('hex'), fixtures = generateCompletionFixFixtures(nonce);
  assert.equal(fixtures.length, 11);
  assert.equal(fixtures.reduce((count, fixture) => count + fixture.controls.length, 0), 24);
  await save('inputs.json', { scope: 'Owner02 self-test, not owner05 independent acceptance', frozen, inputs, nonce, fixtures });
  const lock = JSON.parse(await readFile(new URL('resources/toolchain.lock.json', compiler)));
  const read = path => readFile(new URL(`resources/${path}`, compiler));
  const originalBefore = hash(await read(`${lock.vendorDirectory}/clang`));
  const completion = await loadCompletionToolchain(lock, read);
  const full = await loadToolchain(lock, read);
  const observations = [], controls = [];
  for (const fixture of fixtures) {
    const request = requestFromFixture(fixture, randomUUID(), 1);
    const actual = await completeWithClang(request, completion);
    const verdict = evaluateCompletionFix(fixture, request, actual.result, completion.identity);
    await save(`${fixture.id}.json`, { request, actual, verdict });
    assert.equal(verdict.verdict, 'passed', JSON.stringify(verdict));
    observations.push({ id: fixture.id, verdict });
    for (const control of fixture.controls) {
      const input = { ...fixture.language, requestId: randomUUID(), mode: 'debug', optimization: 'O0',
        snapshot: createSnapshot(control.files, control.translationUnit) };
      const actual = await compileArtifact(input, full);
      let smoke;
      if (actual.status === 'compiled') {
        const fs = await ToolFileSystem.create(full.modules.memfs);
        smoke = await fs.run(await WebAssembly.compile(actual.executable), ['main.wasm']);
      }
      await save(`${fixture.id}-${control.id}.json`, { input, expect: control.expect, actual: evidenceJSON(actual), smoke });
      assert.equal(actual.status, control.expect.status, `${fixture.id}/${control.id}`);
      if (control.expect.status === 'failed') {
        assert.equal(actual.reason, 'compiler-exit');
        const errors = actual.diagnostics.filter(item => item.severity === 'error');
        assert.ok(errors.length > 0, 'Failed control needs a real compiler error');
        if (control.expect.errorPattern) assert.match(errors.map(item => item.message).join('\n'), new RegExp(control.expect.errorPattern, 'u'));
        else assert.match(actual.diagnostics.filter(item => ['error', 'note'].includes(item.severity)).map(item => item.message).join('\n'), /not marked const|qualifier/iu);
      } else {
        assert.equal(smoke.exitCode, control.expect.smokeExitCode);
        assert.equal(actual.compilerResourceHash, originalBefore, 'Full compiler must still execute original bytes');
        assert.equal(actual.toolchainId, lock.toolchainId);
      }
      if (control.expect.warningPattern) assert.ok(actual.diagnostics.some(item => item.severity === 'warning' && new RegExp(control.expect.warningPattern, 'u').test(item.message)));
      controls.push({ fixture: fixture.id, id: control.id, status: actual.status, smokeExitCode: smoke?.exitCode, passed: true });
    }
  }
  assert.equal(hash(await read(`${lock.vendorDirectory}/clang`)), originalBefore);
  await save('summary.json', { scope: 'Owner02 self-test; owner05 fixed-target verification remains separate', inputs, frozen, nonce,
    queriesPassed: observations.length, controlsPassed: controls.length, observations, controls,
    completionIdentity: completion.identity, fullCompilerHash: originalBefore, originalUnchanged: true });
  console.log(JSON.stringify({ evidence: out.href, queriesPassed: observations.length, controlsPassed: controls.length }));
}
