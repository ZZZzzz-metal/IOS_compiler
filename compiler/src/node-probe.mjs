import { Worker } from 'node:worker_threads';
import { CompilerProbe } from './compiler-probe.mjs';
export function createNodeProbe(options = {}) {
  return new CompilerProbe({ ...options, createWorker: () => new Worker(new URL('./compiler-worker.mjs', import.meta.url), { execArgv: [] }) });
}
