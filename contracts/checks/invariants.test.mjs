import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSnapshot, assertBuildIdentity, checkEventContext, matchesPause, invalidatePause, markDesynchronized, verifyStartResources, verifyOfflineBundle, hashResourceManifest, hashBytes, REQUIRED_ROLES, PROTOCOL_VERSION } from '../invariants.mjs';

const source = text => [{ path: 'main.cpp', role: 'user', text }];
const key = { sessionId: 's1', buildId: 'b1', sourceHash: 'sha256:source', compatibilityId: 'candidate-a' };

test('source hashes match fixed cross-language canonical vectors', async () => {
  const { vectors } = JSON.parse(await readFile(new URL('../source-hash-vectors.json', import.meta.url), 'utf8'));
  for (const vector of vectors) {
    const snapshot = createSnapshot(vector.inputFiles, vector.translationUnit);
    assert.equal(snapshot.sourceHash, vector.sourceHash, vector.name);
    const files = snapshot.files.map(({ path, role, text }) => ({ path, role, text }));
    assert.equal(JSON.stringify({ version: 1, translationUnit: vector.translationUnit, files }), vector.canonicalJSON);
    for (const file of snapshot.files) assert.equal(file.contentHash, vector.contentHashes[file.path]);
  }
});

test('source hashing is stable across BOM/CRLF and file order, but includes driver edits', () => {
  const a = createSnapshot(source('\uFEFF// 中文\r\nint main() {}\r\n'), 'main.cpp');
  const b = createSnapshot(source('// 中文\nint main() {}\n'), 'main.cpp');
  assert.equal(a.sourceHash, b.sourceHash);
  assert.notEqual(a.snapshotId, b.snapshotId);
  const files = [...source('int main() {}'), { path: 'driver.inc', role: 'driver', text: '1' }];
  assert.equal(createSnapshot(files, 'main.cpp').sourceHash, createSnapshot([...files].reverse(), 'main.cpp').sourceHash);
  const edited = structuredClone(files); edited[1].text = '2';
  assert.notEqual(createSnapshot(files, 'main.cpp').sourceHash, createSnapshot(edited, 'main.cpp').sourceHash);
});

test('source paths and malformed Unicode cannot create ambiguous snapshots', () => {
  for (const path of ['../main.cpp', '/main.cpp', 'C:/main.cpp', 'x\\main.cpp', 'x//y', 'x/./y']) {
    assert.throws(() => createSnapshot([{ path, role: 'user', text: 'x' }], path));
  }
  assert.throws(() => createSnapshot([...source('a'), ...source('b')], 'main.cpp'));
  assert.throws(() => createSnapshot(source('\uD800'), 'main.cpp'));
  assert.throws(() => createSnapshot([{ path: '\uD800.cpp', role: 'user', text: 'x' }], '\uD800.cpp'));
  assert.throws(() => createSnapshot(source('x'), 'missing.cpp'));
});

test('build identity rejects edited snapshots, changed runtime versions and missing debug info', () => {
  const snapshot = createSnapshot(source('int main() {}'), 'main.cpp');
  const profile = { compatibilityId: 'a', protocolVersion: PROTOCOL_VERSION, runtime: { version: '1' } };
  const build = { buildId: 'b', sourceHash: snapshot.sourceHash, snapshotId: snapshot.snapshotId, profile, mode: 'debug', debugInfo: [{}] };
  assert.equal(assertBuildIdentity(build, snapshot, profile), true);
  assert.equal(assertBuildIdentity(build, snapshot, { ...profile, status: 'verified-ipad', evidence: ['new-device-evidence'] }), true);
  assert.throws(() => assertBuildIdentity(build, createSnapshot(source('int main(){return 2;}'), 'main.cpp')));
  const tampered = structuredClone(snapshot); tampered.files[0].text = 'changed';
  assert.throws(() => assertBuildIdentity(build, tampered, profile), /integrity/);
  assert.throws(() => assertBuildIdentity(build, snapshot, { ...profile, runtime: { version: '2' } }), /Incompatible/);
  assert.throws(() => assertBuildIdentity({ ...build, debugInfo: [] }, snapshot, profile), /missing/);
});

test('late sessions, duplicated events, sequence gaps and terminal events are rejected', () => {
  const current = { ...key, state: 'running', eventSeq: 2, synchronized: true, pendingControl: null };
  assert.deepEqual(checkEventContext(current, { ...key, eventSeq: 3 }), { accepted: true });
  for (const altered of [{ sessionId: 'old' }, { buildId: 'old' }, { sourceHash: 'old' }, { compatibilityId: 'old' }]) {
    assert.equal(checkEventContext(current, { ...key, ...altered, eventSeq: 3 }).reason, 'stale-session');
  }
  assert.equal(checkEventContext(current, { ...key, eventSeq: 2 }).reason, 'old-sequence');
  assert.equal(checkEventContext(current, { ...key, eventSeq: 4 }).reason, 'sequence-gap');
  assert.equal(checkEventContext({ ...current, state: 'terminated' }, { ...key, eventSeq: 3 }).reason, 'terminal-session');
});

