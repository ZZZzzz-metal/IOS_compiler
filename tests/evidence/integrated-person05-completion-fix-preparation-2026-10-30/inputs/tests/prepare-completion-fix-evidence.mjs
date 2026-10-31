// Input/oracle preparation only. Never imports a product provider or runs Wasm.
import assert from 'node:assert/strict';
import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateCompletionFixFixtures} from './lib/completion-fix-fixtures.mjs';
import {requestFromFixture} from './lib/completion-oracle.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const baseline = 'cbc92b26cdb647f3a61379fa84e58f1e039741fc';
const name = process.argv[2];
assert.match(name ?? '', /^integrated-person05-completion-fix-preparation-[a-z0-9.-]+$/);
const gitPrefix = ['-c', `safe.directory=${cwd}`, '-C', cwd];
const git = args => {
  const result = spawnSync('git', [...gitPrefix, ...args], {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
assert.equal(git(['rev-parse', 'HEAD']), baseline, 'Preparation baseline must stay fixed');
const productPaths = ['app', 'compiler', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json'];
const protectedPaths = ['fixtures/completion-independent', 'tests/lib/completion-oracle.mjs',
  'tests/lib/completion-fixtures.mjs', 'tests/completion-availability-independent.mjs',
  'tests/completion-const-callability.mjs', 'tests/run-completion-independent.mjs'];
git(['diff', '--exit-code', baseline, '--', ...productPaths, ...protectedPaths, 'tests/evidence']);
assert.equal(git(['ls-files', '--others', '--exclude-standard', '--', ...productPaths, ...protectedPaths]), '', 'Untracked original/product inputs');
const evidence = new URL(`tests/evidence/${name}/`, repo);
await mkdir(evidence); // New directory only; never overwrite an earlier attempt.
async function save(path, value) {
  const destination = new URL(path, evidence);
  await mkdir(new URL('./', destination), {recursive: true});
  await writeFile(destination, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
await save('.gitattributes', '* -text\n');
const commands = [];
async function run(id, executable, args) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable, args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  const record = {id, executable, args, startedAt, endedAt: new Date().toISOString(), exitCode: result.status,
    signal: result.signal, error: result.error ? String(result.error) : null};
  await save(`${id}.stdout.txt`, result.stdout ?? '');
  await save(`${id}.stderr.txt`, result.stderr ?? '');
  await save(`${id}.command.json`, record); commands.push(record);
}
await run('mandatory-check', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run check']);
await run('mandatory-test', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test']);
await run('input-oracle-infrastructure', process.execPath, ['--test', 'tests/completion-fixtures-checks.mjs',
  'tests/completion-oracle-checks.mjs', 'tests/completion-fix-fixtures-checks.mjs', 'tests/completion-fix-oracle-checks.mjs']);

const nonce = randomBytes(6).toString('hex');
const fixtures = generateCompletionFixFixtures(nonce);
assert.equal(fixtures.length, 11);
const inputPaths = git(['ls-files', '--', ...protectedPaths]).split(/\r?\n/u).filter(Boolean);
inputPaths.push('tests/lib/completion-fix-fixtures.mjs', 'tests/completion-fix-fixtures-checks.mjs',
  'tests/lib/completion-fix-oracle.mjs', 'tests/completion-fix-oracle-checks.mjs', 'tests/prepare-completion-fix-evidence.mjs',
  'docs/validation/completion-fix-plan-person05-2026-10-30.md', 'contracts/completion.d.ts');
const fingerprints = [];
for (const file of [...new Set(inputPaths)].sort()) {
  const bytes = await readFile(new URL(file, repo));
  fingerprints.push({file, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
  await save(`inputs/${file}`, bytes);
}
for (const [index, fixture] of fixtures.entries()) {
  await save(`generated/${fixture.id}/fixture.json`, fixture);
  await save(`generated/${fixture.id}/request.json`, requestFromFixture(fixture, `preparation-only-${fixture.id}`, index + 1));
}
const previousRounds = (await readdir(new URL('tests/evidence/', repo), {withFileTypes: true}))
  .filter(entry => entry.isDirectory() && entry.name !== name && (entry.name.includes('completion-') || entry.name === 'integrated-person05-final-v045-40a079b-2026-10-28'))
  .map(entry => entry.name).sort();
const oldManifests = [];
for (const round of previousRounds) {
  const bytes = await readFile(new URL(`tests/evidence/${round}/SHA256SUMS.json`, repo));
  oldManifests.push({round, manifestByteLength: bytes.length, manifestSHA256: createHash('sha256').update(bytes).digest('hex'),
    entries: JSON.parse(bytes.toString('utf8')).length});
}
git(['diff', '--exit-code', baseline, '--', ...productPaths, ...protectedPaths, ...previousRounds.map(round => `tests/evidence/${round}`)]);
await save('original-input-fingerprints.json', fingerprints);
await save('historical-manifests.json', {kind: 'manifest-fingerprints-and-tracked-diff-only', records: oldManifests,
  note: 'No repeat semantic run or new full Git/blob seal verification is claimed. Prior seal-verification evidence remains unchanged.'});
const passed = commands.every(record => record.exitCode === 0 && record.error === null);
await save('summary.json', {requestId: 'CC-20261030-05', stage: 'DONE-PREP', baseline, passed, nonce,
  generatedCompletionCases: fixtures.length, generatedCallControls: fixtures.reduce((count, fixture) => count + fixture.controls.length, 0),
  actualProviderRequests: 0, actualNativeQueries: 0, actualCompilerProbeCalls: 0, actualBrowserObservations: 0,
  featureVerdict: 'pending-fixed-repair-target', originalInputsAndTrackedHistoryUnchanged: true,
  pending: ['Both original failures must pass original oracle on a fixed repair target', 'Extended randomized queries and real callability controls',
    'Final integrated resources/package identity', 'Physical iPad offline/UI/draft reliability and G2/G3'], commands});
await save('README.md', '# CC-20261030-05 preparation only\n\nNew inputs and strict signature oracle; no real provider, compiler, native query or browser run.\nOriginal 33/extra failure expectations and old exit1 evidence stay unchanged.\nSee summary.json for actual preparation commands and pending repair target.\nThe archived nonce is for preparation only; generate a fresh nonce for real verification.\n');
console.log(JSON.stringify({name, baseline, passed, generatedCompletionCases: fixtures.length,
  generatedCallControls: fixtures.reduce((count, fixture) => count + fixture.controls.length, 0), featureVerdict: 'pending-fixed-repair-target'}, null, 2));
if (!passed) process.exitCode = 1;
