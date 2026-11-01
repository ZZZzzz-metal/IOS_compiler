// Development combination only. This does not select an iPad product route.
import { readFile } from 'node:fs/promises';
import { hashBytes, hashResourceManifest, assertVirtualPath, PROTOCOL_VERSION } from '../../contracts/invariants.mjs';
import { MODULE_FILES } from '../../debugger/scripts/candidate.mjs';
import { TARGET } from '../../compiler/src/toolchain-engine.mjs';

const root = new URL('../../', import.meta.url);
export const COMPILER_MODULE_FILES = [
  'compiler/src/compiler-adapter.mjs', 'compiler/src/compiler-probe.mjs',
  'compiler/src/compiler-worker.mjs', 'compiler/src/toolchain-engine.mjs',
  'compiler/src/completion-adapter.mjs', 'compiler/src/completion-worker.mjs',
  'compiler/src/completion-engine.mjs', 'compiler/src/completion-source.mjs',
  'compiler/src/completion-output.mjs', 'compiler/src/completion-semantics.mjs',
  'compiler/src/wasm-host.mjs', 'compiler/src/wasm-inspect.mjs',
  'compiler/src/source.mjs', 'compiler/src/diagnostics.mjs',
  'compiler/resources/toolchain.lock.json', 'compiler/resources/LICENSES.md',
];

export async function createIntegrationCandidate() {
  const readResource = async path => {
    assertVirtualPath(path);
    const url = new URL(path, root);
    if (!url.href.startsWith(root.href)) throw new Error('Resource escaped integration root');
    return new Uint8Array(await readFile(url));
  };
  const lock = JSON.parse(await readFile(new URL('compiler/resources/toolchain.lock.json', root), 'utf8'));
  const resources = [];
  const add = async (path, roles, version, licenseFile, sourceURL, pinned) => {
    const bytes = await readResource(path), sha256 = hashBytes(bytes);
    if (pinned && (bytes.length !== pinned.byteLength || sha256 !== `sha256:${pinned.sha256}`)) {
      throw new Error(`Pinned toolchain resource mismatch: ${path}`);
    }
    resources.push({ id: path, relativePath: path, sha256, byteLength: bytes.length,
      mediaType: path.endsWith('.mjs') ? 'text/javascript' : path.endsWith('.json') ? 'application/json' : 'application/octet-stream',
      version, roles, licenseFile, sourceURL });
  };
  for (const path of MODULE_FILES) {
    await add(path, path.endsWith('/wasm-runtime.mjs') ? ['runtime'] : ['debugger'],
      '0.1.0-prototype.1', 'debugger/LICENSE', `local-source:module/03-debugger/${path}`);
  }
  const license = 'compiler/resources/LICENSES.md';
  for (const path of COMPILER_MODULE_FILES) {
    await add(path, ['compiler'], '0.1.0-prototype.1', license, `local-source:module/02-compiler/${path}`);
  }
  for (const file of lock.files) {
    const roles = file.filename === 'clang' ? ['compiler'] : file.filename === 'lld' ? ['linker'] :
      file.filename === 'sysroot.tar' ? ['sysroot', 'stdlib'] : ['compiler'];
    await add(`compiler/resources/${lock.vendorDirectory}/${file.filename}`, roles, lock.toolchainId, license, file.url, file);
  }
  const resourceManifestHash = hashResourceManifest(resources);
  const component = (name, filename, version) => ({
    id: `${lock.toolchainId}/${name}`, version,
    buildHash: `sha256:${lock.files.find(file => file.filename === filename).sha256}`,
  });
  const profile = {
    compatibilityId: `integration-prototype-${resourceManifestHash.slice(7, 23)}`,
    protocolVersion: PROTOCOL_VERSION,
    compiler: component('clang', 'clang', '8.0.1'),
    linker: component('lld', 'lld', '8.0.1'),
    sysroot: component('sysroot', 'sysroot.tar', lock.toolchainId),
    standardLibrary: component('libc++-std::__2', 'sysroot.tar', lock.toolchainId),
    runtime: { id: 'project-js-wasm-interpreter', version: '0.1.0-prototype.1', buildHash: resources.find(r => r.relativePath.endsWith('/wasm-runtime.mjs')).sha256 },
    debugger: { id: 'project-dwarf4-debugger', version: '0.1.0-prototype.1', buildHash: resources.find(r => r.relativePath.endsWith('/debugger-adapter.mjs')).sha256 },
    ...TARGET, resourceManifestHash, status: 'candidate',
    evidence: ['Development integration of modules 02/03 only; iPad, UI, installation and distribution provenance remain unverified.'],
  };
  return { profile, resources, lock, baseURL: root.href, readResource };
}
