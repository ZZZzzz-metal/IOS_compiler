// CC-20261029-02: measurement-only experiment. No production capability claim.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { ToolFileSystem, ToolProcessExit } from '../../src/wasm-host.mjs';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const resourceRoot = new URL('../../resources/', import.meta.url);
const evidenceRoot = fileURLToPath(new URL('../../evidence/completion-2026-10-29/performance/', import.meta.url));
const names = ['memfs', 'sysroot.tar', 'clang'];
const encoder = new TextEncoder();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ms = started => Number((performance.now() - started).toFixed(3));
const memoryNote = 'Stage-end visible Wasm linear memory byte lengths only; not peak memory, process RSS, committed physical memory, browser memory, or an iPad measurement.';

const cases = [
  {
    id: 'small-member',
    markedSource: 'struct Item { int count; double weight; void reset(); };\nint main() { Item item; item./*CURSOR*/ }\n',
    expectedLabels: ['count', 'weight', 'reset'],
  },
  {
    id: 'vector-member',
    markedSource: '#include <vector>\n#include <string>\nint main() { std::vector<std::string> values; values./*CURSOR*/ }\n',
    expectedLabels: ['push_back', 'size', 'clear'],
  },
  {
    id: 'string-member',
    markedSource: '#include <vector>\n#include <string>\nint main() { std::string text; text./*CURSOR*/ }\n',
    expectedLabels: ['append', 'size', 'substr'],
  },
].map(item => {
  const offset = item.markedSource.indexOf('/*CURSOR*/');
  const prefix = item.markedSource.slice(0, offset);
  const linePrefix = prefix.slice(prefix.lastIndexOf('\n') + 1);
  return {
    ...item, source: item.markedSource.replace('/*CURSOR*/', ''),
    line: prefix.split('\n').length, utf8Column: encoder.encode(linePrefix).length + 1,
  };
});

function argumentsFor(item) {
  return ['clang', '-cc1', '-fsyntax-only', '-triple', 'wasm32-unknown-wasi',
    '-isysroot', '/', '-internal-isystem', '/include/c++/v1',
    '-internal-isystem', '/lib/clang/8.0.1/include', '-internal-isystem', '/include',
    '-I', '/project', '-std=c++17', '-x', 'c++', '-ferror-limit', '20', '-fmessage-length', '0',
    `-code-completion-at=/project/main.cpp:${item.line}:${item.utf8Column}`, '/project/main.cpp'];
}

async function loadMinimal() {
  const started = performance.now();
  let phaseStart = performance.now();
  const lockBytes = await readFile(new URL('toolchain.lock.json', resourceRoot));
  const lock = JSON.parse(lockBytes);
  const lockReadMs = ms(phaseStart);
  const bytes = {};
  const resources = [];
  const resourceReadAudit = [];
  for (const name of names) {
    const entry = lock.files.find(file => file.filename === name);
    assert.ok(entry, `Missing resource entry: ${name}`);
    phaseStart = performance.now();
    resourceReadAudit.push(`${lock.vendorDirectory}/${name}`);
    const buffer = await readFile(new URL(`${lock.vendorDirectory}/${name}`, resourceRoot));
    const readMs = ms(phaseStart);
    phaseStart = performance.now();
    const sha256 = hash(buffer);
    assert.equal(buffer.byteLength, entry.byteLength, `${name} size`);
    assert.equal(sha256, entry.sha256, `${name} SHA-256`);
    resources.push({ filename: name, byteLength: buffer.byteLength, sha256, readMs, verifyMs: ms(phaseStart) });
    bytes[name] = buffer;
  }
  const modules = {};
  const moduleCompileMs = {};
  for (const name of ['memfs', 'clang']) {
    phaseStart = performance.now();
    modules[name] = await WebAssembly.compile(bytes[name]);
    moduleCompileMs[name] = ms(phaseStart);
  }
  assert.deepEqual(resourceReadAudit, names.map(name => `${lock.vendorDirectory}/${name}`));
  return {
    modules, sysroot: bytes['sysroot.tar'],
    evidence: {
      toolchainId: lock.toolchainId, upstreamCommit: lock.upstream.commit,
      lock: { byteLength: lockBytes.byteLength, sha256: hash(lockBytes) },
      resourceReadAudit, loadedLld: false, resources,
      minimalResourceBytes: resources.reduce((n, item) => n + item.byteLength, 0),
      avoidedLldBytesFromLockOnly: lock.files.find(item => item.filename === 'lld').byteLength,
      lockReadMs, resourceReadMs: resources.reduce((n, item) => n + item.readMs, 0),
      resourceVerifyMs: resources.reduce((n, item) => n + item.verifyMs, 0),
      moduleCompileMs, coldLoadTotalMs: ms(started),
      clangExports: WebAssembly.Module.exports(modules.clang),
      clangImports: WebAssembly.Module.imports(modules.clang),
      retainedPayloadNote: 'Retain two compiled WebAssembly.Module objects and the verified sysroot bytes; compiler/module engine memory size is not exposed here.',
    },
  };
}

