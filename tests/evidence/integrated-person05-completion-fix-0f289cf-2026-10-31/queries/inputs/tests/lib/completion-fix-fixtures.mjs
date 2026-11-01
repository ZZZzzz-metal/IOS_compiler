// New independent repair controls. No provider, product compiler, or old oracle is imported.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {offsetToClangPosition} from './completion-fixtures.mjs';

const marker = '/*<cc>*/';
const hash = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const file = (path, text) => ({path, role: 'user', text});
const signature = (name, argumentsPattern, suffix = '') => ({name,
  pattern: `\\b${name}\\s*\\(\\s*${argumentsPattern}\\s*\\)${suffix}`});

function make(id, markedFiles, expect, extra = {}) {
  let coordinates;
  const files = markedFiles.map(item => {
    const parts = item.text.split(marker);
    assert.equal(parts.length, item.path === 'main.cpp' ? 2 : 1);
    const text = parts.join('');
    if (item.path === 'main.cpp') coordinates = offsetToClangPosition(text, parts[0].length);
    return {...item, contentHash: hash(text), text};
  });
  return {id, status: 'pending-provider', language: {language: 'cpp', standard: 'c++17'},
    translationUnit: 'main.cpp', sourcePath: 'main.cpp', files, markedFiles,
    coordinates, fixtureHash: hash(JSON.stringify(files.map(({path, text}) => ({path, text})).sort((a, b) => a.path.localeCompare(b.path)))),
    expect: {support: 'required', contains: [], excludes: [], ...expect},
    pairId: null, baselineId: null, signatures: {required: [], forbidden: [], closedNames: []},
    controls: [], ...extra};
}

function control(id, definitions, body, expect, headers = []) {
  return {id, translationUnit: 'main.cpp', files: [...headers, file('main.cpp', `${definitions}\nint main() {\n${body}\n}\n`)],
    expect: {...expect}};
}
const succeeds = {status: 'compiled', smokeExitCode: 0};
const fails = {status: 'failed', reason: 'compiler-exit'};

