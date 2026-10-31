// Fixed-commit byte binding only. Never imports product code or reruns semantics.
import assert from 'node:assert/strict';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve, relative, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo), options = {}, args = process.argv.slice(2);
while (args.length) {
  const key = args.shift();
  assert(['--root-path', '--root-commit', '--semantics-path', '--semantics-commit', '--evidence-dir'].includes(key) && !(key in options));
  options[key] = args.shift(); assert(options[key] && !options[key].startsWith('--'));
}
for (const key of ['--root-commit', '--semantics-commit']) assert.match(options[key] ?? '', /^[a-f0-9]{40}$/);
for (const key of ['--root-path', '--semantics-path', '--evidence-dir']) assert(options[key]);
const rootPath = resolve(options['--root-path']), rootCommit = options['--root-commit'];
const semanticsPath = resolve(options['--semantics-path']), semanticsCommit = options['--semantics-commit'];
const evidencePath = resolve(options['--evidence-dir']);
assert.match(relative(resolve(cwd, 'tests/evidence'), evidencePath).replaceAll('\\', '/'), /^integrated-[a-z0-9.-]+\/binding(?:-[a-z0-9.-]+)?$/);
const evidence = pathToFileURL(evidencePath + sep), sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const git = (path, ...argv) => execFileSync('git', ['-c', `safe.directory=${path}`, '-C', path, ...argv],
  {maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
const show = (path, commit, file) => git(path, 'show', `${commit}:${file}`);
const list = (path, commit, paths) => git(path, 'ls-tree', '-r', '--name-only', commit, '--', ...paths).toString('utf8').trim().split(/\r?\n/u).filter(Boolean).sort();
const exists = (path, commit, file) => { try { git(path, 'cat-file', '-e', `${commit}:${file}`); return true; } catch { return false; } };
assert.equal(git(rootPath, 'rev-parse', `${rootCommit}^{commit}`).toString('utf8').trim(), rootCommit);
assert.equal(git(semanticsPath, 'rev-parse', `${semanticsCommit}^{commit}`).toString('utf8').trim(), semanticsCommit);
await mkdir(evidence); // New binding attempt only; no HEAD/worktree mutation.
async function save(file, value) {
  const url = new URL(file, evidence); await mkdir(new URL('./', url), {recursive: true});
  await writeFile(url, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
}
await save('.gitattributes', '* -text\n');
await save('audit-script.mjs', await readFile(new URL('tests/audit-completion-fix-binding.mjs', repo)));
const checks = [], sourceComparisons = [], resourceComparisons = [];
async function check(name, action) {
  try { const detail = await action(); checks.push({name, passed: true, ...(detail === undefined ? {} : {detail})}); return detail; }
  catch (error) { checks.push({name, passed: false, error: {message: error.message, stack: error.stack}}); return undefined; }
}
const expectedProfile = 'integration-prototype-c3e9a2fea60c51b3';
const candidatePath = 'app/integration/evidence/completion-fix-backend-2026-10-31/candidate-summary.json';
let candidate, fatalError = null;
try {
  const bytes = show(rootPath, rootCommit, candidatePath); await save('candidate-summary.json', bytes);
  candidate = JSON.parse(bytes.toString('utf8'));
  await check('fixed candidate owner/profile identities', () => {
    assert.equal(candidate.ownerDelivery, semanticsCommit); assert.equal(candidate.profile.compatibilityId, expectedProfile);
    assert.equal(candidate.resourceCount, 36); assert.equal(candidate.resources.length, 36);
    assert.equal(new Set(candidate.resources.map(resource => resource.id)).size, 36);
    assert.equal(new Set(candidate.resources.map(resource => resource.relativePath)).size, 36);
    return {rootCommit, semanticsCommit, profile: expectedProfile, resourceCount: 36};
  });
  const inputPaths = ['compiler/src', 'debugger/src', 'ui/src', 'storage/src', 'contracts',
    'ui/probe.html', 'ui/style.css', 'compiler/resources/toolchain.lock.json',
    'compiler/resources/completion-semantics-v1.md', 'compiler/resources/completion-semantics-v1.cpp.patch'];
  const rootInputs = list(rootPath, rootCommit, inputPaths), semanticsInputs = list(semanticsPath, semanticsCommit, inputPaths);
  await save('root-fixed-input-paths.json', rootInputs); await save('semantics-fixed-input-paths.json', semanticsInputs);
  await check('runtime/API input sets are identical at the two fixed commits', () => assert.deepEqual(rootInputs, semanticsInputs));
  for (const file of [...new Set([...rootInputs, ...semanticsInputs])].sort()) {
    const record = {file, rootCommit, semanticsCommit};
    if (!rootInputs.includes(file) || !semanticsInputs.includes(file)) { record.equal = false; record.missing = rootInputs.includes(file) ? 'semantics' : 'root'; }
    else {
      const rootBytes = show(rootPath, rootCommit, file), semanticsBytes = show(semanticsPath, semanticsCommit, file);
      record.root = {byteLength: rootBytes.length, sha256: sha(rootBytes)};
      record.semantics = {byteLength: semanticsBytes.length, sha256: sha(semanticsBytes)};
      record.equal = rootBytes.equals(semanticsBytes);
    }
    sourceComparisons.push(record);
  }
  await save('fixed-input-comparisons.json', sourceComparisons);
  await check('all runtime/API and recipe input Git blobs are byte-identical', () => {
    assert(sourceComparisons.length > 0); assert.deepEqual(sourceComparisons.filter(record => !record.equal), []);
    return {inputFiles: sourceComparisons.length};
  });
  const mappingPaths = ['app/integration/candidate.mjs', 'app/offline/build.mjs', 'contracts/invariants.mjs',
    'compiler/resources/toolchain.lock.json', 'compiler/src/completion-semantics.mjs',
    'compiler/resources/completion-semantics-v1.md', 'compiler/resources/completion-semantics-v1.cpp.patch'];
  const mappingFingerprints = [];
  for (const file of mappingPaths) {
    const bytes = show(rootPath, rootCommit, file); await save(`fixed-root-inputs/${file}`, bytes);
    mappingFingerprints.push({file, byteLength: bytes.length, sha256: sha(bytes)});
  }
  await save('root-mapping-fingerprints.json', mappingFingerprints);
  await check('root summary mapping fingerprints match fixed Git bytes', () => {
    for (const record of candidate.rootMappingFingerprints) {
      const actual = mappingFingerprints.find(item => item.file === record.path); assert(actual, record.path);
      assert.equal(actual.byteLength, record.byteLength, record.path);
      assert.equal(actual.sha256.slice(7), record.sha256, record.path);
    }
  });
  const rootLock = JSON.parse(show(rootPath, rootCommit, 'compiler/resources/toolchain.lock.json'));
  const semanticsLock = JSON.parse(show(semanticsPath, semanticsCommit, 'compiler/resources/toolchain.lock.json'));
  const sourceURLPrefix = 'local-source:module/02-compiler/';
  for (const resource of candidate.resources) {
    const file = resource.relativePath, record = {file, declared: resource};
    try {
      assert.equal(resource.id, file); assert(!file.startsWith('/') && !file.split('/').some(part => !part || part === '.' || part === '..'));
      if (exists(rootPath, rootCommit, file)) {
        record.binding = 'fixed-git-blob';
        assert(exists(semanticsPath, semanticsCommit, file), `Semantic commit is missing ${file}`);
        const rootBytes = show(rootPath, rootCommit, file), semanticBytes = show(semanticsPath, semanticsCommit, file);
        record.root = {byteLength: rootBytes.length, sha256: sha(rootBytes)};
        record.semantics = {byteLength: semanticBytes.length, sha256: sha(semanticBytes)};
        assert(rootBytes.equals(semanticBytes), file);
      } else {
        // Four ignored large files are bound by the identical committed locks,
        // then checked against actual local bytes. They are not called Git blobs.
        const prefix = `compiler/resources/${rootLock.vendorDirectory}/`; assert(file.startsWith(prefix));
        const filename = file.slice(prefix.length); assert(['clang', 'lld', 'memfs', 'sysroot.tar'].includes(filename));
        const pinned = rootLock.files.find(item => item.filename === filename), semanticPinned = semanticsLock.files.find(item => item.filename === filename);
        assert(pinned && semanticPinned); assert.deepEqual(pinned, semanticPinned);
        record.binding = 'fixed-lock-and-read-only-local-bytes'; record.locked = {byteLength: pinned.byteLength, sha256: `sha256:${pinned.sha256}`};
        const rootBytes = await readFile(resolve(rootPath, file)), semanticBytes = await readFile(resolve(semanticsPath, file));
        record.root = {byteLength: rootBytes.length, sha256: sha(rootBytes)};
        record.semantics = {byteLength: semanticBytes.length, sha256: sha(semanticBytes)};
        assert.deepEqual(record.root, record.locked, file); assert.deepEqual(record.semantics, record.locked, file);
      }
      assert.equal(record.root.byteLength, resource.byteLength, file); assert.equal(record.root.sha256, resource.sha256, file);
      assert.equal(record.semantics.byteLength, resource.byteLength, file); assert.equal(record.semantics.sha256, resource.sha256, file);
      if (file === 'compiler/src/completion-semantics.mjs') assert.equal(resource.sourceURL, sourceURLPrefix + file);
      record.passed = true;
    } catch (error) { record.passed = false; record.error = {message: error.message, stack: error.stack}; }
    resourceComparisons.push(record);
  }
  await save('resource-comparisons.json', resourceComparisons);
  await check('all 36 declared backend resources bind to actual fixed/locked bytes', () => {
    assert.equal(resourceComparisons.length, 36); assert.deepEqual(resourceComparisons.filter(record => !record.passed), []);
    assert.equal(resourceComparisons.filter(record => record.binding === 'fixed-lock-and-read-only-local-bytes').length, 4);
    return {fixedGitResources: 32, lockedLargeResources: 4, totalResourceBytes: resourceComparisons.reduce((total, record) => total + record.declared.byteLength, 0)};
  });
  await check('independent canonical manifest hash and derived profile ID', () => {
    const entries = candidate.resources.map(resource => ({id: resource.id, relativePath: resource.relativePath,
      sha256: resource.sha256, byteLength: resource.byteLength, mediaType: resource.mediaType, version: resource.version,
      roles: [...resource.roles].sort(), licenseFile: resource.licenseFile, sourceURL: resource.sourceURL}))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const manifestHash = sha(Buffer.from(JSON.stringify({version: 1, resources: entries})));
    assert.equal(candidate.profile.resourceManifestHash, manifestHash);
    assert.equal(`integration-prototype-${manifestHash.slice(7, 23)}`, expectedProfile);
    return {manifestHash, compatibilityId: expectedProfile};
  });
  await check('semantics module is in candidate manifest and recipe docs are in fixed offline source mapping', () => {
    const candidateSource = show(rootPath, rootCommit, 'app/integration/candidate.mjs').toString('utf8');
    const buildSource = show(rootPath, rootCommit, 'app/offline/build.mjs').toString('utf8');
    const compilerList = /export const COMPILER_MODULE_FILES\s*=\s*\[([\s\S]*?)\];/u.exec(candidateSource); assert(compilerList);
    const compilerPaths = [...compilerList[1].matchAll(/'([^']+)'/gu)].map(match => match[1]);
    assert(compilerPaths.includes('compiler/src/completion-semantics.mjs'));
    assert(candidate.resources.some(resource => resource.relativePath === 'compiler/src/completion-semantics.mjs'));
    const offlineList = /for\s*\(const path of\s*\[([\s\S]*?)\]\)await add\(path\);/u.exec(buildSource); assert(offlineList);
    const offlinePaths = [...offlineList[1].matchAll(/'([^']+)'/gu)].map(match => match[1]);
    const recipeFiles = ['compiler/resources/completion-semantics-v1.md', 'compiler/resources/completion-semantics-v1.cpp.patch'];
    for (const file of recipeFiles) {
      assert(offlinePaths.includes(file), file); assert(rootInputs.includes(file));
      assert.equal(sourceComparisons.find(record => record.file === file)?.equal, true);
    }
    assert.match(buildSource, /for\(const resource of candidate\.resources\)await add\(resource\.relativePath\)/u);
    return {candidateCompilerInputs: compilerPaths, additionalOfflineInputs: offlinePaths, recipeFiles,
      scope: 'Static source mapping is verified; no new offline package was built or accepted here.'};
  });
  await check('completion identity remains distinct from original full-compile identity', () => {
    assert.equal(candidate.profile.compiler.buildHash, `sha256:${rootLock.files.find(file => file.filename === 'clang').sha256}`);
    assert.deepEqual(candidate.completionIdentity, {toolchainId: `${rootLock.toolchainId}+completion-semantics.1`,
      compilerResourceHash: 'sha256:b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901',
      sysrootResourceHash: `sha256:${rootLock.files.find(file => file.filename === 'sysroot.tar').sha256}`});
    assert.equal(candidate.completionByteLength, 31214494);
    assert.notEqual(candidate.completionIdentity.compilerResourceHash, candidate.profile.compiler.buildHash);
  });
} catch (error) { fatalError = {message: error.message, stack: error.stack}; }
await save('differences.json', {runtimeInputs: sourceComparisons.filter(record => !record.equal), resources: resourceComparisons.filter(record => !record.passed)});
const passed = !fatalError && checks.length > 0 && checks.every(record => record.passed);
const summary = {requestId: 'CC-20261030-05', kind: 'fixed-commit-integrated-source-binding', passed,
  rootPath, rootCommit, semanticsPath, semanticsCommit, compatibilityId: candidate?.profile?.compatibilityId ?? null,
  resourceCount: resourceComparisons.length, inputFileCount: sourceComparisons.length,
  fixedGitResources: resourceComparisons.filter(record => record.binding === 'fixed-git-blob').length,
  lockedLocalResources: resourceComparisons.filter(record => record.binding === 'fixed-lock-and-read-only-local-bytes').length,
  checks, fatalError, actualProviderQueries: 0, actualCompilerCalls: 0, actualBrowserObservations: 0,
  scope: ['All Git inputs read from explicit commits; moving worktree HEAD is not a test target.',
    'Four ignored vendor binaries are read-only hashed against identical committed locks, not represented as Git blobs.',
    'Identical runtime/API inputs bind existing fixed-owner semantics evidence to this root source combination.',
    'Recipe documentation is checked in offline source mapping, not counted as part of the 36 backend resources.',
    'No semantic rerun, new full package, browser/offline/iPad acceptance is claimed.']};
await save('summary.json', summary);
console.log(JSON.stringify({passed, rootCommit, semanticsCommit, compatibilityId: summary.compatibilityId,
  resourceCount: summary.resourceCount, inputFileCount: summary.inputFileCount, fixedGitResources: summary.fixedGitResources,
  lockedLocalResources: summary.lockedLocalResources, failures: checks.filter(record => !record.passed), fatalError}, null, 2));
if (!passed) process.exitCode = 1;
