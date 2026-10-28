import {spawnSync, execFileSync} from 'node:child_process';
import {readFile, writeFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const out = new URL('./', import.meta.url);
const rootURL = new URL('../../../../', import.meta.url);
const root = fileURLToPath(rootURL);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const summary = text => {
  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
    const match = clean.match(new RegExp(`^(?:#|ℹ)\\s+${key}\\s+(\\d+)\\s*$`, 'm'));
    return [key, match ? Number(match[1]) : null];
  }));
};
const inputPaths = ['app/offline/build.mjs', 'app/main.mjs', 'package.json',
  'ui/src/main.mjs', 'ui/src/editor.mjs', 'debugger/src/variables.mjs', 'debugger/src/wasm-runtime.mjs'];
async function fingerprint() {
  return Promise.all(inputPaths.map(async path => {
    const bytes = await readFile(new URL(path, rootURL));
    return {path, byteLength: bytes.length, sha256: hash(bytes)};
  }));
}
const originalFiles = ['run-checks.mjs', 'combined.stdout.txt', 'combined.stderr.txt',
  'npm-check.stdout.txt', 'npm-check.stderr.txt', 'npm-test.stdout.txt', 'npm-test.stderr.txt'];
const preservedOriginals = await Promise.all(originalFiles.map(async path => {
  const bytes = await readFile(new URL(path, out));
  const info = await stat(new URL(path, out));
  return {path, byteLength: bytes.length, sha256: hash(bytes), modifiedAt: info.mtime.toISOString()};
}));
const combined = summary(await readFile(new URL('combined.stdout.txt', out), 'utf8'));
assert.deepEqual(combined, {tests: 251, pass: 251, fail: 0, cancelled: 0, skipped: 0, todo: 0});
const originalNpmTest = summary(await readFile(new URL('npm-test.stdout.txt', out), 'utf8'));
assert.deepEqual(originalNpmTest, {tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0});
const sourceInputsBeforeMandatory = await fingerprint();
const commands = [];
for (const [name, command, expected] of [
  ['final-npm-check', 'npm.cmd run check', null], ['final-npm-test', 'npm.cmd test', 10],
]) {
  const args = ['/d', '/s', '/c', command], startedAt = new Date().toISOString();
  const result = spawnSync('cmd.exe', args, {cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 10 * 1024 * 1024});
  for (const stream of ['stdout', 'stderr']) await writeFile(new URL(`${name}.${stream}.txt`, out), result[stream] ?? '', {flag: 'wx'});
  const counts = expected === null ? null : summary(result.stdout ?? '');
  commands.push({name, command: ['cmd.exe', ...args], startedAt, finishedAt: new Date().toISOString(),
    exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, counts});
  assert.equal(result.status, 0, `${name} process must succeed`);
  if (expected !== null) assert.deepEqual(counts, {tests: expected, pass: expected, fail: 0, cancelled: 0, skipped: 0, todo: 0});
}
const sourceInputs = await fingerprint();
assert.deepEqual(sourceInputs, sourceInputsBeforeMandatory, 'source bytes must stay unchanged during fresh mandatory checks');
for (const old of preservedOriginals) {
  const bytes = await readFile(new URL(old.path, out));
  assert.equal(hash(bytes), old.sha256, `original ${old.path} preserved`);
}
const result = {
  schemaVersion: 1, finalizedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), node: process.version,
  originalRunner: {path: 'run-checks.mjs', outcome: 'summary-harness-failure', explanation: 'harness-failure.txt'},
  recoveredCombined: {raw: 'combined.stdout.txt', counts: combined,
    childExitCode: 0, childExitCodeEvidence: 'Inferred from original runner control flow reaching and writing both following npm jobs; original metadata was not serialized.',
    rerun: false, distribution: {contracts: 10, compiler: 27, debugger: 83, uiAndStorage: 106, integration: 3, offline: 22}},
  originalNpmTest: {raw: 'npm-test.stdout.txt', counts: originalNpmTest},
  commands, sourceInputs, sourceInputsBeforeMandatory, preservedOriginals,
  sourceFingerprintScope: 'Captured at recovery and around fresh mandatory checks, not retroactive fingerprints of the original combined run. The main agent reports only Chinese delivery wording changed in app/main.mjs after that run.',
  scope: '251 root integrated tests passed in preserved raw TAP. Fresh npm test 10 is already included in that suite and is not added. Prior 121/14 belong to the earlier 3248ad5 phase. Does not replace person 05 independent acceptance or real iPad testing.',
};
await writeFile(new URL('results.json', out), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({revision: result.revision, recoveredCombined: combined, freshMandatory: commands.map(c => ({name: c.name, exitCode: c.exitCode, counts: c.counts})), preservedOriginals: preservedOriginals.length, sourceInputs: sourceInputs.length}));
