// Lossless archive and integrity index for this new research/evidence directory.
// Never visits the immutable 2026-10-29 evidence or any release package.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = new URL('../../evidence/completion-fix-2026-10-30/', import.meta.url);
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function files(dir = root, prefix = '') {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) result.push(...await files(new URL(`${item.name}/`, dir), prefix + item.name + '/'));
    else if (item.isFile()) result.push(prefix + item.name);
    else throw Error('Evidence must not contain links or special files');
  }
  return result.sort();
}
const archived = [];
for (const path of await files()) {
  if (!path.endsWith('.json')) continue;
  const original = await readFile(new URL(path, root));
  if (original.length < 1024 * 1024) continue;
  const compressed = gzipSync(original, { level: 9 });
  assert.deepEqual(gunzipSync(compressed), original);
  await writeFile(new URL(`${path}.gz`, root), compressed, { flag: 'wx' });
  assert.deepEqual(gunzipSync(await readFile(new URL(`${path}.gz`, root))), original);
  archived.push({ path, sha256: hash(original), byteLength: original.length,
    archivePath: `${path}.gz`, archiveSha256: hash(compressed), archiveByteLength: compressed.length, roundtripVerified: true });
  await unlink(new URL(path, root)); // only this newly generated, verified archived file
}
if (archived.length) await writeFile(new URL('large-ast-archives.json', root), JSON.stringify(archived, null, 2) + '\n', { flag: 'wx' });
const index = [];
for (const path of await files()) {
  if (path === 'SHA256SUMS.json') continue;
  const bytes = await readFile(new URL(path, root));
  index.push({ path, byteLength: bytes.length, sha256: hash(bytes) });
}
await writeFile(new URL('SHA256SUMS.json', root), JSON.stringify(index, null, 2) + '\n');
console.log(JSON.stringify({ indexed: index.length, losslessArchives: archived.length }));