async function runFresh(toolchain, item, requestId, retain = false) {
  const started = performance.now();
  let phaseStart = performance.now();
  const fs = await ToolFileSystem.create(toolchain.modules.memfs);
  const freshFsCreateMs = ms(phaseStart);
  const fsAfterCreate = fs.exports.memory.buffer.byteLength;
  phaseStart = performance.now();
  fs.loadTar(toolchain.sysroot);
  const loadSysrootMs = ms(phaseStart);
  const fsAfterSysroot = fs.exports.memory.buffer.byteLength;
  phaseStart = performance.now();
  fs.put('project/main.cpp', encoder.encode(item.source));
  const sourcePutMs = ms(phaseStart);
  const fsBeforeExecution = fs.exports.memory.buffer.byteLength;
  const args = argumentsFor(item);
  let clangInstance;
  let clangInstantiateMs;
  let compilerBeforeExecution;
  let instantiateCount = 0;
  // Instrument only this isolated measurement process. ToolFileSystem.run itself
  // is unchanged and still creates its normal fresh Clang Instance.
  const nativeInstantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async function(module, imports) {
    const instantStart = performance.now();
    const instance = await nativeInstantiate(module, imports);
    if (module === toolchain.modules.clang) {
      instantiateCount++;
      clangInstantiateMs = ms(instantStart);
      clangInstance = instance;
      compilerBeforeExecution = instance.exports.memory.buffer.byteLength;
    }
    return instance;
  };
  phaseStart = performance.now();
  let result;
  try { result = await fs.run(toolchain.modules.clang, args); }
  finally { WebAssembly.instantiate = nativeInstantiate; }
  const clangRunIncludingInstantiationMs = ms(phaseStart);
  const totalRequestMs = ms(started);
  assert.equal(instantiateCount, 1);
  const completionLines = result.stdout.split('\n').filter(line => line.startsWith('COMPLETION:'));
  const labels = completionLines.map(line => line.slice('COMPLETION: '.length).split(' : ')[0]);
  const expectedLabelsFound = Object.fromEntries(item.expectedLabels.map(label => [label, labels.includes(label)]));
  const evidence = {
    requestId, caseId: item.id, sourceSha256: hash(encoder.encode(item.source)),
    arguments: args, cursor: { path: '/project/main.cpp', line: item.line, utf8Column: item.utf8Column },
    exitCode: result.exitCode, completionCount: completionLines.length, expectedLabelsFound,
    stdout: result.stdout, stderr: result.stderr,
    stdoutSha256: hash(encoder.encode(result.stdout)), stderrSha256: hash(encoder.encode(result.stderr)),
    freshFileSystem: true, freshClangInstance: true, reusedCompiledModules: true,
    metrics: {
      freshFsCreateMs, loadSysrootMs, sourcePutMs, clangInstantiateMs,
      clangRunIncludingInstantiationMs,
      clangExecutionAndHostMs: Number((clangRunIncludingInstantiationMs - clangInstantiateMs).toFixed(3)),
      totalRequestMs,
    },
    observedLinearMemoryBytes: {
      filesystemAfterCreate: fsAfterCreate, filesystemAfterSysroot: fsAfterSysroot,
      filesystemBeforeExecution: fsBeforeExecution, compilerBeforeExecution,
      compilerAfterExecution: result.memoryBytes, filesystemAfterExecution: fs.exports.memory.buffer.byteLength,
      sumAfterExecution: result.memoryBytes + fs.exports.memory.buffer.byteLength,
    },
    memoryNote,
  };
  return { evidence, ...(retain ? { fs, clangInstance } : {}) };
}

