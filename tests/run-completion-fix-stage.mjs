// One-shot fixed repair round. Every child command keeps its raw output and exit code.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const targetPath = resolve(process.argv[2] ?? ''), expectedCommit = process.argv[3], name = process.argv[4];
assert.match(expectedCommit ?? '', /^[a-f0-9]{40}$/);
assert.match(name ?? '', /^integrated-person05-completion-fix-[a-z0-9.-]+$/);
const targetGit = (...args) => execFileSync('git', ['-c', `safe.directory=${targetPath}`, '-C', targetPath, ...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
assert.equal(targetGit('rev-parse', 'HEAD').trim(), expectedCommit);
targetGit('diff', '--exit-code', expectedCommit, '--', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'contracts');
const rootPath = `tests/evidence/${name}`, evidence = new URL(`${rootPath}/`, repo);
await mkdir(evidence);
async function save(path, value) {
  const destination = new URL(path, evidence); await mkdir(new URL('./', destination), {recursive: true});
  await writeFile(destination, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
await save('.gitattributes', '* -text\n');
const nonce = randomBytes(6).toString('hex'), commands = [];
await save('invocation.json', {requestId: 'CC-20261030-05', argv: process.argv, node: process.version, targetPath, expectedCommit, nonce,
  stage: 'independent-repair-branch-semantics', startedAt: new Date().toISOString(),
  scope: 'No new application manifest/profile/package/browser/iPad acceptance; full compile uses original compiler identity.'});
const originalPaths = ['fixtures/completion-independent', 'tests/lib/completion-oracle.mjs', 'tests/lib/completion-fixtures.mjs',
  'tests/run-completion-independent.mjs', 'tests/completion-availability-independent.mjs', 'tests/completion-const-callability.mjs',
  'tests/completion-lifecycle-independent.mjs'];
const localGit = (...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
localGit('diff', '--exit-code', '2a0a81dc59dd7a805e7f88b63c5482f7ca90878a', '--', ...originalPaths);
const inputs = ['tests/run-completion-fix-stage.mjs', 'tests/completion-fix-integrity-independent.mjs', 'tests/run-completion-fix-independent.mjs',
  'tests/run-completion-fix-callability.mjs', 'tests/completion-fix-lifecycle-independent.mjs', 'tests/lib/completion-fix-late-fixtures.mjs',
  'tests/lib/completion-fix-fixtures.mjs', 'tests/lib/completion-fix-oracle.mjs', 'tests/lib/completion-fix-callability-oracle.mjs',
  'tests/completion-fix-callability-oracle-checks.mjs', 'docs/validation/completion-fix-plan-person05-2026-10-30.md'];
const fingerprints = [];
for (const path of inputs) {
  const bytes = await readFile(new URL(path, repo)); await save(`inputs/${path}`, bytes);
  fingerprints.push({path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await save('input-fingerprints.json', fingerprints);
function run(id, executable, args, env = {}) {
  console.log(`START ${id}`);
  const startedAt = new Date().toISOString(), started = performance.now();
  const actual = spawnSync(executable, args, {cwd, env: {...process.env, ...env}, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  const record = {id, executable, args, environmentOverrides: env, startedAt, endedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started, exitCode: actual.status, signal: actual.signal, error: actual.error ? String(actual.error) : null};
  commands.push(record);
  console.log(`END ${id}: exit ${record.exitCode}`);
  return {actual, record};
}
async function execute(id, executable, args, env) {
  const {actual, record} = run(id, executable, args, env);
  await save(`commands/${id}.stdout.txt`, actual.stdout ?? '');
  await save(`commands/${id}.stderr.txt`, actual.stderr ?? '');
  await save(`commands/${id}.json`, record);
  return record.exitCode === 0 && record.error === null;
}
const fixed = ['--target-root', targetPath, '--target-commit', expectedCommit];
const identitySummary = `${rootPath}/identity/summary.json`;
let fatal = null;
try {
  assert(await execute('identity', process.execPath, ['tests/completion-fix-integrity-independent.mjs', ...fixed, '--evidence-dir', `${rootPath}/identity`]),
    'Independent derivation / integrity stage must pass before real compiler use');
  await execute('queries', process.execPath, ['tests/run-completion-fix-independent.mjs', ...fixed,
    '--evidence-dir', `${rootPath}/queries`, '--identity-summary', identitySummary, '--nonce', nonce]);
  await execute('callability', process.execPath, ['tests/run-completion-fix-callability.mjs', ...fixed,
    '--evidence-dir', `${rootPath}/callability`, '--nonce', nonce]);
  await execute('lifecycle', process.execPath, ['tests/completion-fix-lifecycle-independent.mjs', ...fixed,
    '--evidence-dir', `${rootPath}/lifecycle`, '--identity-summary', identitySummary]);
  const regressionEnv = {VALIDATION_COMPILER_ROOT: targetPath, VALIDATION_DEBUGGER_ROOT: targetPath,
    VALIDATION_EVIDENCE_DIR: `${rootPath}/regression`};
  await execute('main21', process.execPath, ['tests/run-validation.mjs'], regressionEnv);
  await execute('shadow-minimal', process.execPath, ['tests/reproduce.mjs', 'shadow'], regressionEnv);
  await execute('loop-minimal', process.execPath, ['tests/reproduce.mjs', 'loop-header'], regressionEnv);
  await execute('initializer6', process.execPath, ['tests/initializer-lifetime.mjs'], regressionEnv);
} catch (error) {
  fatal = {message: error.message, stack: error.stack}; await save('fatal.json', fatal);
}
await execute('mandatory-check', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run check']);
await execute('mandatory-test', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test']);
await execute('oracle-infrastructure', process.execPath, ['--test', 'tests/completion-fixtures-checks.mjs', 'tests/completion-oracle-checks.mjs',
  'tests/completion-fix-fixtures-checks.mjs', 'tests/completion-fix-oracle-checks.mjs', 'tests/completion-fix-callability-oracle-checks.mjs']);
let targetUnchanged = targetGit('rev-parse', 'HEAD').trim() === expectedCommit;
try {targetGit('diff', '--exit-code', expectedCommit, '--', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'contracts');}
catch {targetUnchanged = false;}
const originalUnchanged = localGit('diff', '--name-only', '2a0a81dc59dd7a805e7f88b63c5482f7ca90878a', '--', ...originalPaths).trim() === '';
const passed = fatal === null && targetUnchanged && originalUnchanged && commands.every(row => row.exitCode === 0 && row.error === null);
await save('summary.json', {requestId: 'CC-20261030-05', expectedCommit, targetPath, nonce, passed, fatal, targetUnchanged, originalUnchanged,
  commands, productScope: 'Fixed compiler-branch repair semantics; final integration/profile/package/UI/iPad remain separate.'});
console.log(JSON.stringify({name, expectedCommit, passed, targetUnchanged, originalUnchanged, nonce, commands: commands.map(({id, exitCode}) => ({id, exitCode}))}, null, 2));
if (!passed) process.exitCode = 1;
