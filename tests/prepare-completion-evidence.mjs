// One-shot preparation evidence. No completion backend or browser is exercised.
import assert from 'node:assert/strict';
import {mkdir, readFile, readdir, writeFile, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadCompletionFixtures, completionFixtureInventory} from './lib/completion-fixtures.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const name = process.argv[2];
assert.match(name ?? '', /^integrated-person05-completion-preparation-[a-z0-9.-]+$/);
const evidence = new URL(`tests/evidence/${name}/`, repo);
await mkdir(evidence); // Refuse to overwrite any existing round.
const save = (file, value) => writeFile(new URL(file, evidence), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
await save('.gitattributes', '* -text\n');
const gitPrefix = ['-c', `safe.directory=${cwd}`, '-C', cwd];
const commands = [];
async function run(id, executable, args) {
  const start = new Date().toISOString();
  const result = spawnSync(executable, args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  await save(`${id}.stdout.txt`, result.stdout ?? '');
  await save(`${id}.stderr.txt`, result.stderr ?? '');
  const record = {id, executable, args, startedAt: start, endedAt: new Date().toISOString(), exitCode: result.status,
    signal: result.signal, error: result.error ? String(result.error) : null};
  commands.push(record); await save(`${id}.command.json`, record);
  return result;
}
const head = await run('baseline', 'git', [...gitPrefix, 'rev-parse', 'HEAD']);
const baselineCommit = head.stdout.trim();
assert.equal(baselineCommit, '38ff3075a4b47c3f72ae2f6552a04e58da07d6c0', 'Use the frozen API preparation baseline');
await run('product-diff', 'git', [...gitPrefix, 'diff', '--exit-code', baselineCommit, '--', 'app', 'compiler', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json']);
for (const [id, script] of [['check', 'run check'], ['contracts', 'test'], ['offline-root', 'run test:offline']]) {
  await run(id, 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${script}`]);
}
await run('fixture-infrastructure', process.execPath, ['--test', 'tests/completion-fixtures-checks.mjs']);
await run('previous-seal', process.execPath, ['tests/seal-integrated-round.mjs', 'integrated-person05-final-v045-40a079b-2026-10-28', '--verify', '--git']);

const fixtures = await loadCompletionFixtures();
await save('fixture-inventory.json', completionFixtureInventory(fixtures));
const inputs = (await readdir(new URL('fixtures/completion-independent/', repo))).map(file => `fixtures/completion-independent/${file}`);
inputs.push('tests/lib/completion-fixtures.mjs', 'tests/completion-fixtures-checks.mjs', 'tests/prepare-completion-evidence.mjs',
  'contracts/completion.d.ts', 'docs/validation/completion-independent-plan-2026-10-29.md');
const inputFingerprints = [];
for (const path of inputs.sort()) {
  const bytes = await readFile(new URL(path, repo));
  const destination = new URL(`inputs/${path}`, evidence);
  await mkdir(new URL('./', destination), {recursive: true});
  await copyFile(new URL(path, repo), destination);
  inputFingerprints.push({file: path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await save('input-fingerprints.json', inputFingerprints);
const checksPassed = commands.every(command => command.exitCode === 0 && !command.error);
await save('summary.json', {
  requestId: 'CC-20261029-05', kind: 'preparation-only', baselineCommit, checksPassed,
  fixtureCases: fixtures.length, sourceFiles: fixtures.reduce((count, f) => count + f.files.length, 0),
  productAcceptance: 'pending-fixed-provider-ui-integrated-package',
  actualProviderRequests: 0, actualBrowserObservations: 0,
  pending: ['real Clang provider and raw responses', 'UI controlled concurrency and actual browser', 'new immutable integrated offline bundle',
    'stopped-server fresh-source completion and existing compile/debug regression', 'physical iPad/Safari, keyboard/touch/IME and draft durability'],
  history: 'Original failures and all old tags/packages/evidence remain unchanged. Previous final 179-file seal checked against Git.',
  commands
});
await save('README.md', `# CC-20261029-05 preparation evidence\n\nFrozen API baseline: ${baselineCommit}.\n${fixtures.length} cases / ${fixtures.reduce((count, f) => count + f.files.length, 0)} source files. All feature cases remain pending.\nThe seven fixture checks verify inputs and coordinate oracles only.\nNo provider responses or browser observations were collected here.\nCommand stdout/stderr/exit codes and full input copies are preserved.\nPrior final seal is verified separately, not counted as new product acceptance.\nUse tests/seal-integrated-round.mjs to seal and verify this new directory.\n`);
console.log(JSON.stringify({name, baselineCommit, checksPassed, fixtureCases: fixtures.length, featureStatus: 'pending'}, null, 2));
if (!checksPassed) process.exitCode = 1;
