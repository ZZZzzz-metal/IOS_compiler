// Fault-injection tests only. All worker results/profiles here are synthetic,
// unrelated to the real compiler smoke evidence or product capability claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSnapshot, hashBytes } from '../src/source.mjs';
import { CompilerProbe } from '../src/compiler-probe.mjs';
import { CompilerAdapter } from '../src/compiler-adapter.mjs';
import { TARGET } from '../src/toolchain-engine.mjs';

const hash = 'sha256:' + 'a'.repeat(64);
const component = { id: 'synthetic-only', version: 'test', buildHash: hash };
const profile = {
  ...TARGET, protocolVersion: '0.1.0-draft.1', compatibilityId: 'synthetic-only',
  compiler: component, linker: component, sysroot: component, standardLibrary: component,
  runtime: component, debugger: component, resourceManifestHash: hash, status: 'candidate', evidence: [],
};
const lock = { toolchainId: 'synthetic-only', files: ['clang', 'lld', 'sysroot.tar'].map(filename => ({ filename, sha256: hash.slice(7) })) };
const input = () => ({
  requestId: crypto.randomUUID(), snapshot: createSnapshot([{ path: 'main.c', role: 'user', text: 'int main(void){return 0;}' }], 'main.c'),
  compatibilityId: profile.compatibilityId, language: 'c', standard: 'c11', mode: 'run', optimization: 'O0',
});
function result(request) {
  const executable = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
  const sha256 = hashBytes(executable), artifactId = `wasm-${sha256.slice(7)}`;
  return { status: 'compiled', requestId: request.requestId, sourceHash: request.snapshot.sourceHash, snapshotId: request.snapshot.snapshotId,
    mode: request.mode, language: { language: request.language, standard: request.standard }, target: TARGET,
    executable, artifactId, executableRef: { id: artifactId, relativePath: `compiler-builds/${artifactId}/main.wasm`, sha256, byteLength: executable.length, mediaType: 'application/wasm', version: lock.toolchainId },
    compilerResourceHash: hash, linkerResourceHash: hash, sysrootResourceHash: hash, toolchainId: lock.toolchainId,
    compilerArguments: [], linkerArguments: [], sourceMappings: [], diagnostics: [],
  };
}
class FixtureWorker extends EventEmitter {
  constructor(handler) { super(); this.handler = handler; }
  postMessage(message) { queueMicrotask(() => this.handler(this, message.request)); }
  terminate() { this.terminated = true; }
}
const factory = mutate => () => new FixtureWorker((worker, request) => {
  const evidence = result(request); mutate?.(evidence);
  worker.emit('message', { kind: 'result', evidence });
});

test('foreign request replies and malformed success identities never reach artifact storage', async () => {
  for (const mutate of [
    e => { e.requestId = 'old-request'; }, e => { e.sourceHash = hash; }, e => { e.snapshotId = 'old-snapshot'; },
    e => { e.mode = 'debug'; }, e => { e.language = { language: 'cpp', standard: 'c++17' }; },
    e => { e.target = { ...TARGET, abi: 'wrong' }; }, e => { e.executableRef.byteLength = 999; },
    e => { e.executableRef.relativePath = '../old.wasm'; }, e => { e.compilerResourceHash = 'wrong'; },
    e => { e.toolchainId = 'other'; }, e => { e.executableRef.version = 'other'; },
  ]) {
    let writes = 0;
    const adapter = new CompilerAdapter({ profile, lock, writeResource: async () => writes++, createWorker: factory(mutate) });
    const outcome = await adapter.compile(input());
    assert.equal(outcome.status, 'failed');
    assert.equal(writes, 0);
    assert.equal('build' in outcome, false);
  }
});

test('a valid empty Wasm with no DWARF cannot become a debug build', async () => {
  let writes = 0;
  const adapter = new CompilerAdapter({ profile, lock, writeResource: async () => writes++, createWorker: factory() });
  const request = input(); request.mode = 'debug';
  assert.equal((await adapter.compile(request)).status, 'failed');
  assert.equal(writes, 0);
});

test('duplicate terminal replies persist once and cancellation wins over late persistence', async () => {
  let release, started, writes = 0;
  const storageStarted = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const adapter = new CompilerAdapter({ profile, lock,
    writeResource: async () => { writes++; started(); await blocked; },
    createWorker: () => new FixtureWorker((worker, request) => {
      const message = { kind: 'result', evidence: result(request) };
      worker.emit('message', message); worker.emit('message', message);
    }),
  });
  const request = input(), pending = adapter.compile(request);
  await storageStarted;
  await adapter.cancel(request.requestId);
  assert.equal((await pending).status, 'cancelled');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1);
});

test('terminated worker late messages cannot overwrite the next request', async () => {
  const workers = [];
  const probe = new CompilerProbe({ createWorker: () => {
    const worker = new FixtureWorker(() => {}); workers.push(worker); return worker;
  }});
  const first = input(), second = input();
  const oldPending = probe.compile(first);
  await probe.cancel(first.requestId);
  assert.equal((await oldPending).status, 'cancelled');
  const newPending = probe.compile(second);
  workers[0].emit('message', { kind: 'result', evidence: result(first) });
  workers[1].emit('message', { kind: 'result', evidence: result(second) });
  assert.equal((await newPending).requestId, second.requestId);
});

test('timeout terminates the worker and permits another compilation', async () => {
  const worker = new FixtureWorker(() => {});
  const probe = new CompilerProbe({ timeoutMs: 5, createWorker: () => worker });
  assert.equal((await probe.compile(input())).reason, 'compiler-timeout');
  assert.equal(worker.terminated, true);
  assert.equal(probe.active, null);
});
