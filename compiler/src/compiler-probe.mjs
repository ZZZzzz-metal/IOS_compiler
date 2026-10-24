import { validateCompileInput } from './toolchain-engine.mjs';

const failure = (request, reason, message) => ({
  status: 'failed', requestId: request?.requestId ?? '', sourceHash: request?.snapshot?.sourceHash ?? '',
  diagnostics: [{ severity: 'error', message }], reason,
});

// Compiler-only probe. Successful results use status=compiled and no buildId/profile.
// Pass a Worker factory in Node; browsers use a module Worker by default.
export class CompilerProbe {
  constructor({ createWorker, onProgress = () => {}, timeoutMs = 120000 } = {}) {
    this.createWorker = createWorker ?? (() => new Worker(new URL('./compiler-worker.mjs', import.meta.url), { type: 'module' }));
    this.onProgress = onProgress;
    this.timeoutMs = timeoutMs;
    this.active = null;
  }
  compile(request, { smokeStdin, beforeResolve } = {}) {
    // Freeze ownership at API entry; later editor mutations cannot change this compilation.
    request = structuredClone(request);
    try { validateCompileInput(request); }
    catch (error) { return Promise.resolve(failure(request, 'invalid-request', error.message)); }
    if (this.active) return Promise.resolve(failure(request, 'busy', 'Cancel or await the current compilation first'));
    return new Promise(resolve => {
      const task = { request, resolve, worker: null, done: false };
      this.active = task;
      task.finish = result => {
        if (task.done) return;
        task.done = true;
        clearTimeout(task.timer);
        task.worker?.terminate();
        if (this.active === task) this.active = null;
        resolve(result);
      };
      const fail = error => task.finish(failure(request, 'worker-error', error?.message ?? String(error)));
      const message = async data => {
        if (task.done || this.active !== task) return;
        if (data.kind === 'progress') { try { this.onProgress(data.event); } catch { /* Observers do not own compilation. */ } }
        else if (data.kind === 'error') fail(new Error(data.message));
        else if (data.kind === 'result') {
          if (task.received) return;
          task.received = true;
          try {
            const result = { ...data.evidence, ...(data.smoke ? { smoke: data.smoke } : {}) };
            if (result.requestId !== request.requestId || result.sourceHash !== request.snapshot.sourceHash) throw new Error('Compiler reply does not match the active request');
            if (!['compiled', 'failed', 'cancelled'].includes(result.status)) throw new Error('Invalid compiler result status');
            const finalResult = beforeResolve ? await beforeResolve(result) : result;
            task.finish(finalResult);
          } catch (error) { fail(error); }
        }
      };
      try {
        task.worker = this.createWorker();
        if (typeof task.worker.on === 'function') {
          task.worker.on('message', message);
          task.worker.once('error', fail);
          task.worker.once('exit', code => { if (!task.done) fail(new Error(`Compiler worker exited without a result (${code})`)); });
        } else {
          task.worker.onmessage = event => message(event.data);
          task.worker.onerror = event => fail(new Error(event.message || 'Compiler worker failed'));
          task.worker.onmessageerror = () => fail(new Error('Compiler worker message could not be decoded'));
        }
        task.timer = setTimeout(() => task.finish(failure(request, 'compiler-timeout', 'Compiler time limit exceeded')), this.timeoutMs);
        task.worker.postMessage({ request, ...(smokeStdin !== undefined ? { smokeStdin } : {}) });
      } catch (error) { fail(error); }
    });
  }
  async cancel(requestId) {
    const task = this.active;
    if (!task || task.request.requestId !== requestId) return;
    task.finish({ status: 'cancelled', requestId, sourceHash: task.request.snapshot.sourceHash, diagnostics: [], reason: 'user-cancelled' });
  }
}
