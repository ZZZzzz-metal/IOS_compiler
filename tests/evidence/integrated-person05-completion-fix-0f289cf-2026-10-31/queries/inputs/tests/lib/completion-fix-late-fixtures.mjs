// Late independent repair controls, separate from the sealed original 11/24.
// Input generation only: no product provider or compiler is imported.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {offsetToClangPosition} from './completion-fixtures.mjs';

const marker = '/*<cc>*/';
const hash = text => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
const file = text => ({path: 'main.cpp', role: 'user', text});
const succeeds = {status: 'compiled', smokeExitCode: 0};

function make(id, marked, expect, signatures, controls) {
  const parts = marked.split(marker);
  assert.equal(parts.length, 2, `${id}: exactly one cursor marker`);
  const text = parts.join('');
  const files = [{...file(text), contentHash: hash(text)}];
  return {id, status: 'pending-provider', language: {language: 'cpp', standard: 'c++17'},
    translationUnit: 'main.cpp', sourcePath: 'main.cpp', files, markedFiles: [file(marked)],
    coordinates: offsetToClangPosition(text, parts[0].length),
    fixtureHash: hash(JSON.stringify(files.map(({path, text}) => ({path, text})))),
    expect: {support: 'required', contains: [], excludes: [], ...expect},
    pairId: null, baselineId: null, signatures, controls};
}

function control(id, definitions, body, expect) {
  return {id, translationUnit: 'main.cpp', files: [file(`${definitions}\nint main() {\n${body}\n}\n`)],
    expect: {...expect}};
}

export function generateCompletionFixLateFixtures(nonce) {
  assert.match(nonce ?? '', /^[a-f0-9]{8,24}$/);
  const n = stem => `${stem}_${nonce}`;
  const probe = n('lateProbe'), object = n('lateObject'), argument = n('lateArgument');
  const box = n('LateBox'), type = n('LateType'), valueType = n('LateValueType');
  const staticRead = n('lateStaticRead');
  const staticDefinitions = `template<class ${type}> struct ${box} {\n` +
    `  template<class ${valueType}> static int ${staticRead}(${valueType} ${argument}) { (void)${argument}; return 0; }\n` +
    '};\n';
  const staticDeclaration = `const ${box}<int> ${object};`;
  const staticFixture = make('fix-late-static-template',
    `${staticDefinitions}\nvoid ${probe}() {\n  ${staticDeclaration}\n  ${object}.${marker}\n}\n`,
    {trigger: '.', contains: [staticRead]},
    {required: [], forbidden: [], closedNames: []},
    [control('static-template-positive', staticDefinitions,
      `  ${staticDeclaration}\n  return ${object}.${staticRead}(1);`, succeeds)]);

  const prefix = n('lateChoice'), choose = `${prefix}_call`;
  const deletedDefinitions = `int ${choose}(double ${argument}) { (void)${argument}; return 0; }\n` +
    `int ${choose}(int ${argument}) = delete;\n`;
  const signature = typeName => ({name: choose,
    pattern: `\\b${choose}\\s*\\(\\s*${typeName}\\b[^)]*\\)\\s*$`});
  const deletedFixture = make('fix-late-deleted-overload',
    `${deletedDefinitions}\nvoid ${probe}() {\n  ${prefix}${marker}\n}\n`,
    {trigger: 'identifier', prefix, contains: [choose]},
    {required: [signature('double')], forbidden: [signature('int')], closedNames: [choose]},
    [control('available-double-positive', deletedDefinitions, `  return ${choose}(1.0);`, succeeds),
      control('deleted-int-negative', deletedDefinitions, `  return ${choose}(1);`,
        {status: 'failed', reason: 'compiler-exit', errorPattern: 'deleted', errorMember: choose})]);
  return [staticFixture, deletedFixture];
}