async function freshWorker() {
  const toolchain = await loadMinimal();
  const runs = [];
  const initial = await runFresh(toolchain, cases[0], 'initial-small-member');
  initial.evidence.initialLoadPlusRequestMs = Number((toolchain.evidence.coldLoadTotalMs + initial.evidence.metrics.totalRequestMs).toFixed(3));
  runs.push(initial.evidence);
  // Three subsequent fresh FS + fresh Clang requests for EACH sample type.
  // Rotate sample types to make large-header costs distinct from cold loading.
  for (let repetition = 1; repetition <= 3; repetition++) {
    for (const item of cases) {
      runs.push((await runFresh(toolchain, item, `warm-${repetition}-${item.id}`)).evidence);
    }
  }
  return { mode: 'fresh-instance', load: toolchain.evidence, runs };
}

async function unsafeReuseWorker() {
  const toolchain = await loadMinimal();
  const first = await runFresh(toolchain, cases[0], 'unsafe-probe-first', true);
  const { fs, clangInstance } = first;
  // A deliberately isolated negative/control experiment. This resets only the
  // JS output collectors, not WASI file descriptors, libc or Clang globals.
  // The same Instance closes over the original argv and memfs imports.
  fs.output = { 1: '', 2: '' };
  fs.outputBytes = 0;
  fs.decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
  const started = performance.now();
  let exitCode = 0;
  let exception = null;
  try { clangInstance.exports._start(); }
  catch (error) {
    if (error instanceof ToolProcessExit) exitCode = error.code;
    else { exitCode = null; exception = { name: error.name, message: error.message }; }
  }
  const executionMs = ms(started);
  fs.output[1] += fs.decoders[1].decode();
  fs.output[2] += fs.decoders[2].decode();
  return {
    mode: 'unsafe-same-instance-control', load: toolchain.evidence,
    first: first.evidence,
    second: {
      exitCode, exception, executionMs, stdout: fs.output[1], stderr: fs.output[2],
      stdoutSha256: hash(encoder.encode(fs.output[1])), stderrSha256: hash(encoder.encode(fs.output[2])),
      stdoutMatchesFirst: fs.output[1] === first.evidence.stdout,
      stderrMatchesFirst: fs.output[2] === first.evidence.stderr,
      compilerAfterExecution: clangInstance.exports.memory.buffer.byteLength,
      filesystemAfterExecution: fs.exports.memory.buffer.byteLength,
    },
    sameInstanceReuseSupported: false,
    limitation: 'Repeated _start is not a supported reentrant API. Same-input output parity cannot establish safety; original imports retain argv/FS and no whole-process/global/fd reset has been validated.',
    memoryNote,
  };
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) };
}

