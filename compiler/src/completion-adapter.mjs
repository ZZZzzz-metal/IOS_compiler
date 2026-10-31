import { validateCompletionLock } from './completion-engine.mjs';
import { completionResourceIdentity } from './completion-semantics.mjs';
import { validateCompletionRequest, completionContext, completionIdentity, emptyCompletion, isUtf16Boundary } from './completion-source.mjs';

const kinds = new Set(['variable', 'function', 'field', 'method', 'class', 'struct', 'namespace', 'keyword', 'enum', 'enumMember', 'type', 'unknown']);

function validateReply(result, request, lock) {
  for (const [key, value] of Object.entries(completionIdentity(request))) if (result?.[key] !== value) throw new Error(`Completion reply identity mismatch: ${key}`);
  if (!['succeeded', 'failed', 'cancelled', 'unsupported'].includes(result.status) ||
      !Array.isArray(result.items) || result.items.length > 200 || typeof result.isIncomplete !== 'boolean' || !Array.isArray(result.diagnostics)) throw new Error('Malformed completion result');
  if (result.status !== 'succeeded' && result.items.length) throw new Error('Only succeeded completions may carry items');
  const expected = completionResourceIdentity(lock);
  for (const [key, value] of Object.entries(expected)) if ((result.items.length || result[key] !== undefined) && result[key] !== value) throw new Error(`Completion resource mismatch: ${key}`);
  const file = request.snapshot.files.find(file => file.path === request.sourcePath), ids = new Set();
  const range = completionContext(file.text, request.offset).replaceRange;
  for (const item of result.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !kinds.has(item.kind) ||
        ['label', 'detail', 'insertText'].some(key => typeof item[key] !== 'string' || item[key].length > 65536) || !item.label || !item.insertText ||
        /[\u0000-\u001F\u007F]/u.test(item.insertText) || /<#|\[#|\{#/u.test(item.insertText) ||
        ['sortText', 'filterText'].some(key => item[key] !== undefined && typeof item[key] !== 'string')) throw new Error('Malformed completion item');
    ids.add(item.id);
    const supplied = item.replaceRange;
    if (!supplied || !isUtf16Boundary(file.text, supplied.startOffset) || !isUtf16Boundary(file.text, supplied.endOffset) ||
        supplied.startOffset !== range.startOffset || supplied.endOffset !== range.endOffset) throw new Error('Completion replacement range does not match the active token');
  }
}