test('variables cannot leak across pauses, stack frames or resumed execution', () => {
  const current = { ...key, state: 'paused', pauseId: 'p2', frameId: 'f2', synchronized: true, pendingControl: null };
  const reply = { ...key, pauseId: 'p2', frameId: 'f2' };
  assert.equal(matchesPause(current, reply), true);
  assert.equal(matchesPause(current, { ...reply, pauseId: 'p1' }), false);
  assert.equal(matchesPause(current, { ...reply, frameId: 'f1' }), false);
  assert.equal(matchesPause({ ...current, state: 'running' }, reply), false);
  assert.equal(matchesPause(current, { ...reply, sessionId: 'old' }), false);
  assert.equal(matchesPause(invalidatePause(current, 'continue-command'), reply), false);
  const desynchronized = markDesynchronized(current);
  assert.equal(matchesPause(desynchronized, reply), false);
  assert.equal(checkEventContext(desynchronized, { ...key, eventSeq: 1 }).reason, 'desynchronized');
});

function bundleFixture() {
  const bytes = new TextEncoder().encode('synthetic contract test bytes; not a toolchain');
  const resource = {
    id: 'synthetic', relativePath: 'synthetic.bin', roles: REQUIRED_ROLES,
    sha256: hashBytes(bytes), byteLength: bytes.byteLength, version: 'test',
    mediaType: 'application/octet-stream', sourceURL: 'https://example.invalid/test-only', licenseFile: 'LICENSE.txt',
  };
  const license = { ...resource, id: 'license', relativePath: 'LICENSE.txt', roles: [] };
  const profile = { compatibilityId: 'test', protocolVersion: PROTOCOL_VERSION, resourceManifestHash: hashResourceManifest([resource, license]) };
  const bundle = { schemaVersion: 1, bundleId: 'synthetic', protocolVersion: PROTOCOL_VERSION, compatibilityId: 'test', status: 'active', requiredRoles: REQUIRED_ROLES, resources: [resource, license] };
  return { bundle, profile, bytes, read: async () => bytes };
}

test('complete synthetic bundle validates bytes; this is not an offline product test', async () => {
  const { bundle, profile, read } = bundleFixture();
  assert.deepEqual(await verifyOfflineBundle(bundle, profile, read), { ready: true, reasons: [] });
});

test('empty, partial, corrupted or mismatched bundles never become ready', async () => {
  const { bundle, profile, read } = bundleFixture();
  const variants = [
    { ...bundle, resources: [] }, { ...bundle, status: 'staging' },
    { ...bundle, compatibilityId: 'different' },
    { ...bundle, requiredRoles: [], resources: bundle.resources.map(r => ({ ...r, roles: [] })) },
    { ...bundle, resources: bundle.resources.map(r => ({ ...r, sha256: hashBytes('bad') })) },
    { ...bundle, resources: bundle.resources.map(r => ({ ...r, relativePath: '../escape' })) },
    { ...bundle, resources: [bundle.resources[0]] },
    { ...bundle, resources: [...bundle.resources, bundle.resources[0]] },
  ];
  for (const variant of variants) assert.equal((await verifyOfflineBundle(variant, profile, read)).ready, false);
  assert.equal((await verifyOfflineBundle(bundle, profile, async () => { throw new Error('evicted'); })).ready, false);
});

test('a bundle cannot impersonate a compatible resource set by copying its compatibilityId', async () => {
  const { bundle, profile, read } = bundleFixture();
  const replaced = { ...bundle, resources: bundle.resources.map(resource => ({ ...resource, version: 'different-runtime' })) };
  const result = await verifyOfflineBundle(replaced, profile, read);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.includes('trusted compatibility profile')));
});

test('starting requires matching identities, initial breakpoint configuration and actual artifact bytes', async () => {
  const { profile, bytes, read } = bundleFixture();
  const snapshot = createSnapshot(source('int main() {}'), 'main.cpp');
  const resource = { id: 'program', relativePath: 'program.wasm', byteLength: bytes.byteLength, sha256: hashBytes(bytes), version: 'test', mediaType: 'application/wasm' };
  const build = { buildId: 'b1', snapshotId: snapshot.snapshotId, sourceHash: snapshot.sourceHash, profile, mode: 'debug', executable: resource, debugInfo: [resource] };
  const request = { ...key, compatibilityId: profile.compatibilityId, sourceHash: snapshot.sourceHash, build, snapshot, mode: 'debug', initialBreakpoints: [], stopOnEntry: true, stdin: { text: '', encoding: 'utf-8', eof: true } };
  assert.equal(await verifyStartResources(request, profile, read), true);
  await assert.rejects(verifyStartResources({ ...request, buildId: 'other' }, profile, read), /context/);
  await assert.rejects(verifyStartResources({ ...request, initialBreakpoints: undefined }, profile, read), /configuration/);
  await assert.rejects(verifyStartResources({ ...request, build: { ...build, executable: undefined } }, profile, read), /missing/);
  await assert.rejects(verifyStartResources(request, profile, async () => new Uint8Array()), /checksum/);
});
