// Node-only test packaging. This candidate is NOT a shared/approved iPad profile.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import {digest,manifestHash,virtualPath} from '../src/integrity.mjs';
export const MODULE_FILES=['debugger/src/wasm-runtime.mjs','debugger/src/dwarf.mjs','debugger/src/variables.mjs',
  'debugger/src/integrity.mjs','debugger/src/debugger-adapter.mjs','debugger/src/worker-adapter.mjs',
  'debugger/src/worker-bridge.mjs','debugger/src/debugger-worker.mjs','debugger/LICENSE'];
const root=new URL('../../',import.meta.url);
const rootPath=fileURLToPath(root);
const version='0.1.0-prototype.1';
export async function createCandidate({fixture='debug-handoff'}={}) {
  if(!['debug-handoff','stdio','stl','infinite','trap','output-flood','containers'].includes(fixture))throw new Error('Unknown actual fixture');
  const resources=[];
  for(const path of MODULE_FILES) {
    const bytes=await readFile(new URL(path,root));
    resources.push({id:path,relativePath:path,sha256:await digest(bytes),byteLength:bytes.byteLength,
      mediaType:path.endsWith('.mjs')?'text/javascript':'text/plain',version,
      roles:path.includes('wasm-runtime')?['runtime']:['debugger'],licenseFile:'debugger/LICENSE',
      sourceURL:'local-source:module/03-debugger/'+path});
  }
  const json=async file=>JSON.parse(await readFile(new URL(`debugger/fixtures/${fixture}/${file}`,root),'utf8'));
  const snapshot=await json('snapshot.json'),evidence=await json('evidence.json');
  const profile={compatibilityId:'debugger-prototype-'+(await manifestHash(resources)).slice(7,23),protocolVersion:'0.1.0-draft.1',
    compiler:{id:evidence.toolchainId+'/clang',version:'8.0.1',buildHash:evidence.compilerResourceHash},
    linker:{id:evidence.toolchainId+'/lld',version:'8.0.1',buildHash:evidence.linkerResourceHash},
    sysroot:{id:evidence.toolchainId+'/sysroot',version:'648c4a89997a',buildHash:evidence.sysrootResourceHash},
    standardLibrary:{id:evidence.toolchainId+'/libc++-std::__2',version:'648c4a89997a',buildHash:evidence.sysrootResourceHash},
    runtime:{id:'project-js-wasm-interpreter',version,buildHash:resources.find(r=>r.relativePath.endsWith('/wasm-runtime.mjs')).sha256},
    debugger:{id:'project-dwarf4-debugger',version,buildHash:resources.find(r=>r.relativePath.endsWith('/debugger-adapter.mjs')).sha256},
    ...evidence.target,resourceManifestHash:await manifestHash(resources),status:'candidate',
    evidence:['Desktop candidate; only module runtime/debugger resources are verified here. Full offline bundle and iPad remain unverified.']};
  const executable={...evidence.executableRef,relativePath:`debugger/fixtures/${fixture}/main.wasm`};
  const build={buildId:`debugger-probe-${evidence.artifactId}`,requestId:evidence.requestId,sourceHash:snapshot.sourceHash,
    snapshotId:snapshot.snapshotId,profile,mode:'debug',language:evidence.language,
    compilerArguments:evidence.compilerArguments,linkerArguments:evidence.linkerArguments,
    executable,debugInfo:[executable],sourceMappings:[]};
  const readResource=async path=>{
    virtualPath(path);const target=resolve(rootPath,...path.split('/'));
    if(!target.startsWith(rootPath.endsWith(sep)?rootPath:rootPath+sep))throw new Error('Resource outside project');
    return new Uint8Array(await readFile(target));
  };
  return {profile,resources,readResource,build,snapshot,evidence};
}
