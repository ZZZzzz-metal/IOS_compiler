// Focused read-only product review. Writes only its dedicated evidence JSON;
// core modules, compiled candidates, and global test registrations are untouched.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createNodeProbe } from '../../compiler/src/node-probe.mjs';
import { createSnapshot } from '../../compiler/src/source.mjs';
import { DwarfSymbols, AT, TAG } from '../src/dwarf.mjs';
import { VariableInspector } from '../src/variables.mjs';
import { WasmRuntime } from '../src/wasm-runtime.mjs';

const root = new URL('../../', import.meta.url);
const git = (...args) => execFileSync('git', ['-C', fileURLToPath(root), ...args], { encoding: 'utf8' }).trim();
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const fix = 'cc2fa6a2e05153a676c570e325caf9f1baceb5df';
const tag = 'integration-v0.2.1';
const beforeFixRevision = git('rev-parse', `${fix}^`);
const currentSource = await readFile(new URL('../src/variables.mjs', import.meta.url), 'utf8');
const beforeFixSource = execFileSync('git', ['-C', fileURLToPath(root), 'show', `${beforeFixRevision}:debugger/src/variables.mjs`], { encoding: 'utf8' });
const dwarfURL = new URL('../src/dwarf.mjs', import.meta.url).href;
const importText = "from './dwarf.mjs'";
assert.equal(beforeFixSource.split(importText).length, 2, 'pre-fix module has exactly one known relative import');
const previousModule = await import(`data:text/javascript;base64,${Buffer.from(beforeFixSource.replace(importText, `from ${JSON.stringify(dwarfURL)}`)).toString('base64')}`);

const source = [
  'int seed(int n) {',
  '  return n + 10;',
  '}',
  'int main() {',
  '  int total = 0;',
  '  for (int i = 0; i < 2; ++i) {',
  '    int x = seed(i);',
  '    total += x;',
  '  }',
  '  return total;',
  '}',
  '',
].join('\n');
const snapshot = createSnapshot([{ path: 'main.cpp', role: 'user', text: source }], 'main.cpp');
const compilation = await createNodeProbe().compile({
  requestId: 'role3-readonly-review-loop-initializer', snapshot,
  language: 'cpp', standard: 'c++17', mode: 'debug', optimization: 'O0',
}, { smokeStdin: '' });
assert.equal(compilation.status, 'compiled', compilation.rawDiagnostics);
assert.equal(compilation.smoke.exitCode, 21, 'native Wasm reference executes both real iterations');

const descriptor = value => ({
  name: value.name, type: value.type, state: value.state, value: value.value,
  ...(value.reason ? { reason: value.reason } : {}),
  ...(value._lexicalInScope !== undefined ? { lexicalInScope: value._lexicalInScope,
    declarationReached: value._declarationReached, scopeDepth: value._scopeDepth } : {}),
});
const instruction = ins => ins ? { pc: ins.pc, absolutePC: ins.absolutePC, opcode: ins.op,
  nextPC: ins.nextPC, ...(ins.index !== undefined ? { index: ins.index } : {}),
  ...(ins.offset !== undefined ? { offset: ins.offset } : {}) } : null;

