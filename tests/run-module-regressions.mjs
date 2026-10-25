// Retain the actual exit status and TAP output of the owners' regression suites.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { platform, release } from 'node:os';
const exec = promisify(execFile);
const root = new URL('../', import.meta.url);
const local = fileURLToPath(root), evidenceBase = resolve(local, 'tests/evidence');
const defaultEvidenceDirectory = `tests/evidence/integrated-run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
const evidencePath = resolve(local, process.env.VALIDATION_EVIDENCE_DIR ?? defaultEvidenceDirectory);
if (!evidencePath.startsWith(evidenceBase + sep) || !relative(evidenceBase, evidencePath).split(sep)[0].startsWith('integrated-'))
  throw new Error('VALIDATION_EVIDENCE_DIR must be a tests/evidence/integrated-* directory; historical evidence is read-only.');
const evidence = pathToFileURL(evidencePath + sep);
await mkdir(evidence, { recursive: true });
const modules = [
  { id: '02', folder: process.env.VALIDATION_COMPILER_ROOT ?? local, glob: 'compiler/checks/*.test.mjs' },
  { id: '03', folder: process.env.VALIDATION_DEBUGGER_ROOT ?? local, glob: 'debugger/checks/*.test.mjs' },
];
const results = await Promise.all(modules.map(async item => {
  const start = performance.now(); const startedAt = new Date().toISOString();
  const args = ['--test', '--test-reporter=tap', item.glob];
  let stdout = '', stderr = '', exitCode = 0;
  try { ({ stdout, stderr } = await exec(process.execPath, args, { cwd: item.folder, timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; exitCode = error.code ?? 1; }
  await writeFile(new URL(`module-${item.id}.tap`, evidence), stdout + (stderr ? '\n# STDERR\n' + stderr : ''));
  const summary = stdout.split('\n').filter(line => /^# (tests|pass|fail|skipped|duration_ms) /.test(line));
  return { ...item, args, startedAt, durationMs: performance.now() - start, exitCode, summary };
}));
await writeFile(new URL('module-regressions.json', evidence), JSON.stringify({ recordedAt: new Date().toISOString(),
  environment: { node: process.version, platform: platform(), release: release(), ipadTested: false }, results }, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.some(r => r.exitCode !== 0) ? 1 : 0;
