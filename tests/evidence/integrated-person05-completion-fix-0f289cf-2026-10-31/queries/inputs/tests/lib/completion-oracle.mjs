// Independent assertions over real responses; never a completion provider.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertUtf16Boundary} from './completion-fixtures.mjs';
const hash = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const kinds = new Set(['variable', 'function', 'field', 'method', 'class', 'struct', 'namespace', 'keyword', 'enum', 'enumMember', 'type', 'unknown']);

export function requestFromFixture(fixture, requestId, documentVersion) {
  assert.notEqual(fixture.expect.trigger, 'none', 'UI-only automatic suppression has no provider trigger');
  const files = fixture.files.map(({path, role, text}) => ({path, role, text})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const canonical = JSON.stringify({version: 1, translationUnit: fixture.translationUnit, files});
  const snapshot = {snapshotId: `${requestId}-snapshot`, sourceHash: hash(canonical), encoding: 'utf-8', newline: 'lf',
    translationUnit: fixture.translationUnit, files: files.map(file => ({...file, contentHash: hash(file.text)}))};
  return {...fixture.language, requestId, documentVersion, snapshot, sourcePath: fixture.sourcePath,
    offset: fixture.coordinates.offsetUtf16, trigger: fixture.expect.trigger};
}

export function evaluateCompletion(fixture, request, result, resources) {
  const errors = [];
  const error = (category, code, detail) => errors.push({category, code, detail});
  const identities = {requestId: request.requestId, documentVersion: request.documentVersion,
    snapshotId: request.snapshot.snapshotId, sourceHash: request.snapshot.sourceHash, sourcePath: request.sourcePath, offset: request.offset};
  if (!result || typeof result !== 'object') return {verdict: 'failed', errors: [{category: 'contract', code: 'missing-result'}]};
  for (const [key, value] of Object.entries(identities)) if (result[key] !== value) error('contract', 'identity', {key, expected: value, actual: result[key]});
  const statuses = ['succeeded', 'failed', 'cancelled', 'unsupported'];
  if (!statuses.includes(result.status)) error('contract', 'invalid-status', result.status);
  if (typeof result.isIncomplete !== 'boolean' || !Array.isArray(result.diagnostics) || !Array.isArray(result.items)) error('contract', 'invalid-result-shape');
  const items = Array.isArray(result.items) ? result.items : [];
  if (items.length > 200) error('contract', 'documented-item-limit', {limit: 200, actual: items.length});
  if (result.status !== 'succeeded' && items.length) error('contract', 'non-success-items');
  if (resources && result.status === 'succeeded' && items.length) {
    for (const [key, value] of Object.entries(resources)) if (result[key] !== value) error('contract', 'resource-identity', {key, expected: value, actual: result[key]});
  }
  const text = request.snapshot.files.find(file => file.path === request.sourcePath).text;
  const prefix = fixture.expect.prefix ?? '';
  assert.equal(text.slice(request.offset - prefix.length, request.offset), prefix, `${fixture.id}: fixture prefix`);
  const expectedRange = {startOffset: request.offset - prefix.length, endOffset: request.offset};
  const ids = new Set();
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== 'object') { error('contract', 'invalid-item', index); continue; }
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) error('contract', 'item-id', index); ids.add(item.id);
    if (!kinds.has(item.kind) || ['label', 'insertText', 'detail'].some(key => typeof item[key] !== 'string') || !item.label || !item.insertText) error('contract', 'item-shape', index);
    if (typeof item.insertText === 'string' && /[\u0000-\u001f\u007f]|<#|\[#|\{#/u.test(item.insertText)) error('contract', 'non-plain-insertion', index);
    const range = item.replaceRange;
    try {
      assert(range); assertUtf16Boundary(text, range.startOffset); assertUtf16Boundary(text, range.endOffset);
      assert(range.startOffset <= range.endOffset); assert.deepEqual(range, expectedRange);
    } catch { error('contract', 'replacement-range', {index, expected: expectedRange, actual: range}); }
  }
  // The omitted declaration counterfactual expressly allows native lookup failure.
  const allowedStatuses = fixture.expect.allowedStatuses ?? ['succeeded'];
  if (!allowedStatuses.includes(result.status)) error('semantic', 'unexpected-status', {expected: allowedStatuses, actual: result.status});
  for (const name of fixture.expect.contains) {
    if (result.status !== 'succeeded' || !items.some(item => item?.insertText === name)) error('semantic', 'missing-required', {name, isIncomplete: result.isIncomplete});
    else if (!items.some(item => item?.insertText === name && item?.label === name)) error('semantic', 'display-name', name);
  }
  for (const name of fixture.expect.excludes ?? []) {
    if (items.some(item => item?.insertText === name || item?.label === name)) error('semantic', 'forbidden-candidate', name);
  }
  for (const [name, pattern] of Object.entries(fixture.expect.signaturePatterns ?? {})) {
    if (!items.some(item => item?.insertText === name && typeof item.detail === 'string' && new RegExp(pattern, 'u').test(item.detail))) error('semantic', 'missing-signature', {name, pattern});
  }
  // Frozen Item has no disabled state: all returned candidates are confirmable.
  for (const name of fixture.expect.inaccessibleOrAbsent ?? []) {
    if (items.some(item => item?.insertText === name || item?.label === name)) error('availability', 'ineligible-confirmable', name);
  }
  const onlyAvailability = errors.length > 0 && errors.every(item => item.category === 'availability');
  return {verdict: errors.length === 0 ? 'passed' : fixture.expect.support === 'boundary' && onlyAvailability ? 'boundary-failed' : 'failed',
    support: fixture.expect.support, itemCount: items.length, isIncomplete: result.isIncomplete, errors};
}

export function evaluateNativePosition(fixture, request, native) {
  const expected = `-code-completion-at=/project/${request.sourcePath}:${fixture.coordinates.line}:${fixture.coordinates.columnUtf8}`;
  const actual = Array.isArray(native?.argv) ? native.argv.filter(arg => typeof arg === 'string' && arg.startsWith('-code-completion-at=')) : [];
  return {expected, actual,
    passed: Array.isArray(native?.argv) && actual.length === 1 && native.argv.includes(expected) &&
      native.argv.at(-1) === `/project/${request.snapshot.translationUnit}`};
}
