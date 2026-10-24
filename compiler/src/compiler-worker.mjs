import { loadToolchain, compileArtifact } from './toolchain-engine.mjs';
import { ToolFileSystem } from './wasm-host.mjs';

const isNode = typeof process !== 'undefined' && Boolean(process.versions?.node);
let send, receive, readResource, readLock;
if (isNode) {
  const { parentPort } = await import('node:worker_threads');
  const { readFile } = await import('node:fs/promises');
  send = message => parentPort.postMessage(message);
  receive = () => new Promise(resolve => parentPort.once('message', resolve));
  readLock = async () => JSON.parse(await readFile(new URL('../resources/toolchain.lock.json', import.meta.url), 'utf8'));
  readResource = path => readFile(new URL(`../resources/${path}`, import.meta.url));
} else {
  send = message => self.postMessage(message);
  // Install the first-message listener synchronously, before any asynchronous lock/resource
  // loading. A module worker can dispatch messages while top-level await is suspended.
  receive = () => new Promise(resolve => { self.onmessage = event => resolve(event.data); });
  readLock = async () => {
    const response = await fetch(new URL('../resources/toolchain.lock.json', import.meta.url));
    if (!response.ok) throw new Error(`Toolchain lock is unavailable (${response.status})`);
    return response.json();
  };
  readResource = async path => {
    const response = await fetch(new URL(`../resources/${path}`, import.meta.url));
    if (!response.ok) throw new Error(`Local toolchain resource unavailable: ${path} (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

const message = await receive();
{
  try {
    const lock = await readLock();
    const progress = event => send({ kind: 'progress', event });
    const toolchain = await loadToolchain(lock, readResource, progress);
    const evidence = await compileArtifact(message.request, toolchain, progress);
    let smoke;
    if (message.smokeStdin !== undefined && evidence.status === 'compiled') {
      // Verification helper only. No breakpoints, stepping or debugger claims.
      const fs = await ToolFileSystem.create(toolchain.modules.memfs);
      smoke = await fs.run(await WebAssembly.compile(evidence.executable), ['main.wasm'], message.smokeStdin);
    }
    send({ kind: 'result', evidence, ...(smoke ? { smoke } : {}) });
  } catch (error) {
    send({ kind: 'error', message: error.message });
  }
}
