// Fixed backend-stage regression commands; captures each raw stream and exit code.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {spawnSync, execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const name = process.argv[2], commit = process.argv[3];
assert.match(name ?? '', /^integrated-person05-completion-runtime-[a-z0-9.-]+$/); assert.match(commit ?? '', /^[a-f0-9]{40}$/);
assert.equal(execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(), commit);
const folder = new URL(`tests/evidence/${name}/verification/`, repo); await mkdir(folder);
const save = (file, value) => writeFile(new URL(file, folder), typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const commands = [
  ['toolchain', process.execPath, ['compiler/scripts/prepare-toolchain.mjs', '--verify-only']],
  ['check', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run check']],
  ['contracts', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test']],
  ['modules', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:modules']],
  ['pipeline', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:integration']],
  ['ui-storage', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:ui']],
  ['offline', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:offline']],
  ['main-21', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:acceptance']],
  ['regressions-2', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:regressions']],
  ['initializers-6', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run test:initializer']],
  ['oracle-infrastructure', process.execPath, ['--test', 'tests/completion-fixtures-checks.mjs', 'tests/completion-oracle-checks.mjs']],
  ...['integrated-person05-completion-preparation-38ff307-2026-10-29', 'integrated-person05-completion-preparation-38ff307-2026-10-29-run02',
    'integrated-person05-final-v045-40a079b-2026-10-28'].map((prior, index) => [`prior-seal-${index + 1}`, process.execPath, ['tests/seal-integrated-round.mjs', prior, '--verify', '--git']])
];
const results = [];
for (const [id, executable, args] of commands) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable, args, {cwd, env: {...process.env,
    VALIDATION_EVIDENCE_DIR: `tests/evidence/${name}/verification/details/${id}`}, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  const record = {id, executable, args, startedAt, endedAt: new Date().toISOString(), exitCode: result.status, signal: result.signal,
    error: result.error ? String(result.error) : null, evidenceDirectory: `tests/evidence/${name}/verification/details/${id}`};
  await save(`${id}.stdout.txt`, result.stdout ?? ''); await save(`${id}.stderr.txt`, result.stderr ?? ''); await save(`${id}.command.json`, record);
  results.push(record); console.log(`${id}: exit ${result.status}`);
}
await save('summary.json', {commit, results, allCommandsPassed: results.every(result => result.exitCode === 0 && !result.error)});
if (results.some(result => result.exitCode !== 0 || result.error)) process.exitCode = 1;
