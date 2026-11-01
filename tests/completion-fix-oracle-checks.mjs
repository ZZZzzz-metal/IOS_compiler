// Synthetic records exercise the acceptance oracle, not a compiler/provider.
import assert from 'node:assert/strict';
import test from 'node:test';
import {requestFromFixture, evaluateCompletion} from './lib/completion-oracle.mjs';
import {evaluateCompletionFix} from './lib/completion-fix-oracle.mjs';

function sample(name = 'nonceRead') {
  const fixture = {id: 'signature-only', language: {language: 'cpp', standard: 'c++17'},
    translationUnit: 'main.cpp', sourcePath: 'main.cpp',
    files: [{path: 'main.cpp', role: 'user', text: 'void probe() { value. }\n'}],
    coordinates: {offsetUtf16: 21}, expect: {trigger: '.', support: 'required', contains: [name], excludes: []},
    signatures: {required: [{name, pattern: `\\b${name}\\s*\\(\\s*\\)\\s+const\\b`}],
      forbidden: [{name, pattern: `\\b${name}\\s*\\(\\s*int\\b`}], closedNames: [name]}};
  fixture.coordinates.offsetUtf16 = fixture.files[0].text.indexOf('.') + 1;
  const request = requestFromFixture(fixture, 'synthetic-only', 1);
  const item = (detail, index = 0) => ({id: `synthetic-${index}`, label: name, insertText: name,
    kind: 'unknown', detail, replaceRange: {startOffset: request.offset, endOffset: request.offset}});
  const result = {requestId: request.requestId, documentVersion: request.documentVersion,
    snapshotId: request.snapshot.snapshotId, sourceHash: request.snapshot.sourceHash,
    sourcePath: request.sourcePath, offset: request.offset, status: 'succeeded', isIncomplete: false,
    diagnostics: [], items: [item(`int ${name}() const`)]};
  return {fixture, request, result, item};
}

test('legal same-name overload is retained; adding illegal overload fails only the strict extension', () => {
  const {fixture, request, result, item} = sample();
  assert.equal(evaluateCompletionFix(fixture, request, result).verdict, 'passed');
  result.items.push(item('int nonceRead(int value)', 1));
  assert.equal(evaluateCompletion(fixture, request, result).verdict, 'passed');
  const before = JSON.stringify(result);
  const actual = evaluateCompletionFix(fixture, request, result);
  assert.equal(actual.verdict, 'failed');
  assert(actual.errors.some(error => error.code === 'ineligible-overload-confirmable'));
  assert.equal(JSON.stringify(result), before, 'Keep raw responses immutable');
});

test('unknown detail cannot evade the closed signature set', () => {
  const {fixture, request, result, item} = sample();
  result.items.push(item('unrecognized native detail', 2));
  assert(evaluateCompletionFix(fixture, request, result).errors.some(error => error.code === 'unrecognized-confirmable-overload'));
});

test('blanket removal and non-success cannot satisfy legitimate required overloads', () => {
  const {fixture, request, result} = sample();
  result.items = [];
  assert.equal(evaluateCompletionFix(fixture, request, result).verdict, 'failed');
  result.status = 'unsupported';
  assert.equal(evaluateCompletionFix(fixture, request, result).verdict, 'failed');
});

test('ordinary allowed overloads may be explicitly listed for mutable objects', () => {
  const {fixture, request, result, item} = sample();
  fixture.signatures.required.push(fixture.signatures.forbidden.pop());
  result.items.push(item('int nonceRead(int value)', 1));
  assert.equal(evaluateCompletionFix(fixture, request, result).verdict, 'passed');
});

test('different generated names and preserved contract identity receive the same strict checks', () => {
  for (const name of ['p05a8e913Read', 'p05b97042Read']) {
    const {fixture, request, result, item} = sample(name);
    assert.equal(evaluateCompletionFix(fixture, request, result).verdict, 'passed');
    result.items.push(item(`int ${name}(int value)`, 1));
    assert.equal(evaluateCompletionFix(fixture, request, result).verdict, 'failed');
    result.items.pop(); result.sourceHash = 'wrong';
    assert(evaluateCompletionFix(fixture, request, result).errors.some(error => error.code === 'identity'));
  }
});
