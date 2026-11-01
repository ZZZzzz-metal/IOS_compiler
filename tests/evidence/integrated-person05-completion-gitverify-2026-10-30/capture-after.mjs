import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {spawnSync, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here = new URL('./', import.meta.url), repo = new URL('../../../', import.meta.url), cwd = fileURLToPath(repo);
const save = (name, value) => writeFile(new URL(name, here), typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
const mainName = 'integrated-person05-completion-runtime-bddae576-2026-10-30';
const commands = [
  ...[mainName, 'integrated-person05-completion-preparation-38ff307-2026-10-29', 'integrated-person05-completion-preparation-38ff307-2026-10-29-run02', 'integrated-person05-final-v045-40a079b-2026-10-28']
    .map((name, index) => [`seal-${index + 1}`, process.execPath, ['tests/seal-integrated-round.mjs', name, '--verify', '--git']]),
  ['check', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd run check']], ['contracts', 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd test']],
  ['syntax', process.execPath, ['--check', 'tests/seal-integrated-round.mjs']]
];
const results = [];
for (const [id, executable, args] of commands) {
  const result = spawnSync(executable, args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  const record = {id, executable, args, exitCode: result.status, error: result.error ? String(result.error) : null};
  await save(`${id}.stdout.txt`, result.stdout ?? ''); await save(`${id}.stderr.txt`, result.stderr ?? ''); await save(`${id}.command.json`, record); results.push(record);
}
await save('seal-after.mjs', await readFile(new URL('tests/seal-integrated-round.mjs', repo)));
await save('report-after.md', await readFile(new URL('docs/validation/completion-backend-person05-bddae576-2026-10-30.md', repo)));
await save('handoff-after.md', await readFile(new URL('docs/handoffs/05.md', repo)));
const manifestPath = `tests/evidence/${mainName}/SHA256SUMS.json`, manifest = await readFile(new URL(manifestPath, repo));
const originalCommit = '5d3734da79e31d6a743a42369c09a50692356693';
const committedManifest = execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, 'show', `${originalCommit}:${manifestPath}`]);
assert.deepEqual(manifest, committedManifest);
await save('summary.json', {kind: 'validation-tool-windows-argv-repair', originalStageCommit: originalCommit,
  originalFailure: 'ENAMETOOLONG while spawning readonly Git hash-object for 452 paths',
  fix: 'Bounded ordered batches for hash-object and rev-parse; all original comparisons preserved',
  originalRuntimeManifestUnchanged: true, originalRuntimeManifestSHA256: createHash('sha256').update(manifest).digest('hex'),
  productFailuresUnchanged: 'const-string plus supplemental unavailable boundary remain failed',
  results, allChecksPassed: results.every(result => result.exitCode === 0 && !result.error)});
await save('README.md', '# Windows只读Git核验器修复证据\n\n首次452路径Git核对触发ENAMETOOLONG；原始错误和旧脚本完整保留。\n修复仅分批、保序读取hash-object/rev-parse，大小/SHA/文件集合/HEAD字节检查保持。\n主452及旧66/67/179文件verify --git均通过，check/test/语法另列。\n主证据与其已提交清单未改，本目录另封存；不是产品修复，不改变const/属性边界失败。\n');
assert(results.every(result => result.exitCode === 0 && !result.error));
console.log('Bounded Git verification passed for 452/66/67/179 files; original runtime evidence unchanged.');