async function main() {
  if (process.argv[2] === '--fresh-worker') return console.log(JSON.stringify(await freshWorker()));
  if (process.argv[2] === '--unsafe-reuse-worker') return console.log(JSON.stringify(await unsafeReuseWorker()));
  assert.equal(process.argv.length, 2, 'Run without arguments; worker flags are internal');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(evidenceRoot, `run-${stamp}`);
  await mkdir(destination, { recursive: true });
  const reports = [];
  const children = [];
  for (let trial = 1; trial <= 3; trial++) {
    const started = performance.now();
    const child = await execFileAsync(process.execPath, [fileURLToPath(import.meta.url), '--fresh-worker'],
      { cwd: root, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
    children.push({ trial, childWallMs: ms(started), stderr: child.stderr });
    const report = JSON.parse(child.stdout);
    await writeFile(path.join(destination, `fresh-process-${trial}.json`), JSON.stringify(report, null, 2) + '\n');
    reports.push(report);
    console.log(`Process ${trial}: load ${report.load.coldLoadTotalMs} ms, first request ${report.runs[0].metrics.totalRequestMs} ms`);
  }
  let reuse;
  try {
    const child = await execFileAsync(process.execPath, [fileURLToPath(import.meta.url), '--unsafe-reuse-worker'],
      { cwd: root, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    reuse = JSON.parse(child.stdout);
    reuse.childStderr = child.stderr;
  } catch (error) {
    reuse = { mode: 'unsafe-same-instance-control', sameInstanceReuseSupported: false,
      processFailed: true, killed: Boolean(error.killed), signal: error.signal, code: error.code,
      message: error.message, childStdout: error.stdout, childStderr: error.stderr };
  }
  await writeFile(path.join(destination, 'unsafe-same-instance-control.json'), JSON.stringify(reuse, null, 2) + '\n');
  const allRuns = reports.flatMap(report => report.runs);
  const comparisons = cases.map(item => {
    const selected = allRuns.filter(run => run.caseId === item.id);
    return {
      caseId: item.id, requestCount: selected.length,
      exitCodes: [...new Set(selected.map(run => run.exitCode))],
      distinctStdoutHashes: [...new Set(selected.map(run => run.stdoutSha256))],
      distinctStderrHashes: [...new Set(selected.map(run => run.stderrSha256))],
      expectedLabelsAlwaysFound: selected.every(run => Object.values(run.expectedLabelsFound).every(Boolean)),
      warmRequestMs: distribution(selected.filter(run => run.requestId.startsWith('warm-')).map(run => run.metrics.totalRequestMs)),
      warmClangInstantiationMs: distribution(selected.filter(run => run.requestId.startsWith('warm-')).map(run => run.metrics.clangInstantiateMs)),
      compilerAfterExecutionBytes: [...new Set(selected.map(run => run.observedLinearMemoryBytes.compilerAfterExecution))],
      filesystemAfterExecutionBytes: [...new Set(selected.map(run => run.observedLinearMemoryBytes.filesystemAfterExecution))],
    };
  });
  const scriptBytes = await readFile(fileURLToPath(import.meta.url));
  const hostBytes = await readFile(new URL('../../src/wasm-host.mjs', import.meta.url));
  const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const summary = {
    experiment: 'CC-20261029-02', recordedAtUtc: new Date().toISOString(), baseCommit: commit,
    environment: { node: process.version, v8: process.versions.v8, platform: process.platform,
      arch: process.arch, release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    script: { path: 'compiler/experiments/completion-2026-10-29/measure.mjs', byteLength: scriptBytes.length, sha256: hash(scriptBytes) },
    host: { path: 'compiler/src/wasm-host.mjs', byteLength: hostBytes.length, sha256: hash(hostBytes) },
    sourceCases: cases, trials: reports.length, requests: allRuns.length, childProcesses: children,
    coldLoadMs: distribution(reports.map(report => report.load.coldLoadTotalMs)),
    initialRequestMs: distribution(reports.map(report => report.runs[0].metrics.totalRequestMs)),
    initialLoadPlusRequestMs: distribution(reports.map(report => report.runs[0].initialLoadPlusRequestMs)),
    comparisons, loadedLld: reports.some(report => report.load.loadedLld),
    allExpectedCompletionOutputPresent: comparisons.every(item => item.exitCodes.length === 1 && item.exitCodes[0] === 0 && item.expectedLabelsAlwaysFound),
    allRepeatedOutputsIdentical: comparisons.every(item => item.distinctStdoutHashes.length === 1 && item.distinctStderrHashes.length === 1),
    unsafeSameInstance: reuse.second ?? { processFailed: reuse.processFailed, killed: reuse.killed, code: reuse.code },
    sameInstanceReuseSupported: false,
    methodology: [
      'Three fresh Node processes, sequential; each reads and verifies ONLY memfs/sysroot.tar/clang, then compiles memfs and clang Modules once.',
      'Each process runs one first small-member completion and three subsequent requests per case, always fresh memfs instance/FS and Clang Instance.',
      'No lld bytes, shared.js, network, object generation, link, program run, browser UI or worker message scheduling are part of this experiment.',
      'Fresh process does not imply cold OS file cache. V8 lazy compilation/tiering is included in execution times and can affect warm results.',
      'Module-object reuse is measured; compiler Instance reuse is explicitly unsupported and probed separately with a timeout.',
      memoryNote,
    ],
  };
  await writeFile(path.join(destination, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  for (const item of cases) await writeFile(path.join(destination, `${item.id}.cpp`), item.source);
  console.log(JSON.stringify({ evidenceDirectory: destination, coldLoadMs: summary.coldLoadMs,
    initialLoadPlusRequestMs: summary.initialLoadPlusRequestMs, comparisons,
    allExpectedCompletionOutputPresent: summary.allExpectedCompletionOutputPresent,
    allRepeatedOutputsIdentical: summary.allRepeatedOutputsIdentical,
    unsafeSameInstance: summary.unsafeSameInstance }, null, 2));
  if (!summary.allExpectedCompletionOutputPresent || !summary.allRepeatedOutputsIdentical || summary.loadedLld) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
