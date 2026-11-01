// Synthetic records test the independent oracle; these are not product passes.
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCompletionFixtures} from './lib/completion-fixtures.mjs';
import {requestFromFixture, evaluateCompletion, evaluateNativePosition} from './lib/completion-oracle.mjs';
import {createSnapshot} from '../compiler/src/source.mjs';
const fixtures = await loadCompletionFixtures();
function sample(id = 'type-a') {
  const fixture = fixtures.find(item => item.id === id), request = requestFromFixture(fixture, `oracle-only-${id}`, 1);
  const prefix = fixture.expect.prefix ?? '';
  const item = (name, index = 0) => ({id: `item-${index}-${name}`, label: name, insertText: name, detail: `int ${name}`, kind: 'unknown',
    replaceRange: {startOffset: request.offset - prefix.length, endOffset: request.offset}});
  const result = {requestId: request.requestId, documentVersion: request.documentVersion, snapshotId: request.snapshot.snapshotId,
    sourceHash: request.snapshot.sourceHash, sourcePath: request.sourcePath, offset: request.offset,
    status: 'succeeded', items: fixture.expect.contains.map(item), isIncomplete: false, diagnostics: []};
  return {fixture, request, result, item};
}
test('independent Node SHA snapshot serialization agrees with frozen snapshot protocol', () => {
  for (const fixture of fixtures.filter(item => item.expect.trigger !== 'none')) {
    const request = requestFromFixture(fixture, 'oracle-only-hash', 2);
    assert.deepEqual(request.snapshot, createSnapshot(fixture.files, fixture.translationUnit, {snapshotId: request.snapshot.snapshotId}));
  }
});
test('exact insertion names work; matching a name only in detail never satisfies contains', () => {
  const {fixture, request, result} = sample(); assert.equal(evaluateCompletion(fixture, request, result).verdict, 'passed');
  result.items[0] = {...result.items[0], label: 'unrelated', insertText: 'unrelated', detail: 'scarlet'};
  assert(evaluateCompletion(fixture, request, result).errors.some(error => error.code === 'missing-required' && error.detail.name === 'scarlet'));
  const wrongLabel = sample(); wrongLabel.result.items[0].label = 'displayWrong';
  assert(evaluateCompletion(wrongLabel.fixture, wrongLabel.request, wrongLabel.result).errors.some(error => error.code === 'display-name'));
});
test('const append and private candidates remain boundary failures, including unknown kind', () => {
  for (const [id, illegal] of [['const-string', 'append'], ['const-members', 'mutate'], ['access-control', 'secret']]) {
    const {fixture, request, result, item} = sample(id); result.items.push(item(illegal, 9));
    const observed = evaluateCompletion(fixture, request, result);
    assert.equal(observed.verdict, 'boundary-failed'); assert(observed.errors.some(error => error.code === 'ineligible-confirmable'));
  }
});
test('non-success empty result cannot satisfy required candidates; explicit include omission may fail', () => {
  for (const id of ['type-a', 'const-string', 'include-omitted']) {
    const {fixture, request, result} = sample(id); result.status = 'failed'; result.items = [];
    assert.equal(evaluateCompletion(fixture, request, result).verdict, id === 'include-omitted' ? 'passed' : 'failed');
  }
});
test('truncation does not turn a missing required candidate into a pass', () => {
  const {fixture, request, result} = sample(); result.items = []; result.isIncomplete = true;
  const observed = evaluateCompletion(fixture, request, result);
  assert.equal(observed.verdict, 'failed'); assert(observed.errors.some(error => error.detail?.isIncomplete === true));
});
test('stale identity, resource identity, duplicate IDs and invalid range are rejected', () => {
  const {fixture, request, result} = sample();
  for (const field of ['requestId', 'documentVersion', 'snapshotId', 'sourceHash', 'sourcePath', 'offset']) {
    const bad = structuredClone(result); bad[field] = field === 'offset' ? request.offset + 1 : 'wrong';
    assert(evaluateCompletion(fixture, request, bad).errors.some(error => error.code === 'identity'));
  }
  assert(evaluateCompletion(fixture, request, result, {toolchainId: 'expected'}).errors.some(error => error.code === 'resource-identity'));
  const duplicate = structuredClone(result); duplicate.items[1].id = duplicate.items[0].id;
  assert(evaluateCompletion(fixture, request, duplicate).errors.some(error => error.code === 'item-id'));
  result.items[0].replaceRange.startOffset = -1;
  assert(evaluateCompletion(fixture, request, result).errors.some(error => error.code === 'replacement-range'));
  const excessive = sample(); excessive.result.items = Array.from({length: 201}, (_, index) => excessive.item(`extra${index}`, index));
  assert(evaluateCompletion(excessive.fixture, excessive.request, excessive.result).errors.some(error => error.code === 'documented-item-limit'));
});
test('raw native UTF8 position and translation unit are checked without treating exit1 as failure', () => {
  for (const id of ['nonbmp-prefix', 'included-source']) {
    const {fixture, request} = sample(id);
    const native = {exitCode: 1, argv: [`-code-completion-at=/project/${request.sourcePath}:${fixture.coordinates.line}:${fixture.coordinates.columnUtf8}`, `/project/${request.snapshot.translationUnit}`]};
    assert.equal(evaluateNativePosition(fixture, request, native).passed, true);
    native.argv[0] = native.argv[0] + '0'; assert.equal(evaluateNativePosition(fixture, request, native).passed, false);
    assert.equal(evaluateNativePosition(fixture, request, {argv: 'invalid'}).passed, false);
  }
});
test('UI automatic suppression cases cannot silently be executed as invalid provider triggers', () => {
  for (const id of ['comment', 'string-literal', 'decimal']) {
    assert.throws(() => requestFromFixture(fixtures.find(item => item.id === id), 'oracle-only', 1), /UI-only/);
  }
});
test('required function signatures keep return and parameter types without fixing whitespace', () => {
  const {fixture, request, result} = sample('pattern-function');
  result.items[0].detail = 'int Pattern( int input )'; assert.equal(evaluateCompletion(fixture, request, result).verdict, 'passed');
  result.items[0].detail = 'int Pattern( double input )';
  assert(evaluateCompletion(fixture, request, result).errors.some(error => error.code === 'missing-signature'));
});