// The caller supplies fresh crypto-random bytes for actual runs and archives the
// nonce. Fixed nonces are permitted only for preparation/self-checks.
export function generateCompletionFixFixtures(nonce) {
  assert.match(nonce ?? '', /^[a-f0-9]{8,24}$/);
  const n = stem => `${stem}_${nonce}`;
  const fixtures = [], probe = n('probe'), object = n('object');
  const alias = n('TextAlias');
  const aliasDefinitions = `#include <string>\nusing ${alias} = std::string;`;
  for (const isConst of [true, false]) {
    const declaration = `${isConst ? 'const ' : ''}${alias} ${object};`;
    fixtures.push(make(`fix-alias-${isConst ? 'const' : 'mutable'}`,
      [file('main.cpp', `${aliasDefinitions}\nvoid ${probe}() {\n  ${declaration}\n  ${object}.${marker}\n}\n`)],
      {trigger: '.', contains: isConst ? ['size', 'c_str'] : ['size', 'c_str', 'append'],
        inaccessibleOrAbsent: isConst ? ['append'] : []},
      {pairId: 'fix-alias-cv', controls: isConst ? [
        control('read-positive', aliasDefinitions, `  ${declaration}\n  return static_cast<int>(${object}.size());`, succeeds),
        control('append-negative', aliasDefinitions, `  ${declaration}\n  ${object}.append("x");\n  return 0;`, fails)
      ] : [control('append-positive', aliasDefinitions,
        `  ${declaration}\n  ${object}.append("x");\n  return ${object}.size() == 1 ? 0 : 1;`, succeeds)]}));
  }

  const box = n('Box'), type = n('Type'), otherType = n('OtherType'), argument = n('argument');
  const read = n('read'), write = n('write'), inspect = n('inspect'), ingest = n('ingest');
  const boxDefinitions = `template<class ${type}> struct ${box} {\n` +
    `  int ${read}() const { return 0; }\n` +
    `  void ${write}(${type} ${argument}) { (void)${argument}; }\n` +
    `  template<class ${otherType}> int ${inspect}(const ${otherType}& ${argument}) const { (void)${argument}; return 0; }\n` +
    `  template<class ${otherType}> void ${ingest}(const ${otherType}& ${argument}) { (void)${argument}; }\n};`;
  for (const isConst of [true, false]) {
    const declaration = `${isConst ? 'const ' : ''}${box}<int> ${object};`;
    fixtures.push(make(`fix-template-${isConst ? 'const' : 'mutable'}`,
      [file('main.cpp', `${boxDefinitions}\nvoid ${probe}() {\n  ${declaration}\n  ${object}.${marker}\n}\n`)],
      {trigger: '.', contains: isConst ? [read, inspect] : [read, write, inspect, ingest],
        inaccessibleOrAbsent: isConst ? [write, ingest] : []},
      {pairId: 'fix-template-cv', controls: isConst ? [
        control('read-template-positive', boxDefinitions, `  ${declaration}\n  return ${object}.${read}() + ${object}.${inspect}(0);`, succeeds),
        control('write-negative', boxDefinitions, `  ${declaration}\n  ${object}.${write}(1);\n  return 0;`, fails),
        control('ingest-template-negative', boxDefinitions, `  ${declaration}\n  ${object}.${ingest}(1);\n  return 0;`, fails)
      ] : [control('write-template-positive', boxDefinitions,
        `  ${declaration}\n  ${object}.${write}(1);\n  ${object}.${ingest}(1);\n  return ${object}.${read}() + ${object}.${inspect}(0);`, succeeds)]}));
  }

  const record = n('Record'), choose = n('choose');
  const overloadDefinitions = `struct ${record} {\n  int ${choose}() const { return 0; }\n  int ${choose}(int ${argument}) { (void)${argument}; return 0; }\n};`;
  const constSignature = signature(choose, '', '\\s*const\\s*$');
  const mutableSignature = signature(choose, 'int\\b[^)]*', '\\s*$');
  for (const isConst of [true, false]) {
    const declaration = `${isConst ? 'const ' : ''}${record} ${object};`;
    fixtures.push(make(`fix-overload-${isConst ? 'const' : 'mutable'}`,
      [file('main.cpp', `${overloadDefinitions}\nvoid ${probe}() {\n  ${declaration}\n  ${object}.${marker}\n}\n`)],
      {trigger: '.', contains: [choose]},
      {pairId: 'fix-overload-cv', signatures: {required: isConst ? [constSignature] : [constSignature, mutableSignature],
        forbidden: isConst ? [mutableSignature] : [], closedNames: [choose]}, controls: isConst ? [
        control('const-overload-positive', overloadDefinitions, `  ${declaration}\n  return ${object}.${choose}();`, succeeds),
        control('mutable-overload-negative', overloadDefinitions, `  ${declaration}\n  return ${object}.${choose}(1);`, fails)
      ] : [control('both-overloads-positive', overloadDefinitions,
        `  ${declaration}\n  return ${object}.${choose}() + ${object}.${choose}(1);`, succeeds)]}));
  }

  for (const placement of ['definition', 'declaration', 'header']) {
    const prefix = n(`surface_${placement}`), allowed = `${prefix}_allowed`, blocked = `${prefix}_blocked`, deprecated = `${prefix}_deprecated`;
    const declarations = `int ${allowed}();\n__attribute__((unavailable("person05-unavailable"))) int ${blocked}();\n` +
      `__attribute__((deprecated("person05-deprecated"))) int ${deprecated}();\n`;
    const definitions = placement === 'definition'
      ? `int ${allowed}() { return 0; }\n__attribute__((unavailable("person05-unavailable"))) int ${blocked}() { return 0; }\n` +
        `__attribute__((deprecated("person05-deprecated"))) int ${deprecated}() { return 0; }\n`
      : `int ${allowed}() { return 0; }\nint ${blocked}() { return 0; }\nint ${deprecated}() { return 0; }\n`;
    const headerPath = `api_${nonce}.inc`, headers = placement === 'header' ? [file(headerPath, declarations)] : [];
    const preamble = placement === 'header' ? `#include "${headerPath}"\n` : placement === 'declaration' ? declarations : '';
    const completeDefinitions = preamble + definitions;
    fixtures.push(make(`fix-unavailable-${placement}`,
      [...headers, file('main.cpp', `${completeDefinitions}\nvoid ${probe}() {\n  ${prefix}${marker}\n}\n`)],
      {trigger: 'identifier', prefix, contains: [allowed, deprecated], inaccessibleOrAbsent: [blocked]},
      {controls: [
        control('allowed-positive', completeDefinitions, `  return ${allowed}();`, succeeds, headers),
        control('unavailable-negative', completeDefinitions, `  return ${blocked}();`, {...fails, errorPattern: 'person05-unavailable'}, headers),
        control('deprecated-warning-positive', completeDefinitions, `  return ${deprecated}();`, {...succeeds, warningPattern: 'person05-deprecated'}, headers)
      ]}));
  }

  const overloadPrefix = n('mixed'), mixed = `${overloadPrefix}_select`, mixedDeprecated = `${overloadPrefix}_deprecated`;
  const mixedDefinitions = `int ${mixed}(double ${argument}) { (void)${argument}; return 0; }\n` +
    `__attribute__((unavailable("person05-unavailable"))) int ${mixed}(int ${argument}) { (void)${argument}; return 0; }\n` +
    `__attribute__((deprecated("person05-deprecated"))) int ${mixedDeprecated}() { return 0; }\n`;
  fixtures.push(make('fix-unavailable-overload',
    [file('main.cpp', `${mixedDefinitions}\nvoid ${probe}() {\n  ${overloadPrefix}${marker}\n}\n`)],
    {trigger: 'identifier', prefix: overloadPrefix, contains: [mixed, mixedDeprecated]},
    {signatures: {required: [signature(mixed, 'double\\b[^)]*', '\\s*$')],
      forbidden: [signature(mixed, 'int\\b[^)]*', '\\s*$')], closedNames: [mixed]}, controls: [
      control('available-overload-positive', mixedDefinitions, `  return ${mixed}(1.0);`, succeeds),
      control('unavailable-overload-negative', mixedDefinitions, `  return ${mixed}(1);`, {...fails, errorPattern: 'person05-unavailable'}),
      control('deprecated-warning-positive', mixedDefinitions, `  return ${mixedDeprecated}();`, {...succeeds, warningPattern: 'person05-deprecated'})
    ]}));
  const namespaceA = n('AreaA'), namespaceB = n('AreaB'), contextPrefix = n('cross'), contextName = `${contextPrefix}_read`;
  const contextDefinitions = `namespace ${namespaceA} {\n` +
    `__attribute__((unavailable("person05-unavailable"))) int ${contextName}() { return 0; }\n}\n` +
    `namespace ${namespaceB} {\nint ${contextName}() { return 0; }\n}\n`;
  fixtures.push(make('fix-unavailable-namespace-context',
    [file('main.cpp', `${contextDefinitions}\nvoid ${probe}() {\n  ${namespaceB}::${contextPrefix}${marker}\n}\n`)],
    {trigger: '::', prefix: contextPrefix, contains: [contextName]},
    {controls: [
      control('other-namespace-allowed-positive', contextDefinitions, `  return ${namespaceB}::${contextName}();`, succeeds),
      control('unavailable-namespace-negative', contextDefinitions,
        `  return ${namespaceA}::${contextName}();`, {...fails, errorPattern: 'person05-unavailable'})
    ]}));
  return fixtures;
}
