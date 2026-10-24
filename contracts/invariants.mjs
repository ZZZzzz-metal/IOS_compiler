// Development reference checks. These do not implement compilation or debugging.
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export const PROTOCOL_VERSION = '0.1.0-draft.1';
export const REQUIRED_ROLES = ['ui', 'compiler', 'linker', 'sysroot', 'stdlib', 'runtime', 'debugger'];
export const hashBytes = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export function assertVirtualPath(path) {
  if (typeof path !== 'string' || !path || !path.isWellFormed() || /[\\:\u0000]/u.test(path) ||
      path.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid virtual path: ${String(path)}`);
  }
  return path;
}

export function createSnapshot(files, translationUnit) {
  assertVirtualPath(translationUnit);
  if (!Array.isArray(files) || files.length === 0) throw new Error('Snapshot needs files');
  const paths = new Set();
  const normalized = files.map(file => {
    const path = assertVirtualPath(file.path);
    if (paths.has(path)) throw new Error(`Duplicate source path: ${path}`);
    paths.add(path);
    if (!['user', 'driver', 'generated'].includes(file.role)) throw new Error('Invalid source role');
    if (typeof file.text !== 'string' || !file.text.isWellFormed()) throw new Error('Source must be well-formed Unicode');
    const text = file.text.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
    return { path, role: file.role, text };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!paths.has(translationUnit)) throw new Error('Translation unit is missing');
  const canonical = JSON.stringify({ version: 1, translationUnit, files: normalized });
  return {
    snapshotId: randomUUID(), sourceHash: hashBytes(canonical), encoding: 'utf-8', newline: 'lf',
    translationUnit,
    files: normalized.map(file => ({ ...file, contentHash: hashBytes(file.text) })),
  };
}

export function assertBuildIdentity(build, snapshot, profile) {
  const actual = createSnapshot(snapshot.files, snapshot.translationUnit);
  if (snapshot.encoding !== 'utf-8' || snapshot.newline !== 'lf' || actual.sourceHash !== snapshot.sourceHash ||
      !isDeepStrictEqual(actual.files, snapshot.files)) throw new Error('Snapshot integrity mismatch');
  if (!build.buildId || build.sourceHash !== snapshot.sourceHash || build.snapshotId !== snapshot.snapshotId) {
    throw new Error('Build does not belong to snapshot');
  }
  const technical = value => {
    const { status, evidence, ...identity } = value ?? {};
    return identity;
  };
  if (!profile?.compatibilityId || profile.protocolVersion !== PROTOCOL_VERSION ||
      !isDeepStrictEqual(technical(build.profile), technical(profile))) throw new Error('Incompatible build profile');
  if (build.mode === 'debug' && !build.debugInfo?.length) throw new Error('Debug information is missing');
  return true;
}

const identityKeys = ['sessionId', 'buildId', 'sourceHash', 'compatibilityId'];
export function checkEventContext(current, event) {
  if (identityKeys.some(key => !current[key] || event[key] !== current[key])) return { accepted: false, reason: 'stale-session' };
  if (current.synchronized !== true) return { accepted: false, reason: 'desynchronized' };
  if (['terminated', 'failed'].includes(current.state)) return { accepted: false, reason: 'terminal-session' };
  if (!Number.isSafeInteger(current.eventSeq) || current.eventSeq < 0 ||
      !Number.isSafeInteger(event.eventSeq) || event.eventSeq < 1) return { accepted: false, reason: 'invalid-sequence' };
  if (event.eventSeq <= current.eventSeq) return { accepted: false, reason: 'old-sequence' };
  if (event.eventSeq !== current.eventSeq + 1) return { accepted: false, reason: 'sequence-gap' };
  return { accepted: true };
}

export function matchesPause(current, replyKey) {
  return current.synchronized === true && current.pendingControl === null &&
    current.state === 'paused' && Boolean(current.pauseId) &&
    [...identityKeys, 'pauseId'].every(key => Boolean(current[key]) && current[key] === replyKey[key]) &&
    (replyKey.frameId === undefined || (Boolean(current.frameId) && current.frameId === replyKey.frameId));
}

export function invalidatePause(current, pendingControl = null) {
  return { ...current, pauseId: undefined, frameId: undefined, pendingControl };
}

export function markDesynchronized(current) {
  return { ...invalidatePause(current), synchronized: false };
}

/** Binds all resource bytes and metadata to a trusted, immutable compatibility profile. */
export function hashResourceManifest(resources) {
  const entries = resources.map(resource => ({
    id: resource.id, relativePath: resource.relativePath, sha256: resource.sha256,
    byteLength: resource.byteLength, mediaType: resource.mediaType, version: resource.version,
    roles: [...resource.roles].sort(), licenseFile: resource.licenseFile, sourceURL: resource.sourceURL,
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return hashBytes(JSON.stringify({ version: 1, resources: entries }));
}

/** Identity/byte gate only: runtime initialization and breakpoint binding still need a real adapter. */
export async function verifyStartResources(request, profile, readResource) {
  assertBuildIdentity(request.build, request.snapshot, profile);
  if (!request.sessionId || request.buildId !== request.build.buildId ||
      request.sourceHash !== request.snapshot.sourceHash || request.compatibilityId !== profile.compatibilityId ||
      request.mode !== request.build.mode) throw new Error('Start context mismatch');
  if (!Array.isArray(request.initialBreakpoints) || typeof request.stopOnEntry !== 'boolean') throw new Error('Initial breakpoint configuration is missing');
  if (request.stdin?.encoding !== 'utf-8' || request.stdin.eof !== true || typeof request.stdin.text !== 'string') throw new Error('Complete stdin and EOF are required');
  const resources = [request.build.executable, ...request.build.debugInfo];
  for (const resource of resources) {
    if (!resource?.id) throw new Error('Build resource is missing');
    assertVirtualPath(resource.relativePath);
    const bytes = await readResource(resource.relativePath);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== resource.byteLength || hashBytes(bytes) !== resource.sha256) {
      throw new Error(`Build resource checksum mismatch: ${resource.id}`);
    }
  }
  return true;
}

/** Reads every declared local resource and checks bytes. No network or installation side effects. */
export async function verifyOfflineBundle(bundle, profile, readResource) {
  const reasons = [];
  if (bundle.schemaVersion !== 1 || bundle.protocolVersion !== PROTOCOL_VERSION) reasons.push('Unsupported bundle protocol');
  if (bundle.status !== 'active') reasons.push('Bundle is not active');
  if (!profile?.compatibilityId || profile.protocolVersion !== PROTOCOL_VERSION ||
      bundle.compatibilityId !== profile.compatibilityId) reasons.push('No matching compatibility profile');
  if (!Array.isArray(bundle.resources) || bundle.resources.length === 0) {
    reasons.push('No bundled resources');
    return { ready: false, reasons };
  }
  try {
    if (!profile?.resourceManifestHash || profile.resourceManifestHash !== hashResourceManifest(bundle.resources)) {
      reasons.push('Resource manifest does not match the trusted compatibility profile');
    }
  } catch {
    reasons.push('Invalid resource manifest');
  }
  const roles = new Set();
  const ids = new Set();
  const paths = new Set();
  const resourcePaths = new Set(bundle.resources.map(resource => resource.relativePath));
  for (const resource of bundle.resources) {
    try {
      assertVirtualPath(resource.relativePath);
      assertVirtualPath(resource.licenseFile);
      if (!resource.id || ids.has(resource.id) || paths.has(resource.relativePath)) throw new Error('Duplicate/empty resource identity');
      ids.add(resource.id); paths.add(resource.relativePath);
      if (!Array.isArray(resource.roles) || resource.roles.some(role => !REQUIRED_ROLES.includes(role))) throw new Error('Invalid resource roles');
      if (!resource.version || !resource.sourceURL || !resource.mediaType) throw new Error('Incomplete resource metadata');
      if (!resourcePaths.has(resource.licenseFile)) throw new Error('License file is not included in checked resources');
      const bytes = await readResource(resource.relativePath);
      if (!(bytes instanceof Uint8Array)) throw new Error('Resource reader must return bytes');
      if (!Number.isSafeInteger(resource.byteLength) || resource.byteLength < 0 || bytes.byteLength !== resource.byteLength) throw new Error('Resource length mismatch');
      if (hashBytes(bytes) !== resource.sha256) throw new Error('Resource checksum mismatch');
      resource.roles.forEach(role => roles.add(role));
    } catch (error) {
      reasons.push(`${resource.id ?? 'unnamed'}: ${error.message}`);
    }
  }
  // Never trust a manifest to weaken the mandatory role list.
  for (const role of REQUIRED_ROLES) if (!roles.has(role)) reasons.push(`Missing verified role: ${role}`);
  return { ready: reasons.length === 0, reasons };
}
