import { digest } from 'file:///C:/Users/20964/Documents/ChatGPT/C++%E7%AE%97%E6%B3%95%E7%BC%96%E8%AF%91%E5%99%A8/ipad-debugger-02/compiler/src/toolchain-engine.mjs';
import { inspectWasm } from 'file:///C:/Users/20964/Documents/ChatGPT/C++%E7%AE%97%E6%B3%95%E7%BC%96%E8%AF%91%E5%99%A8/ipad-debugger-02/compiler/src/wasm-inspect.mjs';

// Binary derivation, NOT a source rebuild. The original locked compiler remains
// untouched and is still used for full compilation. See the reviewed recipe in
// resources/completion-semantics-v1.md and its native before/after evidence.
export const COMPLETION_SEMANTICS = Object.freeze({
  version: 1,
  sourceToolchainId: 'binji-wasm-clang-648c4a89997a',
  toolchainId: 'binji-wasm-clang-648c4a89997a+completion-semantics.1',
  sourceByteLength: 31214472,
  sourceHash: 'sha256:2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d',
  byteLength: 31214494,
  compilerResourceHash: 'sha256:b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901',
});

export function completionResourceIdentity(lock) {
  const entry = lock?.files?.find(file => file.filename === 'clang');
  if (lock?.toolchainId !== COMPLETION_SEMANTICS.sourceToolchainId ||
      entry?.byteLength !== COMPLETION_SEMANTICS.sourceByteLength ||
      `sha256:${entry?.sha256}` !== COMPLETION_SEMANTICS.sourceHash) {
    throw new Error('Unsupported source compiler for completion semantics recipe 1');
  }
  return { toolchainId: COMPLETION_SEMANTICS.toolchainId,
    compilerResourceHash: COMPLETION_SEMANTICS.compilerResourceHash,
    sysrootResourceHash: `sha256:${lock.files.find(file => file.filename === 'sysroot.tar').sha256}` };
}

const fromHex = hex => Uint8Array.from(hex.match(/../gu), byte => parseInt(byte, 16));
const guards = Object.freeze([
  // Code section id/length, and function 40648 body length/local declaration.
  [199707, '0bcfdd800cb2a803'],
  [18773317, 'f80a01047f230041'],
  // PrintingCodeCompleteConsumer, availability == NotAccessible (3).
  [18106907, '0240200a2802184103470d00200641106a'],
  // ResultBuilder::AddResult, non-null local declaration before method cast.
  [18774345, '20012802002202450d00200228021041ff0071414e6a41034b0d00200210cbfb020d00200210e9bd'],
]);
const insertionOffset = 18774355;
const inserted = fromHex('200228021041ff00714119460440200228021821020b');

export async function deriveCompletionCompiler(original) {
  if (!(original instanceof Uint8Array) || original.byteLength !== COMPLETION_SEMANTICS.sourceByteLength ||
      await digest(original) !== COMPLETION_SEMANTICS.sourceHash) throw new Error('Completion semantics source integrity failed');
  for (const [offset, hex] of guards) {
    const expected = fromHex(hex);
    if (!expected.every((value, index) => original[offset + index] === value)) throw new Error('Completion semantics instruction/header guard failed');
  }
  const derived = new Uint8Array(COMPLETION_SEMANTICS.byteLength);
  derived.set(original.subarray(0, insertionOffset));
  derived.set(inserted, insertionOffset);
  derived.set(original.subarray(insertionOffset), insertionOffset + inserted.length);
  // >= NotAvailable (2) uses the existing Inaccessible tag; deprecated (1)
  // stays selectable. The parser already excludes that tag per overload.
  derived.set(fromHex('41014d'), 18106914);
  derived.set(fromHex('8e0b'), 18773317); // function body: 1400 -> 1422
  derived.set(fromHex('e5dd800c'), 199708); // code payload: 25177807 -> 25177829
  const before = inspectWasm(original).sections, after = inspectWasm(derived).sections;
  if (before.length !== after.length || before.some((section, i) =>
    section.id !== after[i].id || section.name !== after[i].name ||
    after[i].byteLength !== section.byteLength + (section.id === 10 ? inserted.length : 0) ||
    after[i].payloadOffset !== section.payloadOffset + (section.payloadOffset > insertionOffset ? inserted.length : 0))) {
    throw new Error('Completion semantics section structure failed');
  }
  if (!WebAssembly.validate(derived) || await digest(derived) !== COMPLETION_SEMANTICS.compilerResourceHash) {
    throw new Error('Completion semantics derived integrity failed');
  }
  return derived;
}