function diagnose(Inspector, version) {
  const symbols = new DwarfSymbols(compilation.executable, snapshot);
  const runtime = new WasmRuntime(compilation.executable), inspector = new Inspector(symbols, runtime);
  const calleeBinding = symbols.bindBreakpoint({ sourcePath: 'main.cpp', line: 2 });
  const bodyBinding = symbols.bindBreakpoint({ sourcePath: 'main.cpp', line: 8 });
  assert.ok(calleeBinding.verified && bodyBinding.verified);
  const calleePCs = new Set(calleeBinding.pcs), bodyPCs = new Set(bodyBinding.pcs);
  const records = [], stores = [], assertions = [], seenCallees = new Set(), seenBodies = new Set();
  let waiting, mostRecentCall, steps = 0;
  const check = (label, fn) => {
    try { fn(); assertions.push({ label, passed: true }); }
    catch (error) { assertions.push({ label, passed: false, message: error.message }); }
  };
  function capture(stage, caller, callee = null) {
    const variables = symbols.variables(caller.pc), xInfo = variables.find(item => symbols.attr(item.die, AT.name) === 'x');
    assert.ok(xInfo, 'caller PC belongs to the real x lexical scope');
    const expression = symbols.locationExpression(xInfo.die, AT.location, caller.pc);
    const location = inspector._expression(expression, caller, xInfo.function);
    assert.equal(location.kind, 'memory');
    const address = Number(location.value), size = symbols.byteSize(symbols.type(xInfo.die));
    assert.equal(size, 4);
    const x = inspector.evaluate(caller, 'x'), i = inspector.evaluate(caller, 'i');
    const currentInstruction = runtime.functions[caller.funcIndex].instructions.get(caller.pc);
    const call = runtime.functions[caller.funcIndex].instructions.get(caller.callPC);
    const frameStack = runtime.frames.map(frame => ({ id: frame.id, funcIndex: frame.funcIndex,
      name: symbols.functionName(frame.pc) ?? runtime.functions[frame.funcIndex].name,
      pc: frame.pc, lastPC: frame.lastPC, callPC: frame.callPC }));
    const scopeRanges = [];
    for (let scope = xInfo.die.parent; scope; scope = scope.parent) {
      if ([TAG.lexical, TAG.inline, TAG.subprogram].includes(scope.tag)) scopeRanges.push({
        dieOffset: scope.offset, tag: scope.tag, name: symbols.attr(scope, AT.name),
        ranges: symbols.ranges(scope), containsCaller: symbols.contains(scope, caller.pc),
      });
      if (scope === xInfo.function) break;
    }
    const record = {
      stage, step: steps, iteration: Number(i._scalar), stack: frameStack,
      callerFrameId: caller.id, callerFuncIndex: caller.funcIndex,
      callerPC: caller.pc, callerPosition: symbols.location(caller.pc),
      callerCallPC: caller.callPC, callerLastPC: caller.lastPC,
      callInstruction: instruction(call), nextInstruction: instruction(currentInstruction),
      ...(callee ? { calleeFrameId: callee.id, calleeFuncIndex: callee.funcIndex,
        calleePC: callee.pc, calleePosition: symbols.location(callee.pc),
        actualWasmParameter0: String(callee.locals[0]),
        callerIsImmediatelyBelowCallee: runtime.frames.at(-2) === caller,
        actualCallTargetsCallee: call?.index === callee.funcIndex,
        callerPCIsCallContinuation: call?.nextPC === caller.pc } : {}),
      locals: inspector.locals(caller).filter(value => ['x', 'i', 'total'].includes(value.name)).map(descriptor),
      x: descriptor(x),
      dwarf: { variableDieOffset: xInfo.die.offset, declarationLine: symbols.attr(xInfo.die, 0x3b),
        locationExpression: [...expression], actualLexicalInScope: xInfo.inScope,
        scopes: scopeRanges, frameBase: symbols.legacyFrameBase(caller) },
      memory: { address: String(address), byteSize: size, bytes: [...runtime.memory.subarray(address, address + size)],
        signedValue: new DataView(runtime.memory.buffer, runtime.memory.byteOffset + address, size).getInt32(0, true),
        coveredByAnyEarlierWriteInFrame: runtime.wasMemoryWritten(caller, address, size),
        recordedWriteRangesCoveringSlot: caller.memoryWrites.filter(([start, end]) => start <= address && end >= address + size) },
    };
    records.push(record); return record;
  }

  runtime.start();
  while (!runtime.done && steps < 10000) {
    const top = runtime.frames.at(-1), topName = symbols.functionName(top.pc);
    if (topName === 'seed' && calleePCs.has(top.pc) && !seenCallees.has(top.id)) {
      seenCallees.add(top.id);
      const caller = runtime.frames.at(-2), record = capture('inside-initializer-callee', caller, top);
      assert.equal(symbols.functionName(caller.pc), 'main');
      assert.equal(record.callerIsImmediatelyBelowCallee, true);
      assert.equal(record.actualCallTargetsCallee, true);
      assert.equal(record.callerPCIsCallContinuation, true);
      waiting = { callerId: caller.id, continuationPC: caller.pc, calleeId: top.id, iteration: record.iteration };
      mostRecentCall = waiting;
      check(`iteration ${record.iteration}: caller x is unavailable while seed executes`, () =>
        assert.notEqual(record.x.state, 'available', 'the new x initialization has not completed'));
    }
    if (waiting && top.id === waiting.callerId && top.pc === waiting.continuationPC) {
      const record = capture('initializer-returned-before-store', top);
      check(`iteration ${record.iteration}: caller x is unavailable after return and before store`, () =>
        assert.notEqual(record.x.state, 'available', 'the initializer return value has not been stored in x'));
      waiting = undefined;
    }
    if (topName === 'main' && bodyPCs.has(top.pc)) {
      const iteration = Number(inspector.evaluate(top, 'i')._scalar);
      if (!seenBodies.has(iteration)) {
        seenBodies.add(iteration); const record = capture('body-after-initialization', top);
        check(`iteration ${iteration}: body x is the initialized value ${10 + iteration}`, () => {
          assert.equal(record.x.state, 'available'); assert.equal(record.x.value, String(10 + iteration));
        });
      }
    }
    const ins = runtime.functions[top.funcIndex].instructions.get(top.pc);
    let observedStore;
    if (topName === 'main' && ins?.op === 0x36 && mostRecentCall) {
      const info = symbols.variables(top.pc).find(item => symbols.attr(item.die, AT.name) === 'x');
      if (info) {
        const expression = symbols.locationExpression(info.die, AT.location, top.pc);
        const address = Number(inspector._expression(expression, top, info.function).value);
        const actualStoreAddress = ((Number(top.stack.at(-2)) >>> 0) + ins.offset) >>> 0;
        if (actualStoreAddress === address) observedStore = { iteration: mostRecentCall.iteration,
          step: steps, instruction: instruction(ins), address: String(address),
          valueOnRealOperandStack: String(top.stack.at(-1)),
          beforeBytes: [...runtime.memory.subarray(address, address + 4)] };
      }
    }
    runtime.step(); steps++;
    if (observedStore) {
      observedStore.afterBytes = [...runtime.memory.subarray(Number(observedStore.address), Number(observedStore.address) + 4)];
      observedStore.afterX = descriptor(inspector.evaluate(top, 'x')); stores.push(observedStore);
    }
  }
  assert.equal(runtime.done, true); assert.equal(runtime.trap, null); assert.equal(runtime.exitCode, 21);
  assert.equal(seenCallees.size, 2); assert.equal(seenBodies.size, 2); assert.equal(stores.length, 2);
  return { version, status: assertions.every(item => item.passed) ? 'passed' : 'failed',
    assertions, records, actualInitializationStores: stores,
    bindings: { callee: calleeBinding, body: bodyBinding },
    execution: { steps, done: runtime.done, exitCode: runtime.exitCode, trap: runtime.trap } };
}

