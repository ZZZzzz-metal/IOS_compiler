/** Draft JSON protocol. All identifiers are opaque; numeric C/C++ values travel as strings. */
export type Hash = `sha256:${string}`;
export type SourceRole = 'user' | 'driver' | 'generated';
export interface SourceFile { path: string; role: SourceRole; text: string; contentHash: Hash }
export interface SourceSnapshot {
  snapshotId: string; sourceHash: Hash; encoding: 'utf-8'; newline: 'lf';
  translationUnit: string; files: SourceFile[];
}
export interface Position { sourcePath: string; line: number; column: number }
export interface SourceRange { start: Position; end?: Position }
export interface SourceMapping { generated: SourceRange; original: SourceRange }
export interface Diagnostic {
  severity: 'note' | 'warning' | 'error' | 'fatal'; message: string;
  range?: SourceRange; code?: string; related?: { message: string; range: SourceRange }[];
}
export interface ResourceRef {
  id: string; relativePath: string; sha256: Hash; byteLength: number;
  mediaType: string; version: string;
}
export interface Component { id: string; version: string; buildHash: Hash }
export interface CompatibilityProfile {
  compatibilityId: string; protocolVersion: '0.1.0-draft.1';
  compiler: Component; linker: Component; sysroot: Component; standardLibrary: Component;
  runtime: Component; debugger: Component;
  targetTriple: string; abi: string; addressBits: 32 | 64; endianness: 'little' | 'big';
  artifactFormat: string; debugInfoFormat: string; requiredFeatures: string[];
  resourceManifestHash: Hash;
  status: 'candidate' | 'verified-ipad'; evidence: string[];
}
export type Language = { language: 'c'; standard: 'c11' } | { language: 'cpp'; standard: 'c++17' };
export type CompileRequest = Language & {
  requestId: string; snapshot: SourceSnapshot; compatibilityId: string;
  mode: 'run' | 'debug'; optimization: 'O0';
};
export interface BuildManifest {
  buildId: string; requestId: string; sourceHash: Hash; snapshotId: string;
  profile: CompatibilityProfile; mode: 'run' | 'debug'; language: Language;
  compilerArguments: string[]; linkerArguments: string[];
  executable: ResourceRef; debugInfo: ResourceRef[]; sourceMappings: SourceMapping[];
}
export type CompileResult =
  | { requestId: string; sourceHash: Hash; status: 'succeeded'; build: BuildManifest; diagnostics: Diagnostic[] }
  | { requestId: string; sourceHash: Hash; status: 'failed' | 'cancelled'; diagnostics: Diagnostic[]; reason: string };
export interface CompilerAdapter {
  compile(request: CompileRequest): Promise<CompileResult>;
  cancel(requestId: string): Promise<void>;
}
export interface SessionKey { sessionId: string; buildId: string; sourceHash: Hash; compatibilityId: string }
export interface PauseKey extends SessionKey { pauseId: string }
export interface FrameKey extends PauseKey { frameId: string }
export type SessionState = 'created' | 'starting' | 'running' | 'paused' | 'stopping' | 'terminated' | 'failed';
export interface PauseDetails {
  pauseId: string; reason: 'entry' | 'breakpoint' | 'step' | 'user' | 'exception'; position?: Position;
}
export interface TerminationDetails {
  reason: 'exit' | 'stop' | 'trap' | 'resource-limit' | 'background'; exitCode?: number; message?: string;
}
export interface SessionSnapshot extends SessionKey {
  state: SessionState; eventSeq: number; breakpoints: BreakpointBinding[];
  pause?: PauseDetails; termination?: TerminationDetails; failure?: { code: string; message: string };
  outputTail: { eventSeq: number; stream: 'stdout' | 'stderr'; text: string }[]; outputTruncated: boolean;
}
/** Local client state; not a claim about the runtime. */
export interface ClientSessionView extends SessionKey {
  state: SessionState; eventSeq: number; pauseId?: string; frameId?: string;
  synchronized: boolean; pendingControl: string | null;
}
export interface Limits { runningTimeMs: number; outputBytes: number; variablePageSize: number; memoryBytes?: number }
export interface StartRequest extends SessionKey {
  build: BuildManifest; snapshot: SourceSnapshot;
  stdin: { text: string; encoding: 'utf-8'; eof: true }; mode: 'run' | 'debug'; limits: Limits;
  initialBreakpoints: BreakpointRequest[]; stopOnEntry: boolean;
}
export interface BreakpointRequest { breakpointId: string; requested: Position; enabled: boolean }
export interface BreakpointBinding {
  breakpointId: string; requested: Position; status: 'pending' | 'bound' | 'invalid';
  actual: Position[]; reason?: string;
}
export type DebugCommand = { commandId: string } & (
  | { kind: 'start'; request: StartRequest }
  | { kind: 'setBreakpoints'; key: SessionKey; sourcePath: string; breakpoints: BreakpointRequest[] }
  | { kind: 'continue' | 'stepInto' | 'stepOver' | 'stepOut'; key: PauseKey }
  | { kind: 'pause' | 'stop'; key: SessionKey }
);
export type CommandAck =
  | { commandId: string; accepted: true; key: SessionKey; acceptedAtEventSeq: number; invalidatedPauseId?: string }
  | { commandId: string; accepted: false; code: 'stale-context' | 'invalid-state' | 'unsupported' | 'incompatible-build' | 'resource-error'; message: string };
