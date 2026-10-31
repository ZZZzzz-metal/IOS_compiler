// Input/oracle infrastructure only. This suite never invokes completion or Clang.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateCompletionFixFixtures} from './lib/completion-fix-fixtures.mjs';
import {offsetToClangPosition} from './lib/completion-fixtures.mjs';
import {requestFromFixture} from './lib/completion-oracle.mjs';

const nonce = 'a19f062ce487', secondNonce = 'e829bd047a61';
const fixtures = generateCompletionFixFixtures(nonce);
const digest = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

test('eleven distinct repair queries remain preparation-only', () => {
  assert.equal(fixtures.length, 11);
  assert.equal(new Set(fixtures.map(item => item.id)).size, 11);
  assert(fixtures.every(item => item.status === 'pending-provider'));
  assert.deepEqual(fixtures.filter(item => item.pairId).reduce((counts, item) => {
    counts[item.pairId] = (counts[item.pairId] ?? 0) + 1; return counts;
  }, {}), {'fix-alias-cv': 2, 'fix-template-cv': 2, 'fix-overload-cv': 2});
});

test('one exact marker and independent coordinates bind each archived query', () => {
  for (const fixture of fixtures) {
    assert.equal(fixture.markedFiles.reduce((count, item) => count + item.text.split('/*<cc>*/').length - 1, 0), 1);
    for (const source of fixture.files) {
      assert.doesNotMatch(source.text, /\/\*<cc>\*\/|\r|\ufeff/u);
      assert.equal(source.contentHash, digest(source.text));
    }
    const marked = fixture.markedFiles.find(item => item.path === fixture.sourcePath).text;
    const text = fixture.files.find(item => item.path === fixture.sourcePath).text;
    assert.deepEqual(fixture.coordinates, offsetToClangPosition(text, marked.indexOf('/*<cc>*/')));
    const prefix = fixture.expect.prefix ?? '';
    assert.equal(text.slice(fixture.coordinates.offsetUtf16 - prefix.length, fixture.coordinates.offsetUtf16), prefix);
    const request = requestFromFixture(fixture, `input-${fixture.id}`, 1);
    assert.equal(request.snapshot.sourceHash, digest(JSON.stringify({version: 1, translationUnit: fixture.translationUnit,
      files: fixture.files.map(({path, role, text}) => ({path, role, text})).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)})));
  }
});

test('fresh nonce changes names and source hashes without changing test meaning', () => {
  const second = generateCompletionFixFixtures(secondNonce);
  const withoutFingerprints = values => JSON.stringify(values, (key, value) =>
    ['fixtureHash', 'contentHash'].includes(key) ? undefined : value);
  assert.equal(withoutFingerprints(fixtures).replaceAll(nonce, '<nonce>'),
    withoutFingerprints(second).replaceAll(secondNonce, '<nonce>'));
  for (let index = 0; index < fixtures.length; index++) assert.notEqual(fixtures[index].fixtureHash, second[index].fixtureHash);
});

test('required and forbidden spellings do not contradict; same-name overloads use signatures', () => {
  for (const fixture of fixtures) {
    for (const name of fixture.expect.contains) {
      assert(!(fixture.expect.inaccessibleOrAbsent ?? []).includes(name));
      assert(!(fixture.expect.excludes ?? []).includes(name));
    }
    for (const constraint of [...fixture.signatures.required, ...fixture.signatures.forbidden]) {
      assert(constraint.name.includes(nonce));
      assert.doesNotThrow(() => new RegExp(constraint.pattern, 'u'));
    }
  }
  for (const id of ['fix-overload-const', 'fix-unavailable-overload']) {
    const fixture = fixtures.find(item => item.id === id);
    assert.equal(fixture.signatures.forbidden.length, 1);
    assert.deepEqual(fixture.signatures.closedNames, [fixture.signatures.forbidden[0].name]);
    assert(fixture.expect.contains.includes(fixture.signatures.forbidden[0].name));
    assert(!(fixture.expect.inaccessibleOrAbsent ?? []).includes(fixture.signatures.forbidden[0].name));
  }
});

test('signature constraints distinguish int/double and const/nonconst overloads', () => {
  const constFixture = fixtures.find(item => item.id === 'fix-overload-const');
  const {name} = constFixture.signatures.required[0];
  assert.match(`int ${name}() const`, new RegExp(constFixture.signatures.required[0].pattern, 'u'));
  assert.doesNotMatch(`int ${name}(int argument)`, new RegExp(constFixture.signatures.required[0].pattern, 'u'));
  assert.doesNotMatch(`int ${name}()`, new RegExp(constFixture.signatures.required[0].pattern, 'u'));
  assert.match(`int ${name}(int argument)`, new RegExp(constFixture.signatures.forbidden[0].pattern, 'u'));
  assert.doesNotMatch(`int ${name}(int argument) const`, new RegExp(constFixture.signatures.forbidden[0].pattern, 'u'));
  const mixed = fixtures.find(item => item.id === 'fix-unavailable-overload');
  const mixedName = mixed.signatures.required[0].name;
  assert.match(`int ${mixedName}(double argument)`, new RegExp(mixed.signatures.required[0].pattern, 'u'));
  assert.doesNotMatch(`int ${mixedName}(int argument)`, new RegExp(mixed.signatures.required[0].pattern, 'u'));
  assert.match(`int ${mixedName}(int argument)`, new RegExp(mixed.signatures.forbidden[0].pattern, 'u'));
});

test('complete independent call controls include positives, negatives and deprecated warnings', () => {
  for (const fixture of fixtures) {
    assert(fixture.controls.length > 0);
    assert.equal(new Set(fixture.controls.map(item => item.id)).size, fixture.controls.length);
    assert(fixture.controls.some(item => item.expect.status === 'compiled'));
    for (const control of fixture.controls) {
      assert(control.files.some(item => item.path === control.translationUnit));
      assert.match(control.files.find(item => item.path === control.translationUnit).text, /int main\(\)/u);
      assert(control.files.every(item => !item.text.includes('/*<cc>*/')));
      if (control.expect.status === 'compiled') assert.equal(control.expect.smokeExitCode, 0);
      else assert.deepEqual(control.expect.reason, 'compiler-exit');
    }
  }
  for (const fixture of fixtures.filter(item => item.id.startsWith('fix-unavailable-') && item.id !== 'fix-unavailable-namespace-context')) {
    assert(fixture.controls.some(item => item.expect.status === 'failed' && item.expect.errorPattern === 'person05-unavailable'));
    assert(fixture.controls.some(item => item.expect.warningPattern === 'person05-deprecated'));
  }
  assert(fixtures.find(item => item.id === 'fix-unavailable-definition').controls.some(item => item.id === 'allowed-positive'));
  assert.equal(fixtures.find(item => item.id === 'fix-unavailable-header').files.length, 2);
  const context = fixtures.find(item => item.id === 'fix-unavailable-namespace-context');
  assert.equal(context.expect.trigger, '::');
  assert.equal(context.expect.contains.length, 1);
  assert.equal(context.expect.inaccessibleOrAbsent, undefined);
  assert(context.controls.some(item => item.id === 'other-namespace-allowed-positive' && item.expect.status === 'compiled'));
  assert(context.controls.some(item => item.id === 'unavailable-namespace-negative' && item.expect.status === 'failed'));
});

test('nonce rejects accidental missing or non-hex names', () => {
  for (const value of [undefined, '', 'abcd', 'AABBCCDDEEFF', 'a'.repeat(25), '1234567g']) {
    assert.throws(() => generateCompletionFixFixtures(value));
  }
});
