import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DwarfSymbols } from '../src/dwarf.mjs';
import { VariableInspector } from '../src/variables.mjs';
import { WasmRuntime } from '../src/wasm-runtime.mjs';

// Fresh Clang/LLD output, not a fabricated DWARF layout or execution trace.
function load() {
  const bytes = readFileSync(new URL('../fixtures/shadow-loop/main.wasm', import.meta.url));
  const snapshot = JSON.parse(readFileSync(new URL('../fixtures/shadow-loop/snapshot.json', import.meta.url)));
  const symbols = new DwarfSymbols(bytes, snapshot), runtime = new WasmRuntime(bytes);
  return { symbols, runtime, inspector: new VariableInspector(symbols, runtime) };
}

function execute(context, onStatement) {
  const { runtime, symbols } = context;
  runtime.start(); let previous;
  for (let steps = 0; !runtime.done && steps < 100000; steps++) {
    const frame = runtime.frames.at(-1), row = symbols.row(frame.pc);
    if (row?.pc === frame.pc && row.isStmt && !row.endSequence && frame.pc !== previous) {
      onStatement(frame, row);
      previous = frame.pc;
    }
    runtime.step();
  }
  assert.equal(runtime.done, true, 'the actual program must finish');
  assert.equal(runtime.trap, null);
  assert.equal(runtime.exitCode, 6);
}

test('actual loop-header revisits retain initialized i while fresh declarations hide old storage', () => {
  const context = load(), { inspector } = context;
  const increments = [], declarations = [];
  execute(context, (frame, row) => {
    if (row.line === 4) {
      const i = inspector.locals(frame).find(value => value.name === 'i');
      if (i.state === 'available') increments.push(i.value);
      else declarations.push(i.state);
    }
    if (row.line === 5) {
      const x = inspector.evaluate(frame, 'x');
      assert.equal(x.state, 'outOfScope', 'a repeated inner declaration must not expose its previous iteration value');
      assert.match(x.reason, /not executed/);
    }
  });
  assert.deepEqual(declarations, ['outOfScope']);
  assert.deepEqual(increments, ['0', '1']);
});

test('actual nested x resolves to the nearest active declaration and restores outer x after scope exit', () => {
  const context = load(), { inspector } = context;
  const inner = [], outer = [];
  execute(context, (frame, row) => {
    if (row.line === 6) {
      const x = inspector.evaluate(frame, 'x'), i = inspector.evaluate(frame, 'i');
      assert.equal(x.state, 'available', x.reason);
      assert.equal(i.state, 'available', i.reason);
      inner.push([x.value, i.value]);
    }
    if (row.line === 8) {
      const x = inspector.evaluate(frame, 'x');
      assert.equal(x.state, 'available', x.reason);
      outer.push(x.value);
      assert.notEqual(inspector.evaluate(frame, 'i').state, 'available');
    }
  });
  assert.deepEqual(inner, [['2', '0'], ['2', '1']]);
  assert.deepEqual(outer, ['1']);
});