// Independent from compile/debug workers. A warm worker caches verified Modules;
// every request gets fresh Wasm instances. Cancellation destroys the entire worker.
export class CompletionAdapter {
  constructor({ lock, createWorker, timeoutMs = 15000, onProgress = () => {} } = {}) {
    validateCompletionLock(lock);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid completion timeout');
    this.lock = structuredClone(lock);
    this.createWorker = createWorker ?? (() => new Worker(new URL('./completion-worker.mjs', import.meta.url), { type: 'module' }));
    this.timeoutMs = timeoutMs;
    this.onProgress = onProgress;
    this.active = null;
    this.slot = null;
    this.releaseBarrier = Promise.resolve();
    this.requestIds = new Set();
    this.disposed = false;
  }
  complete(input) {
    let request;
    try {
      request = structuredClone(input);
      const file = validateCompletionRequest(request);
      if (this.disposed) throw new Error('Completion adapter is disposed');
      if (this.requestIds.has(request.requestId)) throw new Error('Completion requestId must be unique in this adapter lifecycle');
      this.requestIds.add(request.requestId);
      const context = completionContext(file.text, request.offset);
      // Suppressed requests also supersede old work so it cannot re-open a popup.
      if (context.suppressed) {
        const previous = this.active;
        const idleSlot = previous ? null : this.slot;
        return (async () => {
          if (previous) await this.stopTask(previous, emptyCompletion(previous.request, 'cancelled', 'superseded'));
          else await this.releaseWorker(idleSlot);
          if (this.releaseError) return emptyCompletion(request, 'failed', 'worker-release-failed', [{ severity: 'error', message: this.releaseError.message }]);
          return emptyCompletion(request, 'succeeded', `suppressed-${context.reason}`);
        })();
      }
    } catch (error) { return Promise.resolve(emptyCompletion(request ?? input, 'failed', 'invalid-request', [{ severity: 'error', message: error.message }])); }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const task = { request, resolve, promise, done: false, settling: false, slot: null };
    const previous = this.active;
    this.active = task;
    task.timer = setTimeout(() => this.stopTask(task, emptyCompletion(request, 'failed', 'completion-timeout')), this.timeoutMs);
    void (async () => {
      if (previous) await this.stopTask(previous, emptyCompletion(previous.request, 'cancelled', 'superseded'));
      await this.releaseBarrier;
      if (task.settling || task.done || this.active !== task) return;
      try {
        if (this.releaseError) throw this.releaseError;
        task.slot = this.slot ?? this.openWorker();
        task.slot.lastRequestId = request.requestId;
        task.slot.worker.postMessage({ request, lock: this.lock });
      } catch (error) { await this.stopTask(task, emptyCompletion(request, 'failed', 'worker-error', [{ severity: 'error', message: error.message }])); }
    })();
    return promise;
  }
  openWorker() {
    const slot = { worker: this.createWorker() };
    this.slot = slot;
    const fail = error => {
      if (this.slot !== slot) return;
      const task = this.active;
      if (task?.slot === slot) void this.stopTask(task, emptyCompletion(task.request, 'failed', 'worker-error', [{ severity: 'error', message: error?.message ?? String(error) }]));
      else void this.releaseWorker(slot);
    };
    const message = data => {
      const task = this.active;
      if (this.slot !== slot || !task || task.slot !== slot || task.done || task.settling) return;
      if (data?.kind === 'progress') {
        if (data.requestId !== task.request.requestId) return;
        try { this.onProgress(data.event); } catch { /* Observers cannot own this task. */ }
      } else if (data?.kind === 'result') {
        // An old duplicate from this warm worker cannot fail or replace its next task.
        if (data.result?.requestId !== task.request.requestId && this.requestIds.has(data.result?.requestId)) return;
        try {
          validateReply(data.result, task.request, this.lock);
          clearTimeout(task.timer);
          task.done = true;
          this.active = null;
          task.resolve(data.result);
        } catch (error) { fail(error); }
      } else if (data?.kind === 'error') {
        if (data.requestId !== task.request.requestId && this.requestIds.has(data.requestId)) return;
        fail(new Error(data.message));
      }
      else fail(new Error('Unexpected completion worker message'));
    };
    if (typeof slot.worker.on === 'function') {
      slot.worker.on('message', message);
      slot.worker.once('error', fail);
      slot.worker.once('exit', code => fail(new Error(`Completion worker exited (${code})`)));
    } else {
      slot.worker.onmessage = event => message(event.data);
      slot.worker.onerror = event => fail(new Error(event.message || 'Completion worker failed'));
      slot.worker.onmessageerror = () => fail(new Error('Completion worker message could not be decoded'));
    }
    return slot;
  }
  releaseWorker(slot) {
    if (!slot) return this.releaseBarrier;
    if (slot.released) return slot.released;
    if (this.slot === slot) this.slot = null;
    const failedRelease = error => { this.releaseError = error instanceof Error ? error : new Error(String(error)); this.disposed = true; };
    let termination;
    try { termination = slot.worker.terminate(); } catch (error) { failedRelease(error); }
    // Node terminate() is asynchronous; browser terminate() releases synchronously.
    // Await both preceding releases and this release before any new Wasm starts.
    this.releaseBarrier = Promise.all([this.releaseBarrier, Promise.resolve(termination).catch(failedRelease)]).then(() => {});
    slot.released = this.releaseBarrier;
    return slot.released;
  }
  async stopTask(task, result) {
    if (task.done || task.settling) return task.promise;
    task.settling = true;
    clearTimeout(task.timer);
    if (this.active === task) this.active = null;
    await this.releaseWorker(task.slot);
    if (this.releaseError) result = emptyCompletion(task.request, 'failed', 'worker-release-failed', [{ severity: 'error', message: this.releaseError.message }]);
    task.done = true;
    task.resolve(result);
    return task.promise;
  }
  async cancel(requestId) {
    const task = this.active;
    if (task?.request.requestId === requestId) await this.stopTask(task, emptyCompletion(task.request, 'cancelled', 'user-cancelled'));
    else if (!task && this.slot?.lastRequestId === requestId) await this.releaseWorker(this.slot);
    // Even an idempotent second call must not resolve ahead of a pending release.
    await this.releaseBarrier;
    if (this.releaseError) throw this.releaseError;
  }
  async dispose() {
    this.disposed = true;
    if (this.active) await this.cancel(this.active.request.requestId);
    await this.releaseWorker(this.slot);
    this.requestIds.clear();
    if (this.releaseError) throw this.releaseError;
  }
}
