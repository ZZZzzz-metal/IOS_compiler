import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeProbe } from '../../compiler/src/node-probe.mjs';
import { createSnapshot } from '../../compiler/src/source.mjs';
import { DwarfSymbols } from '../src/dwarf.mjs';
import { VariableInspector } from '../src/variables.mjs';
import { WasmRuntime } from '../src/wasm-runtime.mjs';

const source = [
  '#include <string>',
  '#include <vector>',
  'int seed(int n) {',
  '  return n + 10; // seed-stop',
  '}',
  'struct Probe {',
  '  int value;',
  '  Probe(int n) {',
  '    value = seed(n);',
  '    int marker = seed(n + 100); // ctor already wrote value',
  '    value += marker - marker;',
  '  }',
  '};',
  'int recurse(int depth) {',
  '  if (depth == 0) return 0;',
  '  int sum = 0;',
  '  for (int i = 0; i < 2; ++i) {',
  '    int x = seed(depth * 10 + i); // recursive-initializer',
  '    sum += x; // recursive-body',
  '  }',
  '  return sum + recurse(depth - 1);',
  '}',
  'int main() {',
  '  int total = 0;',
  '  for (int i = 0; i < 2; ++i) {',
  '    int x = seed(i); // scalar-initializer',
  '    int raw[2] = {seed(i + 10), seed(i + 20)}; // array-initializer',
  '    int* pointer = raw + 1;',
  '    Probe object(i); // aggregate-initializer',
  '    std::vector<int> values = {seed(i + 30), seed(i + 40)}; int later = seed(i + 50); // completed-container-call',
  "    std::string text(i + 1, 'a' + i);",
  '    total += x + raw[0] + raw[1] + object.value + values[0] + values[1] + text.size(); // main-body',
  '  }',
  '  return total == 329 && recurse(2) == 102 ? 0 : 1;',
  '}',
  '',
].join('\n');
const snapshot = createSnapshot([{ path: 'main.cpp', role: 'user', text: source }], 'main.cpp');
const line = marker => source.split('\n').findIndex(text => text.includes(marker)) + 1;
let bytes;

test.before(async () => {
  const result = await createNodeProbe().compile({ requestId: 'initializer-lifetime-real-compile',
    snapshot, language: 'cpp', standard: 'c++17', mode: 'debug', optimization: 'O0' }, { smokeStdin: '' });
  assert.equal(result.status, 'compiled', result.rawDiagnostics);
  assert.equal(result.smoke.exitCode, 0, 'native Wasm validates both loops and recursive values');
  bytes = result.executable;
});

function load() {
  const symbols = new DwarfSymbols(bytes, snapshot), runtime = new WasmRuntime(bytes);
  const inspector = new VariableInspector(symbols, runtime);
  const pcs = marker => new Set(symbols.bindBreakpoint({ sourcePath: 'main.cpp', line: line(marker) }).pcs);
  return { symbols, runtime, inspector, seedPCs: pcs('seed-stop'),
    mainBodyPCs: pcs('main-body'), recursiveBodyPCs: pcs('recursive-body') };
}
function execute(context, visit) {
  const { runtime } = context;
  runtime.start();
  for (let steps = 0; !runtime.done && steps < 500000; steps++) { visit(runtime.frames.at(-1)); runtime.step(); }
  assert.equal(runtime.done, true); assert.equal(runtime.trap, null); assert.equal(runtime.exitCode, 0);
}
const assertUnavailable = value => {
  assert.notEqual(value.state, 'available', `${value.name} leaked stale value ${value.value}`);
  assert.match(value.reason, /not been initialized|initializer call has not completed/i);
};

test('real repeated initializer hides caller x during callee and return-before-store; body values stay 10/11', () => {
  const context = load(), { symbols, runtime, inspector } = context;
  const calls = [], returns = [], bodies = [], seen = new Set(); let waiting;
  execute(context, top => {
    if (waiting && top.id === waiting.id && top.pc === waiting.pc) {
      const value = inspector.evaluate(top, 'x'); assertUnavailable(value);
      returns.push(value.state); waiting = undefined;
    }
    const parent = runtime.frames.at(-2);
    if (context.seedPCs.has(top.pc) && !seen.has(top.id) && symbols.functionName(parent?.pc) === 'main' &&
      symbols.location(parent.pc)?.line === line('scalar-initializer')) {
      seen.add(top.id);
      const value = inspector.evaluate(parent, 'x'); assertUnavailable(value);
      const i = inspector.evaluate(parent, 'i'); assert.equal(i.state, 'available');
      const call = runtime.functions[parent.funcIndex].instructions.get(parent.callPC);
      assert.equal(call.nextPC, parent.pc); assert.equal(call.index, top.funcIndex);
      calls.push(Number(i._scalar)); waiting = { id: parent.id, pc: parent.pc };
    }
    if (context.mainBodyPCs.has(top.pc)) bodies.push(inspector.evaluate(top, 'x').value);
  });
  assert.deepEqual(calls, [0, 1]); assert.equal(returns.length, 2); assert.deepEqual(bodies, ['10', '11']);
});

test('lifetime updates occur without queries during the first iteration', () => {
  const context = load(), { symbols, runtime, inspector } = context;
  let secondCall = false, body;
  execute(context, top => {
    const parent = runtime.frames.at(-2);
    if (!secondCall && context.seedPCs.has(top.pc) && top.locals[0] === 1 &&
      symbols.functionName(parent?.pc) === 'main' && symbols.location(parent.pc)?.line === line('scalar-initializer')) {
      // This is deliberately the first inspector query of the entire execution.
      assertUnavailable(inspector.evaluate(parent, 'x')); secondCall = true;
    }
    if (secondCall && context.mainBodyPCs.has(top.pc)) body = inspector.evaluate(top, 'x').value;
  });
  assert.equal(secondCall, true); assert.equal(body, '11');
});

