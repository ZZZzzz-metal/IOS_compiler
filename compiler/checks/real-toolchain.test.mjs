import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createSnapshot } from '../src/source.mjs';
import { createNodeProbe } from '../src/node-probe.mjs';
import { CompilerAdapter } from '../src/compiler-adapter.mjs';
import { evidenceJSON, digest, loadToolchain } from '../src/toolchain-engine.mjs';
import { ToolFileSystem } from '../src/wasm-host.mjs';

const root = new URL('../../', import.meta.url);
const artifacts = new URL('artifacts/compiler-02/', root);
await mkdir(artifacts, { recursive: true });
const lock = JSON.parse(await readFile(new URL('../resources/toolchain.lock.json', import.meta.url), 'utf8'));
const sample = async name => readFile(new URL(`../samples/${name}`, import.meta.url), 'utf8');
const request = (text, language = 'cpp', path = 'main.cpp') => ({
  requestId: crypto.randomUUID(), snapshot: createSnapshot([{ path, text, role: 'user' }], path),
  language, standard: language === 'c' ? 'c11' : 'c++17', mode: 'debug', optimization: 'O0',
});
const compile = (input, stdin = '') => createNodeProbe().compile(input, { smokeStdin: stdin });
const observed = [];
async function record(name, input, result) {
  const directory = new URL(`${name}/`, artifacts);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('snapshot.json', directory), JSON.stringify(input.snapshot, null, 2) + '\n');
  await writeFile(new URL('evidence.json', directory), JSON.stringify(evidenceJSON(result), null, 2) + '\n');
  if (result.status === 'compiled') {
    await writeFile(new URL('main.wasm', directory), result.executable);
    await writeFile(new URL('main.o', directory), result.object);
  }
  observed.push({ name, status: result.status, sourceHash: result.sourceHash, artifactId: result.artifactId, metrics: result.metrics, smoke: result.smoke, diagnostics: result.diagnostics });
}

test('pinned Wasm compiler versions and resource bytes are real', async () => {
  const toolchain = await loadToolchain(lock, path => readFile(new URL(`../resources/${path}`, import.meta.url)));
  const fs = await ToolFileSystem.create(toolchain.modules.memfs);
  const compiler = await fs.run(toolchain.modules.clang, ['clang', '--version']);
  const linker = await fs.run(toolchain.modules.lld, ['wasm-ld', '--version']);
  assert.equal(compiler.exitCode, 0);
  assert.match(compiler.stdout, /clang version 8\.0\.1/u);
  assert.match(linker.stdout, /LLD/u);
  await writeFile(new URL('versions.json', artifacts), JSON.stringify({ compiler, linker, toolchainId: lock.toolchainId }, null, 2) + '\n');
});

test('C11 stdin/stdout, recursion, array, pointer and signed 64-bit integer', async () => {
  const input = request(await sample('c-stdio.c'), 'c', 'main.c');
  const result = await compile(input, '1 2 3 4\n');
  assert.equal(result.status, 'compiled', result.rawDiagnostics);
  assert.equal(result.smoke.exitCode, 0);
  assert.equal(result.smoke.stdout, 'sum=10 first=1 int64=9223372036854775806\n');
  assert.equal(result.smoke.stderr, '');
  await record('c-stdio', input, result);
});

test('C++17 real STL, UTF-8 output and 32-bit target integer sizes', async () => {
  const input = request(await sample('stl.cpp'));
  const result = await compile(input, '5 5 1 3 2 4\n');
  assert.equal(result.status, 'compiled', result.rawDiagnostics);
  assert.equal(result.smoke.exitCode, 0);
  assert.equal(result.smoke.stdout,
    'sum=15 min=1 max=5 pointer=5 map=key:2 hash=ok queue=9 heap=10\n' +
    '中文😀 bytes=10 long=80 empty=0/0\n' +
    'i64=9223372036854775806 u64=18446744073709551615 int=4 long=4 pointer=4\n');
  const debugStrings = result.wasm.sections.find(s => s.name === '.debug_str');
  const strings = new TextDecoder().decode(result.executable.subarray(debugStrings.payloadOffset, debugStrings.payloadOffset + debugStrings.byteLength - 12));
  assert.ok(strings.split('\0').includes('/project/main.cpp'));
  assert.ok(!strings.includes('<stdin>'));
  assert.equal(result.wasm.dwarfSections.find(s => s.name === '.debug_info').dwarfVersion, 4);
  assert.ok(result.compilerArguments.includes('-O0'));
  assert.ok(!result.compilerArguments.includes('-O2'));
  assert.equal(await digest(result.executable), result.executableRef.sha256);
  assert.equal('buildId' in result, false);
  await record('stl', input, result);
});