export interface StackFrame { frameId: string; functionName: string; position?: Position; module: string }
export interface Scope { name: string; variablesReference: string; expensive: boolean }
export type Variable = {
  name: string; type: string; evaluateName?: string; variablesReference?: string;
  namedCount?: number; indexedCount?: number; truncated: boolean;
} & (
  | { availability: 'available'; displayValue: string }
  | { availability: 'unavailable' | 'optimizedOut' | 'outOfScope' | 'unsupported' | 'error'; reason: string }
);
export type Query = { requestId: string } & (
  | { kind: 'stack'; key: PauseKey; start: number; count: number }
  | { kind: 'scopes'; key: FrameKey }
  | { kind: 'variables'; key: FrameKey; variablesReference: string; start: number; count: number }
  | { kind: 'evaluate'; key: FrameKey; expression: string; allowSideEffects: false }
);
export type QueryReply = { requestId: string } & (
  | { kind: 'stack'; key: PauseKey; frames: StackFrame[]; total: number }
  | { kind: 'scopes'; key: FrameKey; scopes: Scope[] }
  | { kind: 'variables'; key: FrameKey; variables: Variable[]; total?: number; hasMore: boolean }
  | { kind: 'evaluate'; key: FrameKey; result: Variable }
  | { kind: 'error'; key: PauseKey | FrameKey; code: string; message: string }
);
export type DebugEvent = SessionKey & { eventSeq: number } & (
  | { kind: 'state'; state: Exclude<SessionState, 'paused' | 'terminated' | 'failed'> }
  | { kind: 'breakpoints'; bindings: BreakpointBinding[] }
  | { kind: 'paused'; pauseId: string; reason: 'entry' | 'breakpoint' | 'step' | 'user' | 'exception'; position?: Position }
  | { kind: 'output'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'output-truncated'; droppedBytes: number }
  | { kind: 'terminated'; reason: 'exit' | 'stop' | 'trap' | 'resource-limit' | 'background'; exitCode?: number; message?: string }
  | { kind: 'error'; fatal: boolean; code: string; message: string }
);
export interface DebuggerAdapter {
  command(command: DebugCommand): Promise<CommandAck>;
  query(query: Query): Promise<QueryReply>;
  resync(request: { requestId: string; key: SessionKey }): Promise<{ requestId: string; snapshot: SessionSnapshot }>;
  subscribe(listener: (event: DebugEvent) => void): () => void;
}
export interface Draft { id: string; revision: number; userText: string; driverText: string; language: Language; stdin: string; updatedAt: string }
export interface StorageAdapter {
  load(id: string): Promise<Draft | null>;
  save(draft: Draft, expectedRevision: number | null): Promise<{ revision: number }>;
  export(id: string, mode: 'user-source' | 'complete-project'): Promise<{ filename: string; mediaType: string; text: string }>;
}
export type CapabilityStatus = 'planned' | 'implemented-unverified' | 'verified' | 'unsupported';
export interface Capability { id: string; requirement: string; owner: number[]; status: CapabilityStatus; scope: string; evidence: string[] }
export type ResourceRole = 'ui' | 'compiler' | 'linker' | 'sysroot' | 'stdlib' | 'runtime' | 'debugger';
export interface OfflineBundle {
  schemaVersion: 1; bundleId: string; protocolVersion: '0.1.0-draft.1';
  compatibilityId: string | null; status: 'unprepared' | 'staging' | 'active';
  requiredRoles: ResourceRole[];
  resources: (ResourceRef & { roles: ResourceRole[]; licenseFile: string; sourceURL: string })[];
}
