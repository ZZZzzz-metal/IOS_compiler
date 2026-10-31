// Role05 immutable v0.4.7 archive audit. Never rebuilds the product or runs Clang.
// Run after inspect-v047-zip.py safely extracts the new archive:
// node --experimental-vm-modules tests/audit-completion-v047-package.mjs
import assert from 'node:assert/strict';
import {readFile, writeFile, readdir, access} from 'node:fs/promises';
import {createHash, X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {posix} from 'node:path';
import vm from 'node:vm';

const repo = new URL('../', import.meta.url), cwd = fileURLToPath(repo);
const revision = '912a23bf14cd6e48a0adb7ec119f4ce86bc58f93';
const backendBaseline = '0f289cf0de5aafc80cafc7c06fd669f95b85d873';
const uiBaseline = 'b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34';
const bundleId = 'ipad-web-probe-4b6a8377cadd31e675701549';
const profileId = 'integration-prototype-c3e9a2fea60c51b3';
const expected = {zipSHA: '6cc808248baaca8e1107de49d71458fd2140f8c83cd3bbb8810598351abc330d', zipBytes: 19337572,
  descriptorSHA: 'e9791ceb17df941d32f31e4dfc7216c75b5aba877f4492a404a8bb4e38c2870d',
  swSHA: '6900d0dd90e0ef6cdff3d891316251cc3e2c70924d3d26c870e8bc51e3271ac5',
  setupSHA: '0958fef87a5871c8c9a4edfc23f10a9b929888f2898da370dfbfdd981351d18f'};
const evidence = new URL('tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/package/', repo);
const extracted = new URL('tests/.local/completion-v047-912a23b-person05/', repo);
const release = new URL(`site/releases/${bundleId}/`, extracted);
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${cwd}`, '-C', cwd, ...args], {maxBuffer: 32 * 1024 * 1024});
const gitText = (...args) => git(...args).toString('utf8').trim();
const gitBytes = (path, ref = revision) => git('show', `${ref}:${path}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const prefixed = bytes => `sha256:${hash(bytes)}`;
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const parse = async url => JSON.parse(await readFile(url, 'utf8'));
const equal = (actual, wanted, message) => assert(actual.equals(wanted), `${message}: ${hash(actual)} vs ${hash(wanted)}`);
const save = (name, value) => writeFile(new URL(name, evidence), jsonBytes(value), {flag: 'wx'});
const startedAt = new Date().toISOString(), run = process.env.PERSON05_PACKAGE_AUDIT_RUN ?? 'run-01';
assert.match(run, /^run-\d{2}$/u);
const productPaths = ['package.json', 'package-lock.json', 'compiler', 'debugger', 'contracts', 'app/integration', 'app/offline', 'ui', 'storage'];
assert.equal(gitText('rev-parse', 'HEAD'), revision);
assert.equal(gitText('diff', revision, '--', ...productPaths), '');
try {await access(new URL('report.json', evidence)); throw new Error('Refusing to overwrite completed audit');}
catch (error) {if (error.code !== 'ENOENT') throw error;}
await writeFile(new URL(`audit-${run}.mjs`, evidence), await readFile(new URL(import.meta.url)), {flag: 'wx'});
await writeFile(new URL(`zip-inspector-${run}.py`, evidence), await readFile(new URL('tests/lib/inspect-v047-zip.py', repo)), {flag: 'wx'});
try {
  const zip = await parse(new URL('zip-members-run02.json', evidence));
  assert.equal(zip.zipSHA256, expected.zipSHA); assert.equal(zip.zipBytes, expected.zipBytes);
  assert.equal(zip.fileCount, 74); assert(zip.allPathsContained && !zip.duplicateOrLinkedEntries);
  assert.equal(hash(await readFile(zip.sourceArchive)), expected.zipSHA);
  const archiveManifest = await parse(new URL('SHA256SUMS.json', extracted));
  assert.equal(archiveManifest.length, 73);
  assert.deepEqual(zip.members.map(item => item.name).sort(), [...archiveManifest.map(item => item.path), 'SHA256SUMS.json'].sort());
  for (const item of archiveManifest) {
    const bytes = await readFile(new URL(item.path, extracted));
    assert.equal(bytes.length, item.byteLength); assert.equal(hash(bytes), item.sha256);
    const member = zip.members.find(entry => entry.name === item.path);
    assert.equal(member.byteLength, item.byteLength); assert.equal(member.sha256, item.sha256);
  }
  const descriptorBytes = await readFile(new URL('bundle.json', release)), descriptor = JSON.parse(descriptorBytes);
  assert.equal(hash(descriptorBytes), expected.descriptorSHA);
  assert.equal(descriptor.bundleId, bundleId); assert.equal(descriptor.compatibilityId, profileId);
  assert.equal(descriptor.resources.length, 65); assert.equal(descriptor.totalBytes, 60976781);
  assert.equal(descriptor.resources.reduce((n, item) => n + item.byteLength, 0), 60976781);
  const paths = new Set(descriptor.resources.map(item => item.path)); assert.equal(paths.size, 65);
  for (const item of descriptor.resources) {
    assert(!item.path.startsWith('/') && !/[\\:\x00-\x1f]/u.test(item.path) && !item.path.split('/').some(part => !part || part === '.' || part === '..'));
    const bytes = await readFile(new URL(item.path, release)); assert.equal(bytes.length, item.byteLength); assert.equal(prefixed(bytes), item.sha256);
  }
  const {createIntegrationCandidate} = await import(new URL('app/integration/candidate.mjs', repo));
  const candidate = await createIntegrationCandidate();
  assert.equal(candidate.profile.compatibilityId, profileId); assert.equal(candidate.resources.length, 36);
  assert.equal(candidate.profile.resourceManifestHash, descriptor.resourceManifestHash);
  const packagedCandidate = await parse(new URL('ui/.local/candidate.json', release));
  const capabilities = JSON.parse(gitBytes('contracts/capabilities.json'));
  assert.deepEqual(packagedCandidate.profile, candidate.profile); assert.deepEqual(packagedCandidate.resources, candidate.resources);
  assert.deepEqual(packagedCandidate.lock, candidate.lock); assert.deepEqual(packagedCandidate.capabilities, capabilities);
  const generated = new Map();
  generated.set('ui/.local/candidate.json', jsonBytes({profile: candidate.profile, resources: candidate.resources, lock: candidate.lock,
    capabilities, declaration: 'Versioned offline Web experiment. Real iPad offline acceptance and distribution remain unverified.'}));
  generated.set('manifest.webmanifest', jsonBytes({name: '算法工作台 · 离线实验', short_name: '算法工作台', lang: 'zh-CN',
    start_url: './index.html', scope: './', display: 'standalone', background_color: '#f5f4ef', theme_color: '#234d3c',
    icons: [{src: './icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any'}]}));
  const manualBytes = await readFile(new URL('IPAD-USER-MANUAL.md', release)), manual = manualBytes.toString('utf8');
  equal(manualBytes, gitBytes('docs/architecture/IPAD-USER-MANUAL.md'), 'Manual must equal fixed Git raw bytes');
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  generated.set('manual.html', Buffer.from(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iPad 操作手册</title><link rel="stylesheet" href="./style.css"><main><a href="./index.html">返回离线入口</a><h1>iPad 操作手册</h1><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit">${escape(manual)}</pre></main></html>`));
  const remap = new Map([['IPAD-USER-MANUAL.md', 'docs/architecture/IPAD-USER-MANUAL.md'],
    ...['index.html', 'launcher.mjs', 'style.css', 'icon.svg'].map(name => [name, `app/offline/browser/${name}`])]);
  const tracked = new Set(gitText('ls-tree', '-r', '--name-only', revision).split(/\r?\n/u)), sourceBindings = [];
  for (const item of descriptor.resources) {
    const bytes = await readFile(new URL(item.path, release));
    if (generated.has(item.path)) {
      equal(bytes, generated.get(item.path), `${item.path} generated from fixed inputs`);
      sourceBindings.push({path: item.path, kind: 'generated', byteLength: bytes.length, sha256: hash(bytes)}); continue;
    }
    const path = remap.get(item.path) ?? item.path;
    if (tracked.has(path)) {
      equal(bytes, gitBytes(path), `${item.path} fixed Git raw bytes`);
      sourceBindings.push({path: item.path, source: path, kind: 'fixed-git', revision, byteLength: bytes.length,
        gitBlob: gitText('rev-parse', `${revision}:${path}`), sha256: hash(bytes)});
    } else {
      const entry = candidate.lock.files.find(entry => entry.filename === path.split('/').at(-1));
      assert(entry, `${item.path} must have pinned lock entry`); assert.equal(bytes.length, entry.byteLength); assert.equal(hash(bytes), entry.sha256);
      sourceBindings.push({path: item.path, kind: 'locked-vendor', byteLength: bytes.length, sha256: hash(bytes)});
    }
  }
  const counts = Object.fromEntries(['fixed-git', 'locked-vendor', 'generated'].map(kind => [kind, sourceBindings.filter(item => item.kind === kind).length]));
  assert.deepEqual(counts, {'fixed-git': 58, 'locked-vendor': 4, generated: 3});
  const template = gitBytes('app/offline/browser/worker-template.js'); assert.equal(prefixed(template), descriptor.workerTemplateSha256);
  const derivedId = 'ipad-web-probe-' + prefixed(jsonBytes({resources: descriptor.resources, workerTemplateSha256: descriptor.workerTemplateSha256})).slice(7, 31);
  assert.equal(derivedId, bundleId);
  const sw = await readFile(new URL('sw.js', release)); assert.equal(hash(sw), expected.swSHA);
  equal(sw, Buffer.from(template.toString('utf8').replace('__BUNDLE_DESCRIPTOR__', JSON.stringify(descriptor))), 'Embedded service worker exact reconstruction');
  equal(await readFile(new URL('docs/平板完整操作手册.md', extracted)), manualBytes, 'Archive/runtime manual bytes');
  assert.deepEqual(await readdir(new URL('site/releases/', extracted)), [bundleId]);

  const edges = [], dynamicImports = [], workerConstructors = [], modules = [];
  for (const path of paths) if (path.endsWith('.mjs')) {
    const text = await readFile(new URL(path, release), 'utf8'), module = new vm.SourceTextModule(text, {identifier: path}); modules.push(path);
    for (const specifier of module.dependencySpecifiers) {
      if (specifier.startsWith('node:')) {edges.push({from: path, specifier, kind: 'node-only'}); continue;}
      assert(specifier.startsWith('.')); const target = posix.normalize(posix.join(posix.dirname(path), specifier));
      assert(paths.has(target), `${path} missing static dependency ${target}`); edges.push({from: path, specifier, target, kind: 'browser-static'});
    }
    for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
      const specifier = match[1]; if (specifier.startsWith('node:')) {dynamicImports.push({from: path, specifier, kind: 'node-only'}); continue;}
      const target = posix.normalize(posix.join(posix.dirname(path), specifier)); assert(specifier.startsWith('.') && paths.has(target));
      dynamicImports.push({from: path, specifier, target, kind: 'browser-dynamic'});
    }
    for (const match of text.matchAll(/new Worker\(new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\)/gu)) {
      const target = posix.normalize(posix.join(posix.dirname(path), match[1])); assert(paths.has(target)); workerConstructors.push({from: path, target});
    }
  }
  const {ISOLATED_WORKER_PATHS} = await import(new URL('app/offline/browser/trust.mjs', repo));
  assert.deepEqual([...ISOLATED_WORKER_PATHS], ['compiler/src/compiler-worker.mjs', 'compiler/src/completion-worker.mjs', 'debugger/src/debugger-worker.mjs']);
  for (const path of ISOLATED_WORKER_PATHS) assert(paths.has(path) && candidate.resources.some(item => item.relativePath === path) && workerConstructors.some(item => item.target === path));
  for (const path of ['compiler/src/completion-semantics.mjs', 'compiler/resources/completion-semantics-v1.md', 'compiler/resources/completion-semantics-v1.cpp.patch']) assert(paths.has(path));
  assert(candidate.resources.some(item => item.relativePath === 'compiler/src/completion-semantics.mjs'));

  const runtimeRoots = ['compiler/src', 'compiler/resources/toolchain.lock.json', 'debugger/src', 'debugger/resources', 'ui/src', 'storage/src',
    'contracts/protocol.d.ts', 'contracts/completion.d.ts', 'contracts/invariants.mjs', 'contracts/source-hash-vectors.json'];
  assert.equal(gitText('diff', backendBaseline, revision, '--', ...runtimeRoots), '', 'Runtime/API bytes changed from independently tested repair');
  const dependencyBindings = [];
  for (const item of candidate.resources) {
    const path = item.relativePath;
    if (tracked.has(path)) {equal(gitBytes(path, backendBaseline), gitBytes(path), `${path} fixed repair source`);
      dependencyBindings.push({path, sha256: item.sha256, baselineBlob: gitText('rev-parse', `${backendBaseline}:${path}`), targetBlob: gitText('rev-parse', `${revision}:${path}`), unchanged: true});}
    else dependencyBindings.push({path, sha256: item.sha256, lockedVendor: true, unchanged: true});
  }
  const uiRoots = ['ui/src', 'storage/src', 'ui/probe.html', 'ui/style.css'];
  assert.equal(gitText('diff', uiBaseline, revision, '--', ...uiRoots), '', 'Prior tested UI runtime bytes changed');
  const priorCapabilities = JSON.parse(gitBytes('contracts/capabilities.json', backendBaseline));
  const normalizedCapabilities = structuredClone(capabilities), normalizedPrior = structuredClone(priorCapabilities);
  delete normalizedCapabilities.updatedAt; delete normalizedPrior.updatedAt;
  for (const version of [normalizedCapabilities, normalizedPrior]) {
    const record = version.capabilities.find(item => item.id === 'editor-code-completion');
    assert.equal(record.status, 'implemented-unverified'); delete record.evidence; delete record.implementationScope;
  }
  assert.deepEqual(normalizedCapabilities, normalizedPrior, 'Only date/evidence/implementation scope metadata may change');
  const oldPackage = JSON.parse(gitBytes('package.json', backendBaseline)), newPackage = JSON.parse(gitBytes('package.json'));
  assert.equal(oldPackage.version, '0.4.6'); assert.equal(newPackage.version, '0.4.7');
  const packageNormalized = structuredClone(newPackage); packageNormalized.version = oldPackage.version;
  assert.deepEqual(packageNormalized, oldPackage);
  const oldLock = JSON.parse(gitBytes('package-lock.json', backendBaseline)), newLock = JSON.parse(gitBytes('package-lock.json'));
  const lockNormalized = structuredClone(newLock); lockNormalized.version = oldLock.version; lockNormalized.packages[''].version = oldLock.packages[''].version;
  assert.deepEqual(lockNormalized, oldLock);

  const setupArchive = zip.sourceArchive.replace('ipad-offline-debugger-v0.4.7.zip', 'ipad-first-setup-v0.4.7.zip');
  const setupRaw = execFileSync('python', [fileURLToPath(new URL('tests/lib/inspect-v047-zip.py', repo)), setupArchive],
    {encoding: 'utf8', env: {...process.env, PYTHONIOENCODING: 'utf-8'}, maxBuffer: 16 * 1024 * 1024});
  const setup = JSON.parse(setupRaw); assert.equal(setup.fileCount, 6); assert.equal(setup.zipBytes, 18056); assert.equal(setup.zipSHA256, expected.setupSHA);
  await save(`setup-zip-${run}.json`, setup);
  // Read ZIP payloads through a separate Python ZipFile call, returning ASCII JSON.
  const setupData = JSON.parse(execFileSync('python', ['-c', 'import zipfile,json,base64,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({i.filename:base64.b64encode(z.read(i)).decode("ascii") for i in z.infolist() if not i.is_dir()}))', setupArchive], {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024}));
  const setupManifest = JSON.parse(Buffer.from(setupData['SHA256SUMS.json'], 'base64'));
  assert.equal(setupManifest.length, 5);
  assert.deepEqual(Object.keys(setupData).sort(), [...setupManifest.map(item => item.path), 'SHA256SUMS.json'].sort());
  for (const item of setupManifest) {const bytes = Buffer.from(setupData[item.path], 'base64'); assert.equal(bytes.length, item.byteLength); assert.equal(hash(bytes), item.sha256);}
  equal(Buffer.from(setupData['certificates/root-ca.cer'], 'base64'), await readFile(new URL('certificates/root-ca.cer', extracted)), 'Setup/full root certificate');
  equal(Buffer.from(setupData['certificates/root-only.mobileconfig'], 'base64'), await readFile(new URL('certificates/root-only.mobileconfig', extracted)), 'Setup/full public profile');
  equal(Buffer.from(setupData['平板完整操作手册.md'], 'base64'), manualBytes, 'Setup/runtime fixed manual');
  equal(Buffer.from(setupData['本次首次准备说明.md'], 'base64'), await readFile(new URL('本次首次准备说明.md', extracted)), 'Setup/full instructions');
  const certBytes = await readFile(new URL('certificates/root-ca.cer', extracted)), certificate = new X509Certificate(certBytes);
  const mobile = await readFile(new URL('certificates/root-only.mobileconfig', extracted), 'utf8');
  assert.deepEqual([...mobile.matchAll(/<key>PayloadType<\/key><string>([^<]+)<\/string>/gu)].map(item => item[1]), ['com.apple.security.root', 'Configuration']);
  const embedded = [...mobile.matchAll(/<key>PayloadContent<\/key><data>([^<]+)<\/data>/gu)]; assert.equal(embedded.length, 1);
  equal(Buffer.from(embedded[0][1], 'base64'), certBytes, 'Single public root payload');
  assert(!zip.members.some(item => /\.(key|p12|pfx)$/iu.test(item.name) || /private[-_]key/iu.test(item.name)));
  const instructions = await readFile(new URL('本次首次准备说明.md', extracted), 'utf8'); assert(instructions.includes(bundleId) && instructions.includes('0.4.7'));
  const build = await parse(new URL('build.json', extracted)); assert.equal(build.sourceBaseRevision, revision); assert.equal(build.bundleId, bundleId);
  assert.equal(build.resourceCount, 65); assert.equal(build.totalBytes, descriptor.totalBytes);
  const smallBuild = JSON.parse(Buffer.from(setupData['build.json'], 'base64')); assert.deepEqual(smallBuild, build);
  assert.equal(gitText('rev-parse', 'HEAD'), revision); assert.equal(gitText('diff', revision, '--', ...productPaths), '');
  const report = {schemaVersion: 1, startedAt, finishedAt: new Date().toISOString(), passed: true, testedRevision: revision,
    archive: {sourceArchive: zip.sourceArchive, byteLength: expected.zipBytes, sha256: expected.zipSHA, memberCount: 74, verifiedManifestEntries: 73,
      pathsValidatedBeforeExtraction: true, sourceZIPUnchanged: true},
    bundle: {bundleId, compatibilityId: profileId, resourceCount: 65, totalBytes: descriptor.totalBytes,
      resourceManifestHash: descriptor.resourceManifestHash, descriptorSHA256: hash(descriptorBytes), workerSHA256: hash(sw), workerTemplateSHA256: hash(template)},
    sourceBindingCounts: counts, sourceBindings, imports: {modulesParsed: modules.length, browserStaticEdges: edges.filter(item => item.kind === 'browser-static').length, edges, dynamicImports, missingBrowserDependencies: 0},
    workers: {isolatedWorkerPaths: [...ISOLATED_WORKER_PATHS], constructors: workerConstructors, allPackagedAndTrusted: true},
    reuse: {semanticBaseline: backendBaseline, uiBaseline, runtimeRoots, uiRoots, runtimeAndApiDiff: '', uiRuntimeDiff: '', dependencyBindings,
      capabilityMetadataDiff: gitText('diff', backendBaseline, revision, '--', 'contracts/capabilities.json'),
      packageChange: '0.4.6 to 0.4.7 version metadata only; dependency graph and scripts unchanged',
      scope: 'Prior 88/27/lifecycle and byte-identical controlled UI evidence may be reused. Actual new package/browser workflow remains separate.'},
    setup: {archive: setup.sourceArchive, byteLength: setup.zipBytes, sha256: setup.zipSHA256, memberCount: 6, verifiedManifestEntries: 5, manualAndPublicCertificateMatchFullPackage: true},
    certificate: {ca: certificate.ca, validFrom: certificate.validFrom, validTo: certificate.validTo, onlyPublicRoot: true, installedOrTrusted: false},
    extraction: {siteRoot: zip.staticSiteRoot, entryPath: `/releases/${bundleId}/index.html`},
    encodingNote: 'Original extraction stdout used the host default Python encoding, affecting only JSON Chinese path display. Original output retained; UTF-8 inventory run02 and exact extracted bytes are authoritative.',
    actualClangQueries: 0, actualCompilerCalls: 0, browserTested: false, ipadTested: false, newConfirmedDefects: [], runnerSHA256: hash(await readFile(new URL(import.meta.url)))};
  await save('report.json', report);
  console.log(JSON.stringify({passed: true, archiveMembers: 74, descriptorResources: 65, sourceBindingCounts: counts,
    browserStaticEdges: report.imports.browserStaticEdges, workers: 3, setupMembers: 6, reuse: true, siteRoot: zip.staticSiteRoot}));
} catch (error) {
  await save(`failure-${run}.json`, {startedAt, finishedAt: new Date().toISOString(), message: error.message, code: error.code, stack: error.stack});
  throw error;
}
