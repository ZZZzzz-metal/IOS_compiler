// Person05 v0.4.7 existing-suite checks; repair semantic/browser suites are not repeated.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const target = '912a23bf14cd6e48a0adb7ec119f4ce86bc58f93';
const previousUi = 'b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const round = 'integrated-person05-completion-package-v047-912a23b-2026-10-31';
const automatic = new URL(`tests/evidence/${round}/automatic/`, repo);
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args],
  {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const productPaths = ['app', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json'];
assert.equal(git('rev-parse', 'HEAD').trim(), target);
git('diff', '--exit-code', target, '--', ...productPaths);
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', ...productPaths).trim(), '');
await mkdir(automatic); // Refuse to reuse a previous attempt.
async function save(path, value) {
  const destination = new URL(path, automatic); await mkdir(new URL('./', destination), {recursive: true});
  await writeFile(destination, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
await save('.gitattributes', '* -text\n');
await save('runner.mjs', await readFile(new URL(import.meta.url)));
const startedAt = new Date().toISOString(), commands = [];
async function run(id, executable, args) {
  const started = new Date().toISOString();
  const actual = spawnSync(executable, args, {cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  const record = {id, executable, args, startedAt: started, endedAt: new Date().toISOString(),
    exitCode: actual.status, signal: actual.signal, error: actual.error ? String(actual.error) : null};
  commands.push(record); await save(`${id}.stdout.txt`, actual.stdout ?? ''); await save(`${id}.stderr.txt`, actual.stderr ?? '');
  await save(`${id}.command.json`, record); console.log(`${id}: exit ${record.exitCode}`);
  return actual;
}
await run('mandatory-check', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run check']);
await run('mandatory-test', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test']);
await run('ui-storage', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:ui']);
await run('offline-controlled', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:offline']);

const originalPath = 'tests/completion-ui-negative-independent.mjs';
const original = await readFile(new URL(originalPath, repo), 'utf8');
await save('original-controlled-negative-source.mjs', original);
const substitutions = [
  ["const root=fileURLToPath(new URL('../',import.meta.url));", `const root=${JSON.stringify(cwd)};`],
  [`const target='${previousUi}';`, `const target='${target}';`],
  ["const output=resolve(root,'tests/evidence/integrated-person05-completion-ui-b14aeba-2026-10-30/controlled-negative');",
    `const output=${JSON.stringify(fileURLToPath(new URL('negative/', automatic)))};`],
  ["from '../ui/src/completion-controller.mjs'", `from ${JSON.stringify(pathToFileURL(resolve(cwd, 'ui/src/completion-controller.mjs')).href)}`]
];
let adapted = original;
for (const [from, to] of substitutions) {
  assert.equal(adapted.split(from).length, 2, 'One exact target/path substitution'); adapted = adapted.replace(from, to);
}
await save('controlled-negative-runner.mjs', adapted);
await save('controlled-negative-adaptation.json', {originalPath, originalTarget: previousUi, target,
  sourceSHA256: createHash('sha256').update(original).digest('hex'),
  adaptedSHA256: createHash('sha256').update(adapted).digest('hex'),
  substitutions: substitutions.map(([from, to]) => ({from, to})),
  unchanged: ['Original 3 fixtures and expectations', 'Four assertions per fixture', '300ms controller delay and 450ms observation', 'Provider never invoked', 'No browser/Worker/iPad claim']});
await run('ui-original-three-negatives', process.execPath, [fileURLToPath(new URL('controlled-negative-runner.mjs', automatic))]);

const oldRounds = [
  ['old-repair-831', 'integrated-person05-completion-fix-0f289cf-2026-10-31'],
  ['old-preparation-84', 'integrated-person05-completion-fix-preparation-2026-10-30'],
  ['old-ui-150', 'integrated-person05-completion-ui-b14aeba-2026-10-30'],
  ['old-original-failure-452', 'integrated-person05-completion-runtime-bddae576-2026-10-30']
];
for (const [id, oldRound] of oldRounds)
  await run(id, process.execPath, ['tests/seal-integrated-round.mjs', oldRound, '--verify', '--git']);

const runtimePaths = ['ui/src', 'storage/src', 'ui/probe.html', 'ui/style.css'];
const differences = git('diff', '--name-only', previousUi, target, '--', ...runtimePaths).trim().split(/\r?\n/u).filter(Boolean);
assert.deepEqual(differences, [], 'UI/storage runtime bytes unchanged from prior controlled UI target');
const paths = git('ls-files', '--', ...runtimePaths).trim().split(/\r?\n/u).filter(Boolean);
const inputs = [];
for (const path of paths) {
  const bytes = await readFile(new URL(path, repo));
  const currentGit = execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, 'show', `${target}:${path}`]);
  const previousGit = execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, 'show', `${previousUi}:${path}`]);
  assert.deepEqual(bytes, currentGit); assert.deepEqual(currentGit, previousGit);
  inputs.push({path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await save('unchanged-runtime-inputs.json', {target, previousUi, differences, inputCount: inputs.length, inputs,
  scope: 'Only tracked UI/storage runtime paths compared; prior full controlled concurrency suite reused, not rerun.'});
git('diff', '--exit-code', target, '--', ...productPaths);
assert.equal(git('rev-parse', 'HEAD').trim(), target);
const negative = JSON.parse(await readFile(new URL('negative/results.json', automatic), 'utf8'));
assert.equal(negative.scenarioCount, 3); assert.equal(negative.assertions, 12); assert.equal(negative.passed, 3); assert.equal(negative.failed, 0);
const oldSeals = [];
for (const [id, oldRound] of oldRounds) {
  const manifest = JSON.parse(await readFile(new URL(`tests/evidence/${oldRound}/SHA256SUMS.json`, repo), 'utf8'));
  oldSeals.push({id, round: oldRound, files: manifest.length});
}
const passed = commands.every(row => row.exitCode === 0 && row.error === null);
await save('summary.json', {requestId: 'CC-20261030-05 PACKAGE-FINAL', target, passed, startedAt, endedAt: new Date().toISOString(),
  commands, controlledNegative: {scenarios: 3, assertions: 12, passed: 3, providerCalls: 0},
  oldSeals, unchangedUiStorageInputCount: inputs.length,
  standaloneRepairProviderQueries: 0, standaloneRepairCompilerCalls: 0,
  uiSuiteExistingRealCompileDebugIntegrationIncluded: true, uiSuiteCompilerCallCount: null,
  actualBrowserObservations: 0, physicalIpadTested: false,
  scope: 'Contract, existing UI/storage suite (including its real compile/debug integration checks), controlled-consumer/offline-Worker checks and old sealed-byte verification. Separate repair provider/27-call/lifecycle/main suites are not repeated; no package/browser/iPad acceptance.'});
console.log(JSON.stringify({passed, commands: commands.map(({id, exitCode}) => ({id, exitCode})),
  controlledNegative: {scenarios: 3, assertions: 12}, oldSealedFiles: oldSeals.reduce((count, item) => count + item.files, 0),
  unchangedUiStorageInputCount: inputs.length}, null, 2));
if (!passed) process.exitCode = 1;
