import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Acquisition of exact published artifacts, not a compiler-from-source build.
const resourceRoot = fileURLToPath(new URL('../resources/', import.meta.url));
const options = new Set(process.argv.slice(2));
const allowed = new Set(['--verify-only', '--repair', '--json', '--help']);
for (const option of options) {
  if (!allowed.has(option)) throw new Error(`Unknown option: ${option}`);
}
if (options.has('--help')) {
  console.log('node compiler/scripts/prepare-toolchain.mjs [--verify-only] [--repair] [--json]');
  console.log('Default: download missing pinned assets; refuse changed files. --repair: redownload changed assets.');
  console.log('--verify-only: local byte length and SHA-256 checks; no network or writes.');
  process.exit(0);
}
if (options.has('--verify-only') && options.has('--repair')) {
  throw new Error('--verify-only cannot be combined with --repair');
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function validateBytes(bytes, item) {
  if (bytes.byteLength !== item.byteLength) {
    throw new Error(`${item.filename}: expected ${item.byteLength} bytes; got ${bytes.byteLength}`);
  }
  if (digest(bytes) !== item.sha256) throw new Error(`${item.filename}: SHA-256 mismatch`);
}

async function downloadOnce(item) {
  const response = await fetch(item.url, { signal: AbortSignal.timeout(180_000), redirect: 'error' });
  if (!response.ok) throw new Error(`${item.filename}: HTTP ${response.status}`);
  if (!response.body) throw new Error(`${item.filename}: empty HTTP body`);
  // Enforce the locked size while streaming, before retaining an unbounded body.
  const parts = [];
  let length = 0;
  for await (const part of response.body) {
    length += part.byteLength;
    if (length > item.byteLength) throw new Error(`${item.filename}: response exceeds locked size`);
    parts.push(part);
  }
  const bytes = Buffer.concat(parts, length);
  validateBytes(bytes, item);
  return bytes;
}

async function download(item) {
  for (let attempt = 1; attempt <= 3; ++attempt) {
    try {
      return await downloadOnce(item);
    } catch (error) {
      // Retry transient fetch/transport timeouts only. Never accept or retry a
      // different size/hash, redirects, or a server's unsuccessful HTTP status.
      if (!['TypeError', 'TimeoutError'].includes(error.name) || attempt === 3) throw error;
      if (!options.has('--json')) console.log(`Retrying ${item.filename} after transport failure (${attempt}/3)`);
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}

async function main() {
  const lock = JSON.parse(await readFile(path.join(resourceRoot, 'toolchain.lock.json'), 'utf8'));
  if (lock.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(lock.upstream?.commit) ||
      lock.vendorDirectory !== 'vendor/wasm-clang' || !Array.isArray(lock.files) || !lock.files.length) {
    throw new Error('Invalid toolchain lock structure');
  }
  const names = new Set();
  const base = `https://raw.githubusercontent.com/binji/wasm-clang/${lock.upstream.commit}/`;
  for (const item of lock.files) {
    if (!/^[A-Za-z0-9_.-]+$/.test(item.filename) || ['.', '..'].includes(item.filename) ||
        names.has(item.filename) || !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isSafeInteger(item.byteLength) || item.byteLength <= 0 ||
        item.url !== base + item.filename) {
      throw new Error(`Invalid locked resource: ${item.filename}`);
    }
    names.add(item.filename);
  }
  const vendorRoot = path.join(resourceRoot, lock.vendorDirectory);
  if (!options.has('--verify-only')) await mkdir(vendorRoot, { recursive: true });
  const results = [];
  for (const item of lock.files) {
    const destination = path.join(vendorRoot, item.filename);
    let state = 'verified';
    let mustDownload = false;
    try {
      validateBytes(await readFile(destination), item);
    } catch (error) {
      if (options.has('--verify-only')) throw error;
      if (error.code !== 'ENOENT' && !options.has('--repair')) {
        throw new Error(`${error.message}. Use --repair to fetch the locked bytes again.`, { cause: error });
      }
      mustDownload = true;
    }
    if (mustDownload) {
      if (!options.has('--json')) console.log(`Downloading ${item.filename} (${item.byteLength} bytes)`);
      const bytes = await download(item);
      const temporary = `${destination}.download-${randomUUID()}`;
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
      // Re-read the installed bytes before reporting success.
      validateBytes(await readFile(destination), item);
      state = 'downloaded-and-verified';
    }
    results.push({ filename: item.filename, byteLength: item.byteLength, sha256: item.sha256, state });
  }
  const report = {
    status: 'verified', toolchainId: lock.toolchainId, upstreamCommit: lock.upstream.commit,
    resourceCount: results.length, totalBytes: results.reduce((sum, item) => sum + item.byteLength, 0),
    sourceRebuildVerified: false, distributionLicenseReviewComplete: false, files: results,
  };
  console.log(options.has('--json') ? JSON.stringify(report, null, 2) :
    `Verified ${report.resourceCount} resources, ${report.totalBytes} bytes. Source rebuild and complete distribution license review remain unverified.`);
}

main().catch(error => {
  console.error(`Toolchain preparation failed: ${error.message}`);
  process.exitCode = 1;
});
