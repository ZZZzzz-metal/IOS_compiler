import { loadCompletionToolchain, completeWithClang } from './completion-engine.mjs';

const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
let send, readResource, toolchainPromise, lockIdentity;
let queue = Promise.resolve();
function receive(message) {
  // Serialize even malformed direct callers. The public adapter keeps one active
  // request; a cancellation terminates this worker instead of posting a message
  // that synchronous Wasm could not receive until execution has already finished.
  queue = queue.then(async () => {
    const request = message?.request;
    try {
      const identity = JSON.stringify(message.lock);
      if (toolchainPromise && identity !== lockIdentity) throw new Error('Cannot replace a warm completion worker toolchain');
      if (!toolchainPromise) {
        lockIdentity = identity;
        toolchainPromise = loadCompletionToolchain(message.lock, readResource,
          event => send({ kind: 'progress', requestId: request.requestId, event }));
      }
      const toolchain = await toolchainPromise;
      send({ kind: 'progress', requestId: request.requestId, event: { phase: 'completion-started' } });
      const { result, metrics } = await completeWithClang(request, toolchain);
      send({ kind: 'progress', requestId: request.requestId, event: { phase: 'completion-finished', ...metrics } });
      send({ kind: 'result', result });
    } catch (error) { send({ kind: 'error', requestId: request?.requestId, message: error.message }); }
  });
}
if (isNode) {
  const { parentPort } = await import('node:worker_threads');
  const { readFile } = await import('node:fs/promises');
  send = message => parentPort.postMessage(message);
  readResource = path => readFile(new URL(`../resources/${path}`, import.meta.url));
  parentPort.on('message', receive);
} else {
  send = message => self.postMessage(message);
  readResource = async path => {
    const response = await fetch(new URL(`../resources/${path}`, import.meta.url));
    if (!response.ok) throw new Error(`Local completion resource unavailable: ${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
  // Attach before the first fetch/top-level await; no startup request is lost.
  self.onmessage = event => receive(event.data);
}
