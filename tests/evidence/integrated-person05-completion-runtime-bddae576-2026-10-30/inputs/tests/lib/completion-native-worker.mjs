// Evidence-only native path, isolated from the public adapter's Worker.
import {parentPort, workerData} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const target = new URL(workerData.targetRootHref);
const {loadCompletionToolchain, completeWithClang} = await import(new URL('compiler/src/completion-engine.mjs', target));
let toolchain, queue = Promise.resolve();
const reads = [];
parentPort.on('message', message => {
  queue = queue.then(async () => {
    try {
      toolchain ??= await loadCompletionToolchain(message.lock, async path => {
        const bytes = await readFile(new URL(`compiler/resources/${path}`, target));
        reads.push({path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}); return bytes;
      });
      const actual = await completeWithClang(message.request, toolchain);
      parentPort.postMessage({id: message.id, actual, reads});
    } catch (error) { parentPort.postMessage({id: message.id, error: {message: error.message, stack: error.stack}}); }
  });
});
