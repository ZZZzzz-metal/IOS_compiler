// Additional strict signature checks for CC-20261030-05. Original oracle stays unchanged.
import assert from 'node:assert/strict';
import {evaluateCompletion} from './completion-oracle.mjs';

export function evaluateCompletionFix(fixture, request, result, resources) {
  const original = evaluateCompletion(fixture, request, result, resources);
  const errors = original.errors.map(error => ({...error}));
  const items = Array.isArray(result?.items) ? result.items : [];
  const {required = [], forbidden = [], closedNames = []} = fixture.signatures ?? {};
  const pattern = entry => {
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.pattern, 'string');
    assert(entry.name && entry.pattern);
    return new RegExp(entry.pattern, 'u');
  };
  const matchesName = (item, name) => item?.insertText === name || item?.label === name;
  const matches = (item, entry) => matchesName(item, entry.name) &&
    typeof item?.detail === 'string' && pattern(entry).test(item.detail);
  for (const entry of required) {
    pattern(entry);
    if (!items.some(item => item?.insertText === entry.name && item?.label === entry.name && matches(item, entry)))
      errors.push({category: 'signature', code: 'missing-required-overload', detail: entry});
  }
  for (const entry of forbidden) {
    pattern(entry);
    for (const item of items.filter(item => matches(item, entry)))
      errors.push({category: 'signature', code: 'ineligible-overload-confirmable', detail: {entry, item}});
  }
  for (const name of closedNames) {
    const allowed = required.filter(entry => entry.name === name);
    assert(allowed.length > 0, `Closed signature name ${name} needs an explicit allowed signature`);
    for (const item of items.filter(item => matchesName(item, name))) {
      if (!allowed.some(entry => matches(item, entry)))
        errors.push({category: 'signature', code: 'unrecognized-confirmable-overload', detail: {name, item}});
    }
  }
  return {verdict: errors.length === 0 ? 'passed' : 'failed', originalVerdict: original.verdict,
    itemCount: items.length, errors};
}
