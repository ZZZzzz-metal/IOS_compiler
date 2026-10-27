// 5号独立自动复测；不修改实现、不准备网络资源、不覆写历史证据。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';
const execute = promisify(execFile);
const directory = new URL('./', import.meta.url);
const root = new URL('../../../../', import.meta.url);
const repo = fileURLToPath(root).replace(/[\\/]$/, '');
const revision = 'fff15bee97ed47cf2485b83c4344a020e9e190f7';
const npmCli = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
await access(npmCli);
await mkdir(directory, { recursive: true });
try { await access(new URL('summary.json', directory)); throw new Error('This evidence directory already contains a completed run'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = { ...process.env, VALIDATION_COMPILER_ROOT: repo, VALIDATION_DEBUGGER_ROOT: repo,
  GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: repo };
const git = async (...args) => (await execute('git', ['-C', repo, ...args], { env, encoding: 'utf8', windowsHide: true })).stdout.trim();
if (await git('rev-parse', 'HEAD') !== revision) throw new Error('Worktree is not the requested integration-v0.3.0 commit');
const initialStatus = await git('status', '--short');
const startedAt = new Date().toISOString();
const commands = [];
async function run(id, args, evidenceSubdirectory) {
  const started = performance.now();
  const commandStartedAt = new Date().toISOString();
  const scopedEnv = { ...env };
  if (evidenceSubdirectory) scopedEnv.VALIDATION_EVIDENCE_DIR = fileURLToPath(new URL(evidenceSubdirectory + '/', directory));
  const actualArgs = ['--prefix', repo, ...args];
  let stdout = '', stderr = '', exitCode = 0, signal = null, errorMessage = null;
  try { ({ stdout, stderr } = await execute(process.execPath, [npmCli, ...actualArgs], { cwd: repo, env: scopedEnv,
    encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 16 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; exitCode = error.code ?? 1; signal = error.signal ?? null; errorMessage = error.message; }
  const output = stdout + (stderr ? '\n# STDERR\n' + stderr : '');
  const outputFile = id + '.txt';
  await writeFile(new URL(outputFile, directory), output);
  const count = output.match(/(?:#|ℹ)\s*tests (\d+)/u)?.[1];
  const pass = output.match(/(?:#|ℹ)\s*pass (\d+)/u)?.[1];
  const fail = output.match(/(?:#|ℹ)\s*fail (\d+)/u)?.[1];
  const result = { id, command: `npm.cmd ${args.join(' ')}`, invokedVia: { executable: process.execPath, npmCli, args: actualArgs },
    startedAt: commandStartedAt, finishedAt: new Date().toISOString(), durationMs: performance.now() - started,
    exitCode, signal, errorMessage, outputFile, outputSHA256: createHash('sha256').update(output).digest('hex'),
    ...(count ? { observedCounts: { tests: Number(count), passed: Number(pass), failed: Number(fail) } } : {}),
    ...(evidenceSubdirectory ? { evidenceDirectory: evidenceSubdirectory } : {}) };
  commands.push(result);
  await writeFile(new URL(id + '-command.json', directory), JSON.stringify(result, null, 2) + '\n');
  console.log(`${id}: exit ${exitCode}${count ? `; ${pass}/${count} passed` : ''}`);
  return result;
}
await run('toolchain-verify', ['run', 'prepare:toolchain', '--', '--verify-only']);
await Promise.all([
  run('modules', ['run', 'test:modules']),
  (async () => {
    await run('check', ['run', 'check']);
    await run('contracts', ['test']);
    await run('integration', ['run', 'test:integration']);
    await run('ui-storage', ['run', 'test:ui']);
  })(),
  (async () => {
    await run('acceptance', ['run', 'test:acceptance'], 'acceptance');
    await run('regressions', ['run', 'test:regressions'], 'regressions');
    await run('initializer', ['run', 'test:initializer'], 'initializer');
  })(),
]);
const readJSON = async path => JSON.parse(await readFile(new URL(path, directory), 'utf8'));
const acceptance = (await readJSON('acceptance/independent.json')).counts;
const initializer = (await readJSON('initializer/initializer-lifetime.json')).counts;
const minimal = await Promise.all(['shadow', 'loop-header'].map(async name => ({ name, status: (await readJSON(`regressions/regression-${name}.json`)).status })));
const observed = Object.fromEntries(commands.filter(command => command.observedCounts).map(command => [command.id, command.observedCounts]));
const minimalCounts = { passed: minimal.filter(item => item.status === 'passed').length, failed: minimal.filter(item => item.status !== 'passed').length };
const allCommandsPassed = commands.every(command => command.exitCode === 0);
const totalPassed = acceptance.passed + initializer.passed + minimalCounts.passed + ['modules', 'contracts', 'integration', 'ui-storage'].reduce((sum, id) => sum + (observed[id]?.passed ?? 0), 0);
const totalFailed = acceptance.failed + initializer.failed + minimalCounts.failed + ['modules', 'contracts', 'integration', 'ui-storage'].reduce((sum, id) => sum + (observed[id]?.failed ?? 0), 0);
const sourceDiff = await git('diff', '--name-only', revision, '--', 'compiler', 'debugger', 'app', 'ui', 'storage', 'contracts', 'package.json', 'package-lock.json', 'fixtures', 'tests/lib', 'tests/run-validation.mjs', 'tests/reproduce.mjs', 'tests/initializer-lifetime.mjs');
const summary = { schemaVersion: 1, owner: '05 independent automation subtask', startedAt, finishedAt: new Date().toISOString(),
  testedTag: 'integration-v0.3.0', testedRevision: revision, endRevision: await git('rev-parse', 'HEAD'),
  environment: { node: process.version, platform: platform(), release: release(), arch: arch(), browserTested: false, ipadTested: false, networkDisabled: false },
  initialStatus, finalStatus: await git('status', '--short'), testedSourceDiffFromTag: sourceDiff, commands,
  counts: { observed, acceptance, minimalRegressions: minimalCounts, initializer, deduplicatedPassed: totalPassed, deduplicatedFailed: totalFailed },
  allCommandsPassed, warning: 'Module counts include fault injection and boundary checks. This is desktop automation, not 160 user workflows or real iPad acceptance.',
  pending: ['Independent browser DOM and real IndexedDB workflow (parent task)', 'Real iPad complete offline cold start', 'Installation, forced app termination, storage eviction and complete resource upgrades'] };
await writeFile(new URL('summary.json', directory), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ allCommandsPassed, totalPassed, totalFailed, testedSourceDiffFromTag: sourceDiff }, null, 2));
process.exitCode = !allCommandsPassed || totalFailed || sourceDiff ? 1 : 0;
