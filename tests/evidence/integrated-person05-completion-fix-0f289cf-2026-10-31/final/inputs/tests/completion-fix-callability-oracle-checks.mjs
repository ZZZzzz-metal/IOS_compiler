// Synthetic diagnostic-chain regressions, never product compilation evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCompletionFixFixtures} from './lib/completion-fix-fixtures.mjs';
import {generateCompletionFixLateFixtures} from './lib/completion-fix-late-fixtures.mjs';
import {callabilitySemanticExpectation, evaluateCallabilityControl} from './lib/completion-fix-callability-oracle.mjs';

const nonce = 'ab38710d9f20', fixtures = [...generateCompletionFixFixtures(nonce), ...generateCompletionFixLateFixtures(nonce)];
const request = {requestId: 'synthetic-only', snapshot: {snapshotId: 'snapshot-synthetic', sourceHash: 'hash-synthetic'}};
function sample(fixtureId, controlId) {
  const fixture = fixtures.find(item => item.id === fixtureId), control = fixture.controls.find(item => item.id === controlId);
  const semantic = callabilitySemanticExpectation(fixture, control, nonce);
  const result = {requestId: request.requestId, sourceHash: request.snapshot.sourceHash,
    status: 'failed', reason: 'compiler-exit', rawDiagnostics: 'synthetic Clang raw error and candidate notes',
    diagnostics: [{severity: 'error', message: `no matching member function for call to '${semantic.member}'`,
      range: {start: {sourcePath: semantic.sourcePath, line: semantic.line, column: 10}}},
    {severity: 'note', message: "candidate function not viable: 'this' argument has type 'const Box', but method is not marked const"}]};
  return {control, semantic, result};
}

test('four const negatives accept the relevant error plus const candidate note', () => {
  for (const [fixtureId, controlId] of [['fix-alias-const', 'append-negative'], ['fix-template-const', 'write-negative'],
    ['fix-template-const', 'ingest-template-negative'], ['fix-overload-const', 'mutable-overload-negative']]) {
    const {control, semantic, result} = sample(fixtureId, controlId);
    assert.equal(evaluateCallabilityControl(control, request, result, {}, semantic).passed, true);
  }
});
test('arbitrary compiler-exit and unrelated errors or notes cannot satisfy const negatives', () => {
  const {control, semantic, result} = sample('fix-template-const', 'write-negative');
  for (const mutate of [
    bad => { bad.diagnostics[0].message = 'expected semicolon'; },
    bad => { bad.diagnostics[0].range.start.line++; },
    bad => { bad.diagnostics[1].message = 'candidate takes const int& but needs two arguments'; },
    bad => { bad.diagnostics.push({severity: 'error', message: 'unrelated syntax error'}); },
    bad => { bad.reason = 'linker-exit'; },
  ]) {
    const bad = structuredClone(result); mutate(bad);
    assert.equal(evaluateCallabilityControl(control, request, bad, {}, semantic).passed, false);
  }
});
test('deleted and unavailable require declared semantic reason at the expected call', () => {
  for (const [fixtureId, controlId, word] of [['fix-late-deleted-overload', 'deleted-int-negative', 'deleted'],
    ['fix-unavailable-header', 'unavailable-negative', 'unavailable']]) {
    const {control, semantic, result} = sample(fixtureId, controlId);
    result.diagnostics[0].message = `'${semantic.member}' is ${word}: ${semantic.errorPattern}`;
    result.rawDiagnostics = result.diagnostics[0].message;
    result.diagnostics.pop();
    assert.equal(evaluateCallabilityControl(control, request, result, {}, semantic).passed, true);
    result.diagnostics[0].message = 'some unrelated compiler error';
    assert.equal(evaluateCallabilityControl(control, request, result, {}, semantic).passed, false);
  }
});
