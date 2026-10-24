import { CompilerProbe } from './compiler-probe.mjs';
import { digest, TARGET } from './toolchain-engine.mjs';
import { inspectWasm, assertDebugSections } from './wasm-inspect.mjs';

// This constructor requires an integrator-supplied, trusted, complete combination.
// We never invent runtime/debugger identities to label a compiler probe a product build.
export class CompilerAdapter {
  constructor({ profile, lock, writeResource, ...workerOptions }) {
    if (typeof writeResource !== 'function') throw new Error('Artifact persistence is required');
    if (profile?.protocolVersion !== '0.1.0-draft.1' || !profile.compatibilityId) throw new Error('A complete trusted compatibility profile is required');
    for (const key of ['compiler', 'linker', 'sysroot', 'standardLibrary', 'runtime', 'debugger']) {
      const component = profile[key];
      if (!component?.id || !component.version || !/^sha256:[a-f0-9]{64}$/u.test(component.buildHash)) throw new Error(`Missing profile component: ${key}`);
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(profile.resourceManifestHash)) throw new Error('Missing trusted resource manifest hash');
    for (const [key, name] of [['compiler', 'clang'], ['linker', 'lld'], ['sysroot', 'sysroot.tar'], ['standardLibrary', 'sysroot.tar']]) {
      const entry = lock.files.find(file => file.filename === name);
      if (profile[key].buildHash !== `sha256:${entry?.sha256}`) throw new Error(`Profile does not match pinned ${key}`);
    }
    for (const key of ['targetTriple', 'abi', 'addressBits', 'endianness', 'artifactFormat', 'debugInfoFormat']) {
      if (profile[key] !== TARGET[key]) throw new Error(`Unsupported profile ${key}`);
    }
    if (JSON.stringify([...profile.requiredFeatures].sort()) !== JSON.stringify([...TARGET.requiredFeatures].sort())) throw new Error('Unsupported Wasm feature profile');
    this.profile = structuredClone(profile);
    this.toolchainId = lock.toolchainId;
    this.writeResource = writeResource;
    this.probe = new CompilerProbe(workerOptions);
  }
  compile(request) {
    request = structuredClone(request);
    const fail = message => ({ requestId: request.requestId, sourceHash: request.snapshot?.sourceHash ?? '', status: 'failed', diagnostics: [{ severity: 'error', message }], reason: 'incompatible-build' });
    if (request.compatibilityId !== this.profile.compatibilityId) return Promise.resolve(fail('Compatibility ID does not match the trusted profile'));
    return this.probe.compile(request, { beforeResolve: async evidence => {
      if (evidence.status !== 'compiled') return { requestId: evidence.requestId, sourceHash: evidence.sourceHash, status: evidence.status, diagnostics: evidence.diagnostics, reason: evidence.reason };
      if (evidence.requestId !== request.requestId || evidence.sourceHash !== request.snapshot.sourceHash || evidence.snapshotId !== request.snapshot.snapshotId || evidence.mode !== request.mode ||
          evidence.language?.language !== request.language || evidence.language?.standard !== request.standard) throw new Error('Artifact does not belong to the requested source, language and mode');
      for (const key of Object.keys(TARGET)) {
        if (JSON.stringify(evidence.target?.[key]) !== JSON.stringify(TARGET[key])) throw new Error(`Artifact target mismatch: ${key}`);
      }
      if (evidence.compilerResourceHash !== this.profile.compiler.buildHash || evidence.linkerResourceHash !== this.profile.linker.buildHash || evidence.sysrootResourceHash !== this.profile.sysroot.buildHash) throw new Error('Worker toolchain does not match the trusted profile');
      if (evidence.toolchainId !== this.toolchainId || evidence.executableRef?.version !== this.toolchainId) throw new Error('Artifact toolchain version mismatch');
      if (!(evidence.executable instanceof Uint8Array) || evidence.executable.length !== evidence.executableRef?.byteLength || await digest(evidence.executable) !== evidence.executableRef.sha256) throw new Error('Artifact integrity mismatch');
      const expectedId = `wasm-${evidence.executableRef.sha256.slice(7)}`;
      if (evidence.artifactId !== expectedId || evidence.executableRef.id !== expectedId || evidence.executableRef.relativePath !== `compiler-builds/${expectedId}/main.wasm` || evidence.executableRef.mediaType !== 'application/wasm') throw new Error('Artifact resource identity mismatch');
      if (!WebAssembly.validate(evidence.executable)) throw new Error('Invalid Wasm artifact');
      if (request.mode === 'debug') assertDebugSections(inspectWasm(evidence.executable));
      await this.writeResource(evidence.executableRef.relativePath, evidence.executable);
      const buildId = `build-${crypto.randomUUID()}`;
      return { status: 'succeeded', requestId: request.requestId, sourceHash: evidence.sourceHash, diagnostics: evidence.diagnostics,
        build: { buildId, requestId: request.requestId, sourceHash: evidence.sourceHash, snapshotId: evidence.snapshotId,
          profile: structuredClone(this.profile), mode: evidence.mode, language: evidence.language,
          compilerArguments: evidence.compilerArguments, linkerArguments: evidence.linkerArguments,
          executable: evidence.executableRef, debugInfo: evidence.mode === 'debug' ? [evidence.executableRef] : [], sourceMappings: evidence.sourceMappings,
        },
      };
    }});
  }
  cancel(requestId) { return this.probe.cancel(requestId); }
}
