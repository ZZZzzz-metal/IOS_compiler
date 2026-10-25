import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { PROTOCOL_VERSION, verifyOfflineBundle } from '../contracts/invariants.mjs';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const capabilities = await json('contracts/capabilities.json');
assert.equal(capabilities.protocolVersion, PROTOCOL_VERSION);
assert.equal(new Set(capabilities.capabilities.map(item => item.id)).size, capabilities.capabilities.length);
for (const capability of capabilities.capabilities) {
  assert.ok(['planned', 'implemented-unverified', 'verified', 'unsupported'].includes(capability.status));
  assert.ok(capability.id && capability.requirement && capability.scope && capability.owner.length);
  if (capability.status === 'verified') {
    assert.ok(capability.evidence.length, `Missing evidence: ${capability.id}`);
  }
  for (const path of capability.evidence) await access(new URL(path, root));
}
for (const path of ['compiler/README.md', 'debugger/README.md', 'ui/README.md', 'storage/README.md', 'tests/README.md', 'fixtures/README.md', 'docs/validation/README.md', 'contracts/protocol.d.ts', 'docs/architecture/ROUTES.md', 'docs/handoffs/01.md']) {
  await access(new URL(path, root));
}
const profiles = await json('contracts/compatibility-profiles.json');
assert.equal(profiles.protocolVersion, PROTOCOL_VERSION);
const profile = profiles.profiles.find(item => item.compatibilityId === profiles.selectedCompatibilityId);
if (profiles.selectedCompatibilityId !== null) assert.ok(profile, 'Selected profile is missing');
const bundle = await json('contracts/offline-bundle.json');
const offline = await verifyOfflineBundle(bundle, profile, path => readFile(new URL(`artifacts/${path}`, root)));
if (bundle.status === 'active') assert.ok(offline.ready, offline.reasons.join('; '));
console.log(`Baseline structure and ${capabilities.capabilities.length} capability records: PASS`);
console.log(`Offline resource readiness: ${offline.ready ? 'READY (resource checks only)' : 'NOT READY (expected for baseline)'}`);
offline.reasons.forEach(reason => console.log(`  ${reason}`));
console.log('These checks do not verify a compiler, debugger, iPad device, or installable app.');
