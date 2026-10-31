// Independent callability assertions. No compiler/provider implementation is imported.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const errorSeverity = value => value === 'error' || value === 'fatal';

export function callabilitySemanticExpectation(fixture, control, nonce) {
  if (control.expect.status !== 'failed') return null;
  const constMembers = {
    'fix-alias-const/append-negative': 'append',
    'fix-template-const/write-negative': `write_${nonce}`,
    'fix-template-const/ingest-template-negative': `ingest_${nonce}`,
    'fix-overload-const/mutable-overload-negative': `choose_${nonce}`,
  };
  const member = constMembers[`${fixture.id}/${control.id}`] ?? control.expect.errorMember;
  const main = control.files.find(file => file.path === control.translationUnit);
  assert(main, 'Negative control must include its translation unit');
  const lines = main.text.split('\n'), entry = lines.findIndex(line => /\bint\s+main\s*\(/u.test(line));
  assert(entry >= 0, 'Negative control must be a complete main program');
  let errorMember = member;
  if (!errorMember) {
    const calls = lines.slice(entry + 1).flatMap(line => [...line.matchAll(/\breturn\s+(?:[A-Za-z_]\w*::)*([A-Za-z_]\w*)\s*\(/gu)].map(match => match[1]));
    assert.equal(calls.length, 1, 'Negative control must have one explicit expected call');
    [errorMember] = calls;
  }
  const call = new RegExp(`\\b${escape(errorMember)}\\s*\\(`, 'u');
  const callLines = lines.flatMap((line, index) => index > entry && call.test(line) ? [index + 1] : []);
  assert.equal(callLines.length, 1, 'The error anchor must identify one call line');
  const kind = constMembers[`${fixture.id}/${control.id}`] ? 'const' :
    control.expect.errorPattern === 'deleted' ? 'deleted' : 'unavailable';
  assert(kind === 'const' || typeof control.expect.errorPattern === 'string', 'Negative control needs a semantic reason');
  return {kind, member: errorMember, sourcePath: main.path, line: callLines[0],
    ...(control.expect.errorPattern ? {errorPattern: control.expect.errorPattern} : {})};
}

export function diagnosticErrorGroups(diagnostics) {
  const groups = [];
  for (const [index, diagnostic] of diagnostics.entries()) {
    if (errorSeverity(diagnostic?.severity)) groups.push({index, error: diagnostic, notes: []});
    else if (diagnostic?.severity === 'note' && groups.length) groups.at(-1).notes.push(diagnostic);
  }
  return groups;
}

export function evaluateCallabilityControl(control, request, result, resources, semantic) {
  const errors = [], check = (code, condition, detail) => { if (!condition) errors.push({code, ...(detail === undefined ? {} : {detail})}); };
  check('request-identity', result?.requestId === request.requestId);
  check('source-identity', result?.sourceHash === request.snapshot.sourceHash);
  check('expected-status', result?.status === control.expect.status, {expected: control.expect.status, actual: result?.status});
  const diagnostics = Array.isArray(result?.diagnostics) ? result.diagnostics : [];
  check('diagnostics-array', Array.isArray(result?.diagnostics));
  const groups = diagnosticErrorGroups(diagnostics);
  if (control.expect.status === 'compiled') {
    check('nonempty-executable', result?.executable instanceof Uint8Array && result.executable.length > 0);
    check('nonempty-object', result?.object instanceof Uint8Array && result.object.length > 0);
    check('smoke-exit', result?.smoke?.exitCode === control.expect.smokeExitCode, result?.smoke);
    check('no-error-diagnostics', groups.length === 0, groups);
    check('snapshot-identity', result?.snapshotId === request.snapshot.snapshotId);
    for (const [key, expected] of Object.entries(resources)) check('full-compiler-resource-identity', result?.[key] === expected, {key, expected, actual: result?.[key]});
    if (result?.executable instanceof Uint8Array) {
      const actual = `sha256:${createHash('sha256').update(result.executable).digest('hex')}`;
      check('executable-reference-hash', result.executableRef?.sha256 === actual, {expected: actual, actual: result.executableRef?.sha256});
      check('executable-reference-length', result.executableRef?.byteLength === result.executable.length);
      check('executable-reference-version', result.executableRef?.version === resources.toolchainId);
    }
    if (control.expect.warningPattern) {
      const pattern = new RegExp(control.expect.warningPattern, 'u');
      check('declared-deprecated-warning', diagnostics.some(item => item.severity === 'warning' && /deprecated/iu.test(item.message ?? '') && pattern.test(item.message ?? '')));
      check('raw-deprecated-warning', typeof result?.rawDiagnostics === 'string' && pattern.test(result.rawDiagnostics));
    }
  } else {
    check('compiler-semantic-failure', result?.reason === 'compiler-exit');
    check('no-failed-executable', !result?.executable && !result?.object);
    check('semantic-expectation-present', semantic !== null && typeof semantic === 'object');
    const matched = semantic ? groups.filter(group => {
      const start = group.error.range?.start;
      if (start?.sourcePath !== semantic.sourcePath || start?.line !== semantic.line ||
        !new RegExp(`\\b${escape(semantic.member)}\\b`, 'u').test(group.error.message ?? '')) return false;
      const chain = [group.error, ...group.notes].map(item => item.message ?? '').join('\n');
      if (semantic.kind === 'const') {
        // Clang often puts the cv reason in candidate notes after a generic
        // "no matching member function" error. Ordinary const parameter text
        // alone is insufficient; require the receiver/qualifier relationship.
        return /not marked const|(?:this|object)[^\n]*(?:\bconst\b|qualifier)|(?:\bconst\b|qualifier)[^\n]*(?:this|object)/iu.test(chain);
      }
      return new RegExp(semantic.errorPattern, 'u').test(chain) &&
        new RegExp(semantic.kind, 'iu').test(chain);
    }) : [];
    check('anchored-semantic-diagnostic-chain', matched.length > 0, {semantic, groups});
    check('no-unrelated-error-groups', groups.length > 0 && matched.length === groups.length, {semantic, groups});
    check('raw-diagnostics-preserved', typeof result?.rawDiagnostics === 'string' && result.rawDiagnostics.length > 0);
    if (semantic?.errorPattern) check('raw-declared-error-pattern', new RegExp(semantic.errorPattern, 'u').test(result?.rawDiagnostics ?? ''));
  }
  return {passed: errors.length === 0, expected: control.expect, semantic, diagnosticGroups: groups, errors};
}