const current = diagnose(VariableInspector, 'integration-v0.2.1');
const previous = diagnose(previousModule.VariableInspector, 'parent-of-cc2fa6a');
const evidence = {
  kind: 'role3-readonly-loop-initializer-review', recordedAt: new Date().toISOString(),
  scope: 'desktop-node-real-CompilerProbe-and-WasmRuntime', ipadTested: false,
  finding: { priority: 'P2', introducedByFix: current.status === 'failed' && previous.status === 'passed',
    expected: 'Each new x initialization remains unavailable until its actual store; body values are 10 and 11.',
    actual: 'During the second seed call and its return continuation, current-tag x exposes previous-iteration value 10.',
    source: 'debugger/src/variables.mjs:137',
    explanation: 'The declaration PC comparison permits later initializer instructions; per-frame memory-write coverage includes the previous lifetime of the same stack slot.' },
  provenance: { revision: git('rev-parse', 'HEAD'), tag, tagRevision: git('rev-parse', tag),
    fixRevision: fix, beforeFixRevision, currentVariablesSHA256: sha(currentSource),
    beforeFixVariablesSHA256: sha(beforeFixSource),
    preFixLoading: 'git show parent:debugger/src/variables.mjs; one known dwarf import changed to current absolute file URL; module loaded from an in-memory data URL.',
    diagnosticSHA256: sha(await readFile(fileURLToPath(import.meta.url))) },
  source, snapshot,
  compilation: { requestId: compilation.requestId, status: compilation.status,
    executableSHA256: sha(compilation.executable), executableBytes: compilation.executable.length,
    compilerArguments: compilation.compilerArguments, linkerArguments: compilation.linkerArguments,
    target: compilation.target, compilerResourceHash: compilation.compilerResourceHash,
    linkerResourceHash: compilation.linkerResourceHash, sysrootResourceHash: compilation.sysrootResourceHash,
    nativeSmoke: compilation.smoke },
  runs: { current, beforeFix: previous },
  limitations: ['Runtime-level caller-frame query; no DebuggerAdapter pauseId/frameId transport exercised.',
    'All frame PCs come from actual execution. Callee stops use real source-bound instruction PCs; caller PC is the verified call continuation.',
    'No product implementation, fixture binaries, source files, candidate profiles, or global test registrations are changed.'],
};
const output = new URL('../evidence/integration-v0.2.1-2026-10-25/loop-initializer-review.json', import.meta.url);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ current: current.status, beforeFix: previous.status,
  introducedByFix: evidence.finding.introducedByFix, failedAssertions: current.assertions.filter(item => !item.passed),
  evidence: fileURLToPath(output) }, null, 2));
process.exitCode = current.status === 'failed' ? 1 : 0;
