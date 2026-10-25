import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { CompilerAdapter } from '../../compiler/src/compiler-adapter.mjs';
import { createSnapshot, hashBytes } from '../../compiler/src/source.mjs';
import { WorkerDebuggerAdapter } from '../../debugger/src/worker-adapter.mjs';

export const keyOf = value => Object.fromEntries(['sessionId', 'buildId', 'sourceHash', 'compatibilityId'].map(name => [name, value[name]]));
export const pauseKey = event => ({ ...keyOf(event), pauseId: event.pauseId });
export const frameKey = (event, frame) => ({ ...pauseKey(event), frameId: frame.frameId });
export const breakpoint = (line, sourcePath) => ({ breakpointId: randomUUID(), enabled: true, requested: { sourcePath, line, column: 1 } });

export async function bounded(promise, description, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${description} timed out after ${timeoutMs} ms`)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// The map is the host's artifact container. Only CompilerAdapter writes build bytes.
export function createNodeHost(candidate) {
  const artifacts = new Map();
  const compiler = new CompilerAdapter({
    profile: candidate.profile, lock: candidate.lock,
    createWorker: () => new Worker(new URL('../../compiler/src/compiler-worker.mjs', import.meta.url), { execArgv: [] }),
    writeResource: async (path, bytes) => { artifacts.set(path, bytes.slice()); },
  });
  return {
    artifacts,
    async compile({ text, language = 'cpp', standard = language === 'c' ? 'c11' : 'c++17', mode = 'debug' }) {
      const path = language === 'c' ? 'main.c' : 'main.cpp';
      const snapshot = createSnapshot([{ path, role: 'user', text }], path);
      const request = { requestId: randomUUID(), snapshot, compatibilityId: candidate.profile.compatibilityId,
        language, standard, mode, optimization: 'O0' };
      const started = performance.now();
      const result = await compiler.compile(request);
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      assert.equal(result.sourceHash, snapshot.sourceHash);
      assert.equal(result.build.snapshotId, snapshot.snapshotId);
      assert.deepEqual(result.build.profile, candidate.profile);
      const bytes = artifacts.get(result.build.executable.relativePath);
      assert.ok(bytes instanceof Uint8Array, 'CompilerAdapter persisted its real executable');
      assert.equal(hashBytes(bytes), result.build.executable.sha256);
      assert.equal(bytes.length, result.build.executable.byteLength);
      assert.ok(WebAssembly.validate(bytes));
      if (mode === 'debug') assert.ok(result.build.debugInfo.length > 0, 'fresh debug compilation contains debug information');
      return { request, snapshot, result, bytes, compilationMs: Math.round(performance.now() - started) };
    },
    async debug(compiled, overrides = {}) {
      // A fresh adapter per session releases the bounded in-memory resource container.
      const workers = [];
      const adapter = new WorkerDebuggerAdapter({
        profile: candidate.profile, resources: candidate.resources, baseURL: candidate.baseURL,
        createWorker: () => {
          const worker = new Worker(new URL('../../debugger/src/node-worker.mjs', import.meta.url), { execArgv: [] });
          workers.push(worker); return worker;
        }, sliceInstructions: 1000, stopTimeoutMs: 500,
      });
      const events = [], listeners = new Set();
      let hasStarted = false, closed = false;
      const unsubscribe = adapter.subscribe(event => {
        events.push(event);
        for (const listener of [...listeners]) listener(event);
      });
      const request = {
        sessionId: randomUUID(), buildId: compiled.result.build.buildId,
        sourceHash: compiled.snapshot.sourceHash, compatibilityId: candidate.profile.compatibilityId,
        build: compiled.result.build, snapshot: compiled.snapshot, mode: 'debug',
        stdin: { text: '', encoding: 'utf-8', eof: true }, initialBreakpoints: [], stopOnEntry: false,
        limits: { runningTimeMs: 30000, outputBytes: 65536, variablePageSize: 32, memoryBytes: 268435456 },
        ...overrides,
      };
      const command = (kind, payload = {}) => bounded(adapter.command({ commandId: randomUUID(), kind, ...payload }), `${kind} command`);
      const query = (kind, key, extra = {}) => bounded(adapter.query({ requestId: randomUUID(), kind, key, ...extra }), `${kind} query`);
      const waitFor = async (predicate, after = 0) => {
        const existing = events.find(event => event.eventSeq > after && predicate(event));
        if (existing) return existing;
        const ended = events.find(event => event.eventSeq > after &&
          (event.kind === 'terminated' || event.kind === 'error' && event.fatal));
        if (ended) throw new Error(`Session ended before expected event: ${JSON.stringify(ended)}`);
        let listener;
        try {
          return await bounded(new Promise((resolve, reject) => {
            listener = event => {
              if (event.eventSeq <= after) return;
              if (predicate(event)) resolve(event);
              else if (event.kind === 'terminated' || event.kind === 'error' && event.fatal) reject(new Error(`Session ended before expected event: ${JSON.stringify(event)}`));
            };
            listeners.add(listener);
          }), 'real debugger event');
        } finally { listeners.delete(listener); }
      };
      const close = async () => {
        if (closed) return;
        closed = true;
        try {
          if (hasStarted) await command('stop', { key: keyOf(request) }).catch(() => {});
        } finally {
          adapter.dispose(); unsubscribe(); listeners.clear();
          await Promise.allSettled(workers.map(worker => worker.terminate()));
        }
      };
      try {
        await bounded(adapter.registerResource(compiled.result.build.executable.relativePath, compiled.bytes), 'artifact handoff');
        const ack = await command('start', { request });
        assert.equal(ack.accepted, true, JSON.stringify(ack));
        hasStarted = true;
      } catch (error) { await close(); throw error; }
      return {
        adapter, events, request, key: keyOf(request), command, query, waitFor, close,
        async stack(paused) {
          const reply = await query('stack', pauseKey(paused), { start: 0, count: 32 });
          assert.equal(reply.kind, 'stack', JSON.stringify(reply));
          assert.ok(reply.frames.length > 0); return reply.frames;
        },
        async evaluate(paused, frame, expression) {
          const reply = await query('evaluate', frameKey(paused, frame), { expression, allowSideEffects: false });
          assert.equal(reply.kind, 'evaluate', JSON.stringify(reply)); return reply.result;
        },
        async step(kind, paused) {
          const ack = await command(kind, { key: pauseKey(paused) });
          assert.equal(ack.accepted, true, JSON.stringify(ack));
          return waitFor(event => event.kind === 'paused', paused.eventSeq);
        },
        assertEvents() {
          events.forEach((event, index) => {
            assert.equal(event.eventSeq, index + 1, 'event sequence must be contiguous');
            assert.deepEqual(keyOf(event), keyOf(request), 'events retain the compiled build and source identity');
          });
        },
      };
    },
  };
}

export function available(value, expected) {
  assert.equal(value?.availability, 'available', JSON.stringify(value));
  if (expected !== undefined) assert.equal(value.displayValue, expected);
  return value.displayValue;
}

export function buildEvidence(compiled) {
  return { status: compiled.result.status, compilationMs: compiled.compilationMs, snapshot: compiled.snapshot, build: compiled.result.build,
    persistedBytes: compiled.bytes.length, persistedSHA256: hashBytes(compiled.bytes) };
}
