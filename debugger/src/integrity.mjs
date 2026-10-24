// Browser implementation of the shared 0.1.0-draft.1 identity rules.
export const PROTOCOL_VERSION = '0.1.0-draft.1';
const encoder = new TextEncoder();
export const copy = value => structuredClone(value);
export async function digest(bytes) {
  if (typeof bytes === 'string') bytes = encoder.encode(bytes);
  const result = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(result), b => b.toString(16).padStart(2, '0')).join('');
}
export function virtualPath(path) {
  if (typeof path !== 'string' || !path || !path.isWellFormed() || /[\\:\u0000]/u.test(path) ||
      path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid virtual resource/source path');
  return path;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
export const technical = value => {
  const {status, evidence, ...identity} = value ?? {};
  return identity;
};
export async function manifestHash(resources) {
  const entries = resources.map(r => ({id:r.id, relativePath:r.relativePath, sha256:r.sha256,
    byteLength:r.byteLength, mediaType:r.mediaType, version:r.version, roles:[...r.roles].sort(),
    licenseFile:r.licenseFile, sourceURL:r.sourceURL})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return digest(JSON.stringify({version:1,resources:entries}));
}
export async function verifyStart(request, profile, resources, readResource, checkCancelled=()=>{}) {
  if (!profile || profile.protocolVersion !== PROTOCOL_VERSION || !profile.compatibilityId ||
      !same(technical(request.build?.profile), technical(profile))) throw new Error('Incompatible build profile');
  for (const name of ['compiler','linker','sysroot','standardLibrary','runtime','debugger']) {
    const component=profile[name];
    if (!component?.id || !component.version || !/^sha256:[0-9a-f]{64}$/u.test(component.buildHash)) throw new Error('Incomplete component identity: '+name);
  }
  if (profile.targetTriple !== 'wasm32-unknown-wasi' || profile.abi !== 'wasi_unstable' ||
      profile.addressBits !== 32 || profile.endianness !== 'little' || profile.artifactFormat !== 'wasm-v1' ||
      profile.debugInfoFormat !== 'dwarf-4-embedded' || !Array.isArray(profile.requiredFeatures) ||
      profile.requiredFeatures.some(f=>!['mvp','mutable-globals'].includes(f))) throw new Error('Unsupported runtime target, ABI or feature');
  const {build,snapshot}=request;
  if (!snapshot || snapshot.encoding !== 'utf-8' || snapshot.newline !== 'lf' || !snapshot.snapshotId ||
      !Array.isArray(snapshot.files) || snapshot.files.length === 0 || snapshot.files.length > 128) throw new Error('Invalid source snapshot');
  virtualPath(snapshot.translationUnit);
  const paths=new Set();
  const files=[];
  for (const file of snapshot.files) {
    virtualPath(file.path);
    if(paths.has(file.path) || !['user','driver','generated'].includes(file.role) || typeof file.text !== 'string' ||
      !file.text.isWellFormed() || file.text.startsWith('\uFEFF') || file.text.includes('\r')) throw new Error('Noncanonical snapshot file');
    paths.add(file.path);
    if (await digest(file.text) !== file.contentHash) throw new Error('Source file checksum mismatch');
    checkCancelled();
    files.push({path:file.path,role:file.role,text:file.text});
  }
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if(!paths.has(snapshot.translationUnit) || !same(files.map(f=>f.path),snapshot.files.map(f=>f.path)) ||
    await digest(JSON.stringify({version:1,translationUnit:snapshot.translationUnit,files})) !== snapshot.sourceHash) throw new Error('Snapshot integrity mismatch');
  if(!request.sessionId || !build.buildId || !build.requestId || request.buildId !== build.buildId ||
    request.sourceHash !== build.sourceHash || build.sourceHash !== snapshot.sourceHash ||
    build.snapshotId !== snapshot.snapshotId || request.compatibilityId !== profile.compatibilityId ||
    !['run','debug'].includes(request.mode) || request.mode !== build.mode) throw new Error('Start context mismatch');
  if(!['c','cpp'].includes(build.language?.language) || build.language.standard !== (build.language.language==='c'?'c11':'c++17') ||
    !Array.isArray(build.compilerArguments) || !Array.isArray(build.linkerArguments) || !Array.isArray(build.sourceMappings) ||
    build.sourceMappings.length !== 0) throw new Error('Unsupported build language or source mappings');
  if(!build.compilerArguments.includes('-O0') || !Array.isArray(build.debugInfo) ||
    request.mode==='debug' && build.debugInfo.length === 0) throw new Error('O0/debug information is required');
  if (!Array.isArray(resources) || resources.length === 0 || await manifestHash(resources) !== profile.resourceManifestHash) throw new Error('Runtime resource manifest mismatch');
  const seenIds=new Set(),seenPaths=new Set();
  for(const resource of resources) {
    virtualPath(resource.relativePath); virtualPath(resource.licenseFile);
    if(!resource.id || seenIds.has(resource.id) || seenPaths.has(resource.relativePath) || !resource.version ||
      !resource.mediaType || !resource.sourceURL || !Array.isArray(resource.roles) ||
      resource.roles.some(r=>!['runtime','debugger','compiler','linker','sysroot','stdlib','ui'].includes(r)) ||
      !resources.some(r=>r.relativePath===resource.licenseFile)) throw new Error('Incomplete or duplicate runtime resource');
    seenIds.add(resource.id);seenPaths.add(resource.relativePath);
  }
  for(const role of ['runtime','debugger']) {
    if(!resources.some(r=>r.roles.includes(role))) throw new Error('Missing module resource role: '+role);
    if(!resources.some(r=>r.roles.includes(role)&&r.sha256===profile[role].buildHash)) throw new Error('Runtime component hash is not in trusted resources: '+role);
  }
  let executable;
  for(const resource of [...resources,build.executable,...build.debugInfo]) {
    virtualPath(resource.relativePath);
    if(!resource.id || !Number.isSafeInteger(resource.byteLength) || resource.byteLength<0 || resource.byteLength>64*1024*1024 ||
      !/^sha256:[0-9a-f]{64}$/u.test(resource.sha256) || !resource.version || !resource.mediaType) throw new Error('Invalid build resource metadata');
    const bytes=await readResource(resource.relativePath);checkCancelled();
    if(!(bytes instanceof Uint8Array)||bytes.byteLength!==resource.byteLength||await digest(bytes)!==resource.sha256) throw new Error('Resource checksum mismatch: '+resource.id);
    checkCancelled();
    if(resource===build.executable) executable=bytes.slice();
  }
  if(request.mode==='debug' && !build.debugInfo.some(r=>r.sha256===build.executable.sha256 && r.relativePath===build.executable.relativePath)) throw new Error('Only embedded DWARF in the checked executable is supported');
  return executable;
}