test('debug handoff artifact is executable and retains real DWARF sections', async () => {
  const input = request(await sample('debug-handoff.cpp'));
  const result = await compile(input);
  assert.equal(result.status, 'compiled', result.rawDiagnostics);
  assert.equal(result.smoke.exitCode, 0);
  for (const name of ['.debug_info', '.debug_abbrev', '.debug_line', '.debug_str']) assert.ok(result.wasm.dwarfSections.some(s => s.name === name));
  await record('debug-handoff', input, result);
});

test('real diagnostic byte columns map Chinese/emoji source back to UTF-16', async () => {
  const text = await sample('compile-error.cpp');
  const input = request(text, 'cpp', '中文/main.cpp');
  const result = await compile(input);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'compiler-exit');
  const error = result.diagnostics.find(d => d.message.includes('missing_name'));
  assert.deepEqual(error.range.start, { sourcePath: '中文/main.cpp', line: 2, column: text.split('\n')[1].indexOf('missing_name') + 1 });
  assert.equal('executable' in result, false);
  assert.equal('buildId' in result, false);
  await record('compile-error', input, result);
});

test('link errors and nonstandard bits/stdc++.h do not produce startable artifacts', async () => {
  const linkInput = request('int absent(); int main() { return absent(); }');
  const link = await compile(linkInput);
  assert.equal(link.status, 'failed');
  assert.equal(link.reason, 'linker-exit');
  assert.ok(link.diagnostics.some(d => /undefined symbol/u.test(d.message)));
  const bitsInput = request('#include <bits/stdc++.h>\nint main() { return 0; }');
  const bits = await compile(bitsInput);
  assert.equal(bits.status, 'failed');
  assert.ok(bits.diagnostics.some(d => d.message.includes('bits/stdc++.h')));
  await record('link-error', linkInput, link);
  await record('bits-unsupported', bitsInput, bits);
});

test('warnings survive a successful compilation', async () => {
  const result = await compile(request('#warning probe-warning\nint main() { return 0; }'));
  assert.equal(result.status, 'compiled');
  assert.ok(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes('probe-warning')));
});

test('editable driver and user header are both compiled and hashed', async () => {
  const input = request('unused');
  input.snapshot = createSnapshot([
    { path: 'solution.hpp', role: 'user', text: 'class Solution { public: int solve(int n) { return n * 2; } };\n' },
    { path: 'driver.cpp', role: 'driver', text: '#include "solution.hpp"\n#include <cstdio>\nint main(){ Solution s; printf("%d\\n", s.solve(21)); }\n' },
  ], 'driver.cpp');
  const result = await compile(input);
  assert.equal(result.status, 'compiled', result.rawDiagnostics);
  assert.equal(result.smoke.stdout, '42\n');
});

test('cancel actual compilation without blocking the caller, then compile again', async () => {
  const text = `int values[100000] = {${Array.from({ length: 100000 }, (_, i) => i).join(',')}}; int main(){ return values[0]; }`;
  const input = request(text);
  let ticks = 0;
  const ticker = setInterval(() => ticks++, 5);
  let cancelScheduled = false;
  const probe = createNodeProbe({ onProgress: event => {
    if (event.phase === 'compiling') { cancelScheduled = true; setTimeout(() => probe.cancel(input.requestId), 30); }
  }});
  const cancelled = await probe.compile(input);
  clearInterval(ticker);
  assert.equal(cancelScheduled, true);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(ticks >= 2, 'caller event loop must continue during compilation');
  assert.equal('build' in cancelled, false);
  const next = await probe.compile(request('int main(){ return 0; }'));
  assert.equal(next.status, 'compiled', next.rawDiagnostics);
  await record('cancelled', input, cancelled);
});

test('failure, source edit and recompilation retain distinct snapshot/artifact identity', async () => {
  const probe = createNodeProbe();
  const original = request('int main(){ return 0; }');
  const frozenHash = original.snapshot.sourceHash;
  const pending = probe.compile(original);
  original.snapshot.files[0].text = 'int main(){ return 99; }';
  const before = await pending;
  assert.equal(before.status, 'compiled');
  assert.equal(before.sourceHash, frozenHash);
  const after = await probe.compile(request('int main(){ return 1; }'));
  assert.equal(after.status, 'compiled');
  assert.notEqual(before.sourceHash, after.sourceHash);
  assert.notEqual(before.artifactId, after.artifactId);
  const invalid = request('int main(){ return 0; }');
  invalid.snapshot.files[0].text = 'int main(){return 99;}';
  assert.equal((await probe.compile(invalid)).reason, 'invalid-request');
  assert.throws(() => new CompilerAdapter({ profile: null }), /persistence|profile/u);
});

test.after(async () => {
  await writeFile(new URL('summary.json', artifacts), JSON.stringify({
    date: '2026-10-24', platform: process.platform, node: process.version,
    scope: 'Desktop Node executes real Wasm compiler, linker and smoke programs. No iPad or source debugger tested.',
    toolchainId: lock.toolchainId, observed,
  }, null, 2) + '\n');
});
