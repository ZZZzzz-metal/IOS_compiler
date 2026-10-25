// Independent acceptance harness. All execution uses freshly compiled real Wasm.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const root = new URL('../../', import.meta.url);
const local = fileURLToPath(root);
export const compilerRoot = pathToFileURL(resolve(process.env.VALIDATION_COMPILER_ROOT ?? join(local, '../ipad-debugger-02')) + '/');
export const debuggerRoot = pathToFileURL(resolve(process.env.VALIDATION_DEBUGGER_ROOT ?? join(local, '../ipad-debugger-03')) + '/');
const load = (base, path) => import(new URL(path, base));
const [{ createSnapshot }, { createNodeProbe }, { evidenceJSON }, { createCandidate }, { DebuggerAdapter }, { WorkerDebuggerAdapter }] = await Promise.all([
  load(compilerRoot, 'compiler/src/source.mjs'), load(compilerRoot, 'compiler/src/node-probe.mjs'),
  load(compilerRoot, 'compiler/src/toolchain-engine.mjs'), load(debuggerRoot, 'debugger/scripts/candidate.mjs'),
  load(debuggerRoot, 'debugger/src/debugger-adapter.mjs'), load(debuggerRoot, 'debugger/src/worker-adapter.mjs'),
]);
export const baseCandidate = await createCandidate();
const artifactRoot = new URL('artifacts/validation-05/', root);
await mkdir(artifactRoot, { recursive: true });
let serial = 0;
export const id = prefix => `validation05-${prefix}-${++serial}`;
export const sessionKey = value => Object.fromEntries(['sessionId', 'buildId', 'sourceHash', 'compatibilityId'].map(k => [k, value[k]]));
export const pauseKey = value => ({ ...sessionKey(value), pauseId: value.pauseId });
export const frameKey = (value, frame) => ({ ...pauseKey(value), frameId: frame.frameId });
export async function bounded(promise, label, ms = 20000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}
export const observations = { compilations: [], sessions: [], queries: [], commands: [], notes: [] };
export function revision(base) {
  try { return execFileSync('git', ['-c', `safe.directory=${fileURLToPath(base).replace(/[\\/]$/, '')}`, '-C', fileURLToPath(base), 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return 'unavailable'; }
}
export async function compile(definition, { text, smoke = true, path, suffix = '' } = {}) {
  text ??= await readFile(new URL(`fixtures/${definition.source}`, root), 'utf8');
  path ??= basename(definition.source);
  const snapshot = createSnapshot([{ path, role: 'user', text }], path);
  const request = { requestId: id('compile'), snapshot, language: definition.language,
    standard: definition.standard, mode: 'debug', optimization: 'O0' };
  const started = performance.now();
  const result = await createNodeProbe().compile(request, smoke ? { smokeStdin: definition.stdin ?? '' } : {});
  const elapsedMs = performance.now() - started;
  const directory = new URL(`${definition.id}${suffix}/`, artifactRoot);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('snapshot.json', directory), JSON.stringify(snapshot, null, 2) + '\n');
  await writeFile(new URL('compile.json', directory), JSON.stringify(evidenceJSON(result), null, 2) + '\n');
  if (result.status === 'compiled') await writeFile(new URL('main.wasm', directory), result.executable);
  observations.compilations.push({ id: definition.id + suffix, source: text, snapshot, elapsedMs, ...evidenceJSON(result), ...(result.smoke ? { smoke: result.smoke } : {}) });
  if (result.status !== 'compiled') return { result, snapshot, request, directory };
  // Development packaging only; this does not register a production compatibility profile.
  const profile = baseCandidate.profile;
  assert.equal(result.compilerResourceHash, profile.compiler.buildHash);
  assert.equal(result.linkerResourceHash, profile.linker.buildHash);
  assert.equal(result.sysrootResourceHash, profile.sysroot.buildHash);
  const executable = { ...result.executableRef, relativePath: `artifacts/validation-05/${definition.id}${suffix}/main.wasm` };
  const build = { buildId: id('build'), requestId: result.requestId, sourceHash: snapshot.sourceHash,
    snapshotId: snapshot.snapshotId, profile, mode: 'debug', language: result.language,
    compilerArguments: result.compilerArguments, linkerArguments: result.linkerArguments,
    executable, debugInfo: [executable], sourceMappings: [] };
  return { result, snapshot, request, build, profile, directory };
}
export class Harness {
  constructor({ worker = false, ...options } = {}) {
    this.worker = worker;
    this.events = []; this.waiters = new Set(); this.current = null; this.workers = [];
    const config = { profile: baseCandidate.profile, resources: baseCandidate.resources,
      sliceInstructions: 10000, ...options };
    this.resources = new Map();
    if (worker) {
      this.adapter = new WorkerDebuggerAdapter({ ...config, baseURL: debuggerRoot.href,
        createWorker: () => { const item = new Worker(new URL('debugger/src/node-worker.mjs', debuggerRoot), { execArgv: [] }); this.workers.push(item); return item; } });
    } else {
      this.adapter = new DebuggerAdapter({ ...config, readResource: path => this.resources.has(path)
        ? Promise.resolve(this.resources.get(path)) : baseCandidate.readResource(path) });
    }
    this.adapter.subscribe(event => {
      this.events.push(structuredClone(event));
      for (const waiter of [...this.waiters]) if (waiter.predicate(event)) { this.waiters.delete(waiter); waiter.resolve(event); }
    });
    observations.sessions.push({ worker, events: this.events });
  }
  async command(kind, payload = {}) {
    const command = { commandId: id(kind), kind, ...payload };
    const reply = await bounded(this.adapter.command(command), kind);
    observations.commands.push({ command, reply });
    return reply;
  }
  async control(kind, paused) {
    const reply = await this.command(kind, { key: pauseKey(paused) });
    assert.equal(reply.accepted, true, JSON.stringify(reply));
    return reply;
  }
  wait(predicate, after = 0, sessionId = this.current.sessionId) {
    const matches = event => event.sessionId === sessionId && event.eventSeq > after && predicate(event);
    const existing = this.events.find(matches);
    if (existing) return Promise.resolve(existing);
    let waiter;
    return bounded(new Promise(resolve => { waiter = { predicate: matches, resolve }; this.waiters.add(waiter); }), 'debugger event').finally(() => this.waiters.delete(waiter));
  }
  async start(compiled, definition, overrides = {}) {
    const { build, snapshot, result } = compiled;
    assert.ok(build, 'A failed compilation must never start');
    this.resources.set(build.executable.relativePath, result.executable);
    if (this.worker) await this.adapter.registerResource(build.executable.relativePath, result.executable);
    const request = { sessionId: id('session'), buildId: build.buildId, sourceHash: snapshot.sourceHash,
      compatibilityId: build.profile.compatibilityId, build, snapshot, mode: 'debug',
      stdin: { text: definition.stdin ?? '', encoding: 'utf-8', eof: true },
      initialBreakpoints: [], stopOnEntry: false,
      limits: { runningTimeMs: 30000, outputBytes: 65536, variablePageSize: 32, memoryBytes: 268435456 }, ...overrides };
    this.current = sessionKey(request);
    const ack = await this.command('start', { request });
    assert.equal(ack.accepted, true, JSON.stringify(ack));
    return request;
  }
  async query(kind, key, extra = {}) {
    const query = { requestId: id(kind), kind, key, ...extra };
    const reply = await bounded(this.adapter.query(query), kind);
    observations.queries.push({ query, reply });
    return reply;
  }
  async stack(paused) {
    const reply = await this.query('stack', pauseKey(paused), { start: 0, count: 32 });
    assert.equal(reply.kind, 'stack', JSON.stringify(reply));
    return reply.frames;
  }
  async evaluate(paused, expression, frame) {
    frame ??= (await this.stack(paused))[0];
    const reply = await this.query('evaluate', frameKey(paused, frame), { expression, allowSideEffects: false });
    assert.equal(reply.kind, 'evaluate', JSON.stringify(reply));
    return reply.result;
  }
  async locals(paused, frame) {
    frame ??= (await this.stack(paused))[0];
    const key = frameKey(paused, frame);
    const scopes = await this.query('scopes', key);
    assert.equal(scopes.kind, 'scopes');
    const values = [];
    for (const scope of scopes.scopes) {
      const reply = await this.query('variables', key, { variablesReference: scope.variablesReference, start: 0, count: 32 });
      assert.equal(reply.kind, 'variables'); values.push(...reply.variables);
    }
    return { key, values };
  }
  output(stream = 'stdout', sid = this.current.sessionId) {
    return this.events.filter(e => e.sessionId === sid && e.kind === 'output' && e.stream === stream).map(e => e.text).join('');
  }
  ordered(sid = this.current.sessionId) {
    const own = this.events.filter(e => e.sessionId === sid);
    own.forEach((e, i) => assert.equal(e.eventSeq, i + 1));
    for (const e of own) assert.deepEqual(sessionKey(e), sessionKey(own[0]));
  }
  async close() {
    try { if (this.current) await bounded(this.command('stop', { key: this.current }), 'cleanup', 3000); }
    finally { this.adapter.dispose(); this.waiters.clear(); await Promise.all(this.workers.map(w => w.terminate())); }
  }
}
export function breakpoint(compiled, line) {
  return { breakpointId: id('bp'), requested: { sourcePath: compiled.snapshot.translationUnit, line, column: 1 }, enabled: true };
}
export function marker(text, name) {
  const lines = text.split('\n').map((line, i) => line.includes(`@bp:${name}`) ? i + 1 : null).filter(Boolean);
  assert.equal(lines.length, 1, `Unique marker ${name}`);
  return lines[0];
}
export function available(value, expected) {
  assert.equal(value.availability, 'available', JSON.stringify(value));
  if (expected !== undefined) assert.equal(value.displayValue, String(expected));
}
