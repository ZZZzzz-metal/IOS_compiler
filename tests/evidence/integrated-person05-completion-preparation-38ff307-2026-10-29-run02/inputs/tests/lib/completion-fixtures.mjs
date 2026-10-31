// Independent fixture preparation only; this file never supplies completion items.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const fixtureRoot = new URL('../../fixtures/completion-independent/', import.meta.url);
const digest = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const languages = {cpp17: {language: 'cpp', standard: 'c++17'}, c11: {language: 'c', standard: 'c11'}};

export function assertUtf16Boundary(text, offset) {
  assert(Number.isSafeInteger(offset) && offset >= 0 && offset <= text.length, 'Offset outside source');
  if (offset > 0 && offset < text.length) {
    const before = text.charCodeAt(offset - 1), after = text.charCodeAt(offset);
    assert(!(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff), 'Offset splits surrogate pair');
  }
}

// Independent coordinate oracle, not imported from the provider or editor.
export function offsetToClangPosition(text, offset) {
  assert.doesNotMatch(text, /\r/, 'Coordinate oracle requires normalized LF');
  assert(!text.startsWith('\ufeff'), 'Coordinate oracle requires BOM removal');
  assertUtf16Boundary(text, offset);
  const prefix = text.slice(0, offset), lineStart = prefix.lastIndexOf('\n') + 1;
  return {
    offsetUtf16: offset,
    line: prefix.split('\n').length,
    columnUtf16: offset - lineStart + 1,
    columnUtf8: Buffer.byteLength(prefix.slice(lineStart), 'utf8') + 1
  };
}

function validateProjectPath(path) {
  assert.equal(typeof path, 'string');
  assert.match(path, /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:cpp|c|inc)$/);
}

export async function loadCompletionFixtures() {
  const manifest = JSON.parse(await readFile(new URL('cases.json', fixtureRoot), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.status, 'pending-provider');
  assert.equal(manifest.marker, '/*<cc>*/');
  assert(Array.isArray(manifest.cases) && manifest.cases.length > 0);
  const ids = new Set(), fixtures = [];
  for (const entry of manifest.cases) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
    assert(!ids.has(entry.id), `Duplicate case ${entry.id}`); ids.add(entry.id);
    assert(languages[entry.language], `${entry.id} language`);
    validateProjectPath(entry.sourcePath); validateProjectPath(entry.translationUnit);
    assert(Array.isArray(entry.files) && entry.files.length > 0);
    assert(['.', '->', '::', 'identifier', 'none'].includes(entry.expect?.trigger));
    assert(['required', 'boundary'].includes(entry.expect.support));
    for (const key of ['contains', 'excludes', 'visibleExcludes', 'inaccessibleOrAbsent']) {
      const values = entry.expect[key] ?? [];
      assert(Array.isArray(values) && values.every(v => typeof v === 'string' && v.length > 0), `${entry.id}: ${key}`);
      assert.equal(new Set(values).size, values.length, `${entry.id}: duplicate ${key}`);
    }
    for (const key of ['excludes', 'visibleExcludes', 'inaccessibleOrAbsent']) {
      assert(!(entry.expect[key] ?? []).some(v => entry.expect.contains.includes(v)), `${entry.id}: contradictory expectations`);
    }
    const paths = new Set(), files = []; let coordinates;
    for (const mapping of entry.files) {
      validateProjectPath(mapping.path);
      assert(!paths.has(mapping.path)); paths.add(mapping.path);
      assert.match(mapping.file, /^[a-z0-9-]+\.(?:cpp|c|inc)$/);
      const raw = await readFile(new URL(mapping.file, fixtureRoot), 'utf8');
      assert.doesNotMatch(raw, /\r/); assert(!raw.startsWith('\ufeff'));
      const pieces = raw.split(manifest.marker);
      const target = mapping.path === entry.sourcePath;
      assert.equal(pieces.length, target ? 2 : 1, `${entry.id}/${mapping.path}: marker count`);
      const text = target ? pieces.join('') : raw;
      if (target) coordinates = offsetToClangPosition(text, pieces[0].length);
      files.push({path: mapping.path, role: mapping.path === entry.translationUnit && entry.files.length > 1 ? 'driver' : 'user', text, contentHash: digest(text)});
    }
    assert(paths.has(entry.sourcePath) && paths.has(entry.translationUnit) && coordinates, `${entry.id}: project target`);
    // This fingerprint intentionally has a separate name. The product's snapshot
    // sourceHash must later be generated and checked through its frozen protocol.
    const fixtureHash = digest(JSON.stringify(files.map(({path, text}) => ({path, text})).sort((a, b) => a.path.localeCompare(b.path))));
    fixtures.push({id: entry.id, status: 'pending-provider', language: {...languages[entry.language]},
      translationUnit: entry.translationUnit, sourcePath: entry.sourcePath,
      files, coordinates, fixtureHash, expect: entry.expect, pairId: entry.pairId ?? null,
      baselineId: entry.baselineId ?? null, notes: entry.notes ?? ''});
  }
  for (const fixture of fixtures) {
    if (fixture.baselineId !== null) assert(ids.has(fixture.baselineId) && fixture.baselineId !== fixture.id, `${fixture.id}: baseline`);
  }
  return fixtures;
}

export function completionFixtureInventory(fixtures) {
  return {requestId: 'CC-20261029-05', kind: 'fixture-preparation', featureStatus: 'pending-provider-ui-package',
    cases: fixtures.map(({files, ...fixture}) => ({...fixture,
      files: files.map(({text, ...file}) => ({...file, byteLength: Buffer.byteLength(text, 'utf8')}))}))};
}