test('arrays, pointer, vector/string and partially written constructors use current lifetimes', () => {
  const context = load(), { symbols, runtime, inspector } = context;
  const bodies = [], arrayCalls = new Set(), partialConstructors = new Set();
  execute(context, top => {
    if (context.seedPCs.has(top.pc)) {
      const parent = runtime.frames.at(-2), parentLine = symbols.location(parent.pc)?.line;
      if (symbols.functionName(parent.pc) === 'main' && parentLine === line('array-initializer')) {
        const raw = inspector.locals(parent).find(value => value.name === 'raw');
        // Each element has its own store. During the second seed call the
        // first element is already new, while the second must reject old bytes.
        const values = inspector.children(raw), i = Number(inspector.evaluate(parent, 'i')._scalar);
        if (top.locals[0] === i + 10) assertUnavailable(values[0]);
        else { assert.equal(values[0].state, 'available'); assert.equal(values[0].value, String(i + 20)); }
        assertUnavailable(values[1]);
        arrayCalls.add(top.id);
      }
      if (symbols.functionName(parent.pc) === 'Probe' && top.locals[0] >= 100) {
        const main = runtime.frames.find(frame => symbols.functionName(frame.pc) === 'main');
        const object = inspector.locals(main).find(value => value.name === 'object');
        // The constructor already wrote its field, but the constructor call is
        // still executing. Displaying an initialized object would be premature.
        assertUnavailable(object); partialConstructors.add(top.id);
      }
    }
    if (context.mainBodyPCs.has(top.pc)) {
      const locals = new Map(inspector.locals(top).map(value => [value.name, value]));
      const i = Number(inspector.evaluate(top, 'i')._scalar);
      for (const name of ['raw', 'pointer', 'object', 'values', 'text']) assert.equal(locals.get(name).state, 'available', locals.get(name).reason);
      assert.deepEqual(inspector.children(locals.get('raw')).map(value => value.value), [String(20 + i), String(30 + i)]);
      assert.equal(inspector.children(locals.get('pointer'))[0].value, String(30 + i));
      assert.equal(inspector.evaluate(top, 'object.value').value, String(10 + i));
      assert.deepEqual(inspector.children(locals.get('values')).map(value => value.value), [String(40 + i), String(50 + i)]);
      assert.equal(locals.get('text').value, JSON.stringify(i ? 'bb' : 'a'));
      bodies.push(i);
    }
  });
  assert.deepEqual(bodies, [0, 1]); assert.equal(arrayCalls.size, 4); assert.equal(partialConstructors.size, 2);
});

test('a completed vector stays readable during a later initializer on the same source line', () => {
  const context = load(), { symbols, runtime, inspector } = context;
  const checked = new Set();
  execute(context, top => {
    const parent = runtime.frames.at(-2), n = top.locals[0];
    if (context.seedPCs.has(top.pc) && (n === 50 || n === 51) &&
      symbols.functionName(parent?.pc) === 'main' && symbols.location(parent.pc)?.line === line('completed-container-call')) {
      const locals = new Map(inspector.locals(parent).map(value => [value.name, value]));
      const values = locals.get('values');
      assert.equal(values.state, 'available', values.reason);
      assert.deepEqual(inspector.children(values).map(value => value.value), [String(n - 10), String(n)]);
      assertUnavailable(locals.get('later')); checked.add(top.id);
    }
  });
  assert.equal(checked.size, 2);
});

test('recursive activations maintain distinct declaration epochs and do not expose earlier x', () => {
  const context = load(), { symbols, runtime, inspector } = context;
  const calls = [], body = [], seen = new Set(), activationIds = new Set();
  execute(context, top => {
    const parent = runtime.frames.at(-2);
    if (context.seedPCs.has(top.pc) && !seen.has(top.id) && symbols.functionName(parent?.pc) === 'recurse') {
      seen.add(top.id); activationIds.add(parent.id);
      assertUnavailable(inspector.evaluate(parent, 'x'));
      const depth = inspector.evaluate(parent, 'depth'), i = inspector.evaluate(parent, 'i');
      assert.equal(depth.state, 'available'); assert.equal(i.state, 'available');
      calls.push([depth.value, i.value]);
    }
    if (context.recursiveBodyPCs.has(top.pc)) body.push(inspector.evaluate(top, 'x').value);
  });
  assert.equal(activationIds.size, 2);
  assert.deepEqual(calls, [['2', '0'], ['2', '1'], ['1', '0'], ['1', '1']]);
  assert.deepEqual(body, ['30', '31', '20', '21']);
});

test('lost lifetime metadata stays unavailable instead of falling back to historical writes', () => {
  const context = load(), { runtime, inspector } = context;
  let checked = false;
  runtime.start();
  for (let steps = 0; !runtime.done && steps < 500000; steps++) {
    const frame = runtime.frames.at(-1);
    if (context.mainBodyPCs.has(frame.pc)) {
      const original = runtime.wasMemoryWrittenSince;
      runtime.wasMemoryWrittenSince = () => null;
      assert.equal(inspector.evaluate(frame, 'x').state, 'unavailable');
      runtime.wasMemoryWrittenSince = original; checked = true; break;
    }
    runtime.step();
  }
  assert.equal(checked, true);
});
