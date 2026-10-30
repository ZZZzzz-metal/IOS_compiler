// Independent callability proof: two fresh source files, not additional completion cases.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Worker, isMainThread, parentPort, workerData} from 'node:worker_threads';
import {CompilerProbe} from '../compiler/src/compiler-probe.mjs';
import {createSnapshot} from '../compiler/src/source.mjs';
import {evidenceJSON, loadToolchain} from '../compiler/src/toolchain-engine.mjs';
import {ToolFileSystem} from '../compiler/src/wasm-host.mjs';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

if (!isMainThread) {
  try {
    assert.equal(workerData.kind, 'const-callability-native-recheck');
    const request = workerData.request;
    const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', repo), 'utf8'));
    const toolchain = await loadToolchain(lock, path => readFile(new URL(`compiler/resources/${path}`, repo)));
    const fs = await ToolFileSystem.create(toolchain.modules.memfs);
    fs.loadTar(toolchain.sysroot);
    for (const file of request.snapshot.files) fs.put(`project/${file.path}`, new TextEncoder().encode(file.text));
    const argv = ['clang', '-cc1', '-fsyntax-only', '-triple', 'wasm32-unknown-wasi', '-disable-free', '-isysroot', '/',
      '-internal-isystem', '/include/c++/v1', '-internal-isystem', '/lib/clang/8.0.1/include', '-internal-isystem', '/include',
      '-I', '/project', '-ferror-limit', '20', '-fmessage-length', '0', '-std=c++17', '-x', 'c++', `/project/${request.snapshot.translationUnit}`];
    const started = performance.now();
    const native = await fs.run(toolchain.modules.clang, argv);
    parentPort.postMessage({kind: 'independent-native-recheck', requestId: request.requestId,
      sourceHash: request.snapshot.sourceHash, argv, ...native, elapsedMs: performance.now() - started});
  } catch (error) { parentPort.postMessage({error: {message: error.message, stack: error.stack}}); }
} else {
  const expectedCommit = process.argv[2] ?? 'bddae57653bede9a38a3510006d761e2a9d19a04';
  const evidencePath = process.argv[3] ?? 'tests/evidence/integrated-person05-completion-runtime-bddae576-2026-10-30/callability-run-01/';
  assert.match(expectedCommit, /^[a-f0-9]{40}$/);
  assert.match(evidencePath, /^tests\/evidence\/integrated-[a-z0-9.-]+\/callability-[a-z0-9.-]+\/$/);
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args],
    {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const productPaths = ['app', 'compiler/src', 'compiler/resources/toolchain.lock.json', 'debugger', 'ui', 'storage', 'contracts', 'scripts', 'package.json', 'package-lock.json'];
  assert.equal(git('rev-parse', 'HEAD').trim(), expectedCommit);
  git('diff', '--exit-code', expectedCommit, '--', ...productPaths);
  const evidence = new URL(evidencePath, repo); await mkdir(evidence); // refuse overwrite
  const save = async (file, value) => {
    const target = new URL(file, evidence); await mkdir(new URL('./', target), {recursive: true});
    await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  };
  const sourcePaths = ['compiler/src/compiler-probe.mjs', 'compiler/src/compiler-worker.mjs', 'compiler/src/toolchain-engine.mjs',
    'compiler/src/source.mjs', 'compiler/src/wasm-host.mjs', 'compiler/src/diagnostics.mjs', 'compiler/src/wasm-inspect.mjs',
    'compiler/resources/toolchain.lock.json'];
  const fingerprint = async () => Promise.all(sourcePaths.map(async file => {
    const bytes = await readFile(new URL(file, repo)); return {file, byteLength: bytes.length, sha256: sha(bytes)};
  }));
  const before = await fingerprint(), workers = [], progress = [], records = [], errors = [];
  const definitions = [
    {id: 'const-negative', text: '#include <string>\nint main() {\n    const std::string text;\n    text.append("person05");\n    return 0;\n}\n'},
    {id: 'mutable-positive', text: '#include <string>\n#include <cstdio>\nint main() {\n    std::string text;\n    text.append("person05");\n    puts(text.c_str());\n    return 0;\n}\n'}
  ];
  await save('.gitattributes', '* -text\n');
  await save('script.mjs', await readFile(new URL('tests/completion-const-callability.mjs', repo), 'utf8'));
  await save('target-before.json', {expectedCommit, cwd, sourceFingerprints: before});
  await save('invocation.json', {argv: process.argv, node: process.version, startedAt: new Date().toISOString()});
  let negativeRequest;
  try {
    for (const definition of definitions) {
      const snapshot = createSnapshot([{path: 'main.cpp', role: 'user', text: definition.text}], 'main.cpp');
      const request = {requestId: `person05-callability-${definition.id}-${randomUUID()}`, snapshot, language: 'cpp', standard: 'c++17', mode: 'run', optimization: 'O0'};
      if (definition.id === 'const-negative') negativeRequest = request;
      await save(`${definition.id}/main.cpp`, definition.text); await save(`${definition.id}/snapshot.json`, snapshot); await save(`${definition.id}/request.json`, request);
      const probe = new CompilerProbe({createWorker: () => {
        const worker = new Worker(new URL('compiler/src/compiler-worker.mjs', repo), {execArgv: []}); workers.push(worker); return worker;
      }, onProgress: event => progress.push({caseId: definition.id, event})});
      const started = performance.now(), result = await probe.compile(request, {smokeStdin: ''});
      const record = {id: definition.id, elapsedMs: performance.now() - started, result: evidenceJSON(result)};
      await save(`${definition.id}/result.json`, record);
      await save(`${definition.id}/raw-diagnostics.txt`, result.rawDiagnostics ?? '');
      if (result.smoke) {
        await save(`${definition.id}/smoke.json`, result.smoke); await save(`${definition.id}/stdout.txt`, result.smoke.stdout ?? '');
        await save(`${definition.id}/stderr.txt`, result.smoke.stderr ?? '');
      }
      if (result.executable) {
        await writeFile(new URL(`${definition.id}/main.wasm`, evidence), result.executable, {flag: 'wx'});
        record.executable = {byteLength: result.executable.length, sha256: sha(result.executable)};
      }
      if (result.object) await writeFile(new URL(`${definition.id}/main.o`, evidence), result.object, {flag: 'wx'});
      record.passed = definition.id === 'const-negative'
        ? result.status === 'failed' && result.reason === 'compiler-exit' && result.diagnostics.some(item => item.severity === 'error' && /append/u.test(item.message)) && /const/u.test(result.rawDiagnostics ?? '')
        : result.status === 'compiled' && result.smoke?.exitCode === 0 && result.smoke?.stdout === 'person05\n';
      records.push(record);
    }
    const nativeWorker = new Worker(new URL('./completion-const-callability.mjs', import.meta.url),
      {workerData: {kind: 'const-callability-native-recheck', request: negativeRequest}, execArgv: []}); workers.push(nativeWorker);
    const native = await new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => { rejectReply(new Error('Native const recheck timed out')); void nativeWorker.terminate(); }, 30000);
      nativeWorker.once('message', message => {clearTimeout(timer); message.error ? rejectReply(new Error(message.error.message)) : resolveReply(message);});
      nativeWorker.once('error', error => {clearTimeout(timer); rejectReply(error);});
      nativeWorker.once('exit', code => {clearTimeout(timer); if (code !== 0) rejectReply(new Error(`Native const recheck exited ${code}`));});
    });
    await save('const-negative/native-recheck.json', native); await save('const-negative/native-stdout.txt', native.stdout); await save('const-negative/native-stderr.txt', native.stderr);
    records.push({id: 'native-const-recheck', passed: native.exitCode !== 0 && /append/u.test(native.stderr) && /const/u.test(native.stderr),
      sourceHash: native.sourceHash, exitCode: native.exitCode});
  } catch (error) { errors.push({message: error.message, stack: error.stack}); }
  finally {
    const settled = await Promise.allSettled(workers.map(worker => worker.terminate()));
    for (const result of settled) if (result.status === 'rejected') errors.push({phase: 'cleanup', message: String(result.reason)});
  }
  const after = await fingerprint(); let targetUnchanged = JSON.stringify(before) === JSON.stringify(after) && git('rev-parse', 'HEAD').trim() === expectedCommit;
  try { git('diff', '--exit-code', expectedCommit, '--', ...productPaths); } catch { targetUnchanged = false; }
  const passed = errors.length === 0 && targetUnchanged && records.length === 3 && records.every(record => record.passed);
  await save('progress.json', progress); await save('target-after.json', {expectedCommit, sourceFingerprints: after, targetUnchanged});
  await save('summary.json', {requestId: 'CC-20261029-05', expectedCommit, kind: 'independent-callability-contrast', passed, targetUnchanged,
    logicalSourceCases: 2, compileProbeExecutions: 2, separateNativeRechecks: 1, records, errors,
    notes: ['These two complete programs are separate callability evidence, not replacements for the 33 completion fixtures.',
      'Their sourceHash differs from the original incomplete const-string completion snapshot by design; the original 60 responses remain unchanged.',
      'CompilerProbe failed results do not expose native exitCode. The separately recorded native recheck does not modify or invent API fields.',
      'No browser, UI, debugger or physical iPad acceptance is claimed.']});
  console.log(JSON.stringify({expectedCommit, evidencePath, passed, targetUnchanged,
    records: records.map(({id, passed, exitCode, executable}) => ({id, passed, exitCode, executable})), errors}, null, 2));
  if (!passed) process.exitCode = 1;
}
