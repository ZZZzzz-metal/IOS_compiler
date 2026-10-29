// These checks validate independent test inputs, not the completion product.
import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCompletionFixtures, offsetToClangPosition, assertUtf16Boundary, completionFixtureInventory} from './lib/completion-fixtures.mjs';

const fixtures = await loadCompletionFixtures();
const get = id => { const item = fixtures.find(f => f.id === id); assert(item, id); return item; };
const targetText = item => item.files.find(f => f.path === item.sourcePath).text;

test('32 independent cases retain pending status; no provider results are fabricated', () => {
  assert.equal(fixtures.length, 32);
  assert.equal(fixtures.reduce((count, f) => count + f.files.length, 0), 33);
  assert(fixtures.every(f => f.status === 'pending-provider' && !('items' in f)));
  assert.equal(fixtures.filter(f => f.language.language === 'c').length, 3);
  assert.equal(completionFixtureInventory(fixtures).featureStatus, 'pending-provider-ui-package');
});

test('ASCII, Chinese and non-BMP coordinates have independent literal oracles', () => {
  assert.deepEqual(offsetToClangPosition('abc\n  value.', 12), {offsetUtf16: 12, line: 2, columnUtf16: 9, columnUtf8: 9});
  assert.deepEqual(offsetToClangPosition('中😀x\n知识.', 8), {offsetUtf16: 8, line: 2, columnUtf16: 4, columnUtf8: 8});
  const prefix = get('nonbmp-prefix');
  assert.deepEqual(prefix.coordinates, {offsetUtf16: 41, line: 1, columnUtf16: 42, columnUtf8: 58});
  const member = get('nonbmp-member');
  assert.equal(member.coordinates.columnUtf8 - member.coordinates.columnUtf16, 4);
  assert(targetText(prefix).slice(0, prefix.coordinates.offsetUtf16).endsWith('知'));
});

test('coordinate oracle rejects raw editor text and surrogate splits', () => {
  assert.throws(() => offsetToClangPosition('\ufeffabc', 2), /BOM/);
  assert.throws(() => offsetToClangPosition('a\r\nb', 4), /normalized LF/);
  assert.throws(() => assertUtf16Boundary('a😀b', 2), /surrogate/);
  for (const offset of [-1, 5, 1.5, NaN]) assert.throws(() => assertUtf16Boundary('abc', offset), /outside/);
  for (const offset of [0, 1, 3, 4]) assert.doesNotThrow(() => assertUtf16Boundary('a😀b', offset));
});

test('type swap and rename retain counterfactual declarations and different fingerprints', () => {
  const a = get('type-a'), b = get('type-b'), renamed = get('renamed-member');
  const aText = targetText(a), bText = targetText(b);
  assert.equal(aText.replace('Pixel value;', 'Compass value;'), bText);
  assert.equal(aText.replace('int scarlet;', 'int coral;'), targetText(renamed));
  assert.deepEqual(a.expect.contains, ['scarlet', 'common']);
  assert.deepEqual(b.expect.contains, ['north', 'common']);
  assert(renamed.expect.excludes.includes('scarlet'));
  assert.equal(renamed.baselineId, a.id);
  assert.equal(new Set([a.fixtureHash, b.fixtureHash, renamed.fixtureHash]).size, 3);
});

test('scope and declaration order negatives are represented at the actual caret', () => {
  const inner = get('shadow-inner'), outer = get('shadow-restored');
  assert.deepEqual(inner.expect.excludes, outer.expect.contains);
  assert.deepEqual(outer.expect.excludes, inner.expect.contains);
  const order = get('declaration-order'), text = targetText(order);
  assert(text.indexOf('int beforeGlobal;') < order.coordinates.offsetUtf16);
  assert(text.indexOf('int beforeLater;') > order.coordinates.offsetUtf16);
  assert.deepEqual(order.expect.excludes, ['beforeLater']);
});

test('include context is preserved; omission cannot silently reuse driver declarations', () => {
  const included = get('included-source'), omitted = get('include-omitted');
  assert.equal(included.translationUnit, 'driver.cpp'); assert.equal(included.sourcePath, 'user.inc');
  assert.match(included.files.find(f => f.path === 'driver.cpp').text, /#include "user.inc"/);
  assert.match(included.files.find(f => f.path === 'driver.cpp').text, /struct RequestData/);
  assert.doesNotMatch(targetText(omitted), /struct RequestData/);
  assert.deepEqual(included.expect.contains, omitted.expect.excludes);
});

test('UI suppression, prefix filtering and semantic boundaries are distinct expectations', () => {
  assert.deepEqual(fixtures.filter(f => f.expect.trigger === 'none').map(f => f.id), ['comment', 'string-literal', 'decimal']);
  assert.equal(get('namespace').expect.prefix, 'lo');
  assert.equal(get('enum').expect.prefix, 'orc');
  assert(get('namespace').expect.visibleExcludes.includes('ledger'));
  assert(!get('namespace').expect.excludes.includes('ledger'));
  assert.equal(get('access-control').expect.support, 'boundary');
  assert.equal(get('const-members').expect.support, 'boundary');
  assert.match(targetText(get('char-case')), /case'a': obj\./);
  assert.match(targetText(get('char-sizeof')), /sizeof'a'; obj\./);
  assert.match(targetText(get('pattern-variable')), /int Pattern = 7;/);
  assert.match(targetText(get('pattern-function')), /int Pattern\(int input\)/);
});
