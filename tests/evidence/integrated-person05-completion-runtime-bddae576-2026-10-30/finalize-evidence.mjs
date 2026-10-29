// One-shot evidence collation. Audit success does not change the failed boundaries.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here = new URL('./', import.meta.url), repo = new URL('../../../', import.meta.url), cwd = fileURLToPath(repo);
const json = async path => JSON.parse(await readFile(new URL(path, here), 'utf8'));
const save = async (path, value) => {
  const destination = new URL(path, here); await mkdir(new URL('./', destination), {recursive: true});
  await writeFile(destination, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
};
const commit = 'bddae57653bede9a38a3510006d761e2a9d19a04';
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
assert.equal(git('rev-parse', 'HEAD').trim(), commit);
git('diff', '--exit-code', commit, '--', 'app', 'compiler', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json');
const primary = await json('summary.json'), audit = await json('post-audit/provider-and-regression-audit.json');
assert.deepEqual(primary.counts, {passed: 29, failed: 0, 'boundary-failed': 1, 'infrastructure-failed': 0, 'ui-pending': 3, pending: 0});
assert.equal(primary.targetUnchanged, true); assert.equal(audit.comparisons.length, 30);
const life = await json('lifecycle-run-01/summary.json'), proof = await json('callability-run-01/summary.json'), availability = await json('availability-run-01/summary.json');
assert.equal(life.passed, true); assert.equal(life.scenarioPass, 7); assert.equal(life.checkPass, 25); assert.equal(life.checkFail, 0);
assert.equal(life.workers.length, 6); assert(life.workers.every(worker => worker.exit && worker.threadIdAfter === -1));
assert.equal(proof.passed, true); assert.equal(proof.targetUnchanged, true); assert.deepEqual(proof.errors, []);
assert.equal(availability.boundaryFailed, true); assert.equal(availability.targetUnchanged, true); assert.equal(availability.fatalError, null);
assert.equal(availability.checkPass, 9); assert.equal(availability.checkFail, 2);
assert.equal(availability.completionRoutes.adapter.verdict, 'boundary-failed'); assert.equal(availability.completionRoutes.native.verdict, 'boundary-failed');
assert(availability.workers.every(worker => worker.exit && worker.threadIdAfter === -1));
const precommit = [];
for (const [id, script] of [['check', 'npm.cmd run check'], ['contracts', 'npm.cmd test']]) {
  const startedAt = new Date().toISOString(), result = spawnSync('cmd.exe', ['/d', '/s', '/c', script], {cwd, encoding: 'utf8'});
  const record = {id, executable: 'cmd.exe', args: ['/d', '/s', '/c', script], startedAt, endedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal, error: result.error ? String(result.error) : null};
  await save(`precommit/${id}.stdout.txt`, result.stdout ?? ''); await save(`precommit/${id}.stderr.txt`, result.stderr ?? ''); await save(`precommit/${id}.command.json`, record);
  precommit.push(record); assert.equal(result.status, 0); assert(!result.error);
}
const sourcePaths = (await readdir(new URL('fixtures/completion-independent/', repo))).map(path => `fixtures/completion-independent/${path}`);
sourcePaths.push('tests/lib/completion-fixtures.mjs', 'tests/lib/completion-oracle.mjs', 'tests/lib/completion-native-worker.mjs',
  'tests/run-completion-independent.mjs', 'tests/run-completion-stage-checks.mjs', 'tests/audit-completion-evidence.mjs',
  'tests/completion-fixtures-checks.mjs', 'tests/completion-oracle-checks.mjs', 'tests/completion-lifecycle-independent.mjs',
  'tests/completion-const-callability.mjs', 'tests/completion-availability-independent.mjs',
  'docs/validation/completion-backend-person05-bddae576-2026-10-30.md', 'docs/handoffs/05.md', 'docs/validation/README.md');
const sourceFingerprints = [];
for (const path of sourcePaths.sort()) {
  const bytes = await readFile(new URL(path, repo)); await save(`source-archive/${path}`, bytes);
  sourceFingerprints.push({file: path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await save('source-archive-fingerprints.json', sourceFingerprints);
await save('primary-invocation.json', {executable: process.execPath, cwd,
  args: ['tests/run-completion-independent.mjs', '--target-root', cwd, '--target-commit', commit, '--evidence-name', 'integrated-person05-completion-runtime-bddae576-2026-10-30', '--mode', 'both'],
  observedExitCode: 1, note: 'Observed tool execution exit1 retained. The original primary summary, requests and responses are not overwritten.'});
await save('stage-result.json', {requestId: 'CC-20261029-05', fixedTarget: commit, candidate: audit.candidateIdentity,
  verdict: 'backend core tested; availability boundaries failed; UI/package/iPad acceptance pending',
  primaryCounts: primary.counts, completedPrimaryResponses: primary.completedProviderResponses,
  supplementalAvailabilityLogicalCases: 1, supplementalAvailabilityVerdict: 'boundary-failed in both routes',
  lifecycle: {scenarios: 7, passed: 7, checks: 25, actualCompleteCalls: life.actualCompleteCalls, realWorkersReleased: 6},
  routineChecks: audit.routineCount, controlledOfflineChecks: audit.offlineChecks, oracleInfrastructureChecks: audit.oracleInfrastructureChecks,
  callabilityControlsVerified: true, allTargetChecksUnchanged: primary.targetUnchanged && life.targetUnchanged && proof.targetUnchanged && availability.targetUnchanged,
  precommit, originalFailuresPreserved: true,
  pending: ['UI and controlled editing concurrency', 'immutable new offline package and stopped-server fresh-source completion/compile/debug', 'physical iPad/Safari/keyboard/touch/IME/performance', 'draft durability and G2/G3']});
await save('README.md', '# 5号固定补全后端阶段证据\n\n固定bddae576，2026-10-30。\n原33：29通过、const-string1边界失败、3UI待验；30场景双路60真实响应，结果逐字段一致。主运行器exit1保留。\n补充属性1逻辑场景，两路unavailable候选均失败，exit1保留；deprecated可调用，不把其出现判失败。\n真实生命周期7场景25检查通过，常规276/离线门禁23/基础设施16通过，不能掩盖可用性边界。\n完整原始请求、CLI、响应、调用正负对照、Worker事件、命令、产品指纹及执行源码均在本目录。\nstage-result.json为审计汇总；summary.json为原主运行器结果，未覆盖。审计通过不代表产品全部通过。\n旧32/33准备及最终179文件verify --git通过，原失败/旧标签/包保持不变。UI/新包/实际iPad/G2/G3另验。\n');
console.log(JSON.stringify({evidenceCollated: true, productBoundaryFailuresPreserved: true, archivedSourceFiles: sourcePaths.length, precommitPassed: true}, null, 2));
