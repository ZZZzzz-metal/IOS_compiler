import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { DwarfSymbols, DwarfError, Reader, AT } from '../src/dwarf.mjs';
import { VariableInspector } from '../src/variables.mjs';
import { WasmRuntime } from '../src/wasm-runtime.mjs';

const artifact = new URL('../fixtures/debug-handoff/main.wasm', import.meta.url);
const snapshotFile = new URL('../fixtures/debug-handoff/snapshot.json', import.meta.url);
const hasArtifact = existsSync(artifact) && existsSync(snapshotFile);
const stlArtifact = new URL('../fixtures/stl/main.wasm', import.meta.url);
const stlSnapshot = new URL('../fixtures/stl/snapshot.json', import.meta.url);
const load = () => {
  const bytes = readFileSync(artifact), snapshot = JSON.parse(readFileSync(snapshotFile));
  const symbols = new DwarfSymbols(bytes, snapshot), runtime = new WasmRuntime(bytes);
  return { bytes, snapshot, symbols, runtime, inspector: new VariableInspector(symbols, runtime) };
};
function runTo(context, predicate, limit = 100000) {
  const { runtime, symbols } = context;
  if (!runtime.frames.length) runtime.start();
  for (let step = 0; step < limit && !runtime.done; step++) {
    const frame = runtime.frames.at(-1), location = symbols.location(frame.pc);
    if (predicate(frame, location)) return frame;
    runtime.step();
  }
  assert.fail(`Requested real runtime stop was not reached (${runtime.trap ?? runtime.exitCode})`);
}

test('actual Clang 8 DWARF maps code-payload PCs and binds executable user lines', { skip: !hasArtifact }, () => {
  const { symbols } = load();
  assert.equal(symbols.units.length, 1);
  assert.equal(symbols.units[0].version, 4);
  assert.ok(symbols.dies.size > 3000);
  assert.deepEqual(symbols.location(1384), { sourcePath: 'main.cpp', line: 24, column: 1 });
  assert.equal(symbols.functionName(1384), 'main');
  assert.equal(symbols.functionName(700), 'sum');
  assert.equal(symbols.location(955), undefined, 'do not pause before main prologue');
  assert.equal(symbols.location(546), undefined, 'do not expose unwritten sum parameters');
  assert.deepEqual(symbols.bindBreakpoint({ sourcePath: 'main.cpp', line: 24 }).pcs, [1384]);
  assert.deepEqual(symbols.bindBreakpoint({ sourcePath: 'main.cpp', line: 9 }).actual,
    [{ sourcePath: 'main.cpp', line: 10, column: 1 }]);
  for (const line of [1, 3, 8, 999]) assert.equal(symbols.bindBreakpoint({ sourcePath: 'main.cpp', line }).verified, false);
  assert.equal(symbols.bindBreakpoint({ sourcePath: 'not-main.cpp', line: 24 }).verified, false);
});

test('actual memory reconstructs arrays, pointer, mutated vector, short/long libc++ strings', { skip: !hasArtifact }, () => {
  const context = load();
  const frame = runTo(context, (frame, location) => location?.line === 24);
  const { inspector } = context, locals = new Map(inspector.locals(frame).map(value => [value.name, value]));
  for (const value of locals.values()) assert.equal(value.state, 'available', `${value.name}: ${value.reason}`);
  assert.equal(locals.get('total').value, '15');
  assert.equal(locals.get('changed').value, '19');
  assert.deepEqual(inspector.children(locals.get('array')).map(value => value.value), ['2', '4', '6']);
  assert.deepEqual(inspector.children(locals.get('pointer')).map(value => value.value), ['4']);
  assert.deepEqual(inspector.children(locals.get('values')).map(value => value.value), ['3', '5', '7', '19']);
  assert.deepEqual(inspector.children(locals.get('values'), 1, 2).map(value => value.value), ['5', '7']);
  assert.equal(locals.get('shortText').value, '"hello"');
  assert.equal(locals.get('longText').value, JSON.stringify('x'.repeat(80)));
  assert.equal(inspector.children(locals.get('longText'), 79, 100).length, 1);
  assert.equal(inspector.evaluate(frame, 'total + *pointer').value, '19');
  assert.equal(inspector.evaluate(frame, 'values[3] == changed').value, '1');
  assert.equal(inspector.evaluate(frame, 'array[1] + 2 * total').value, '34');
  for (const expression of ['total++', 'total = 0', 'add(total, 1)', 'array[999]', '*(&array[1] - 1000000)', '1 / 0'])
    assert.notEqual(inspector.evaluate(frame, expression).state, 'available', expression);
  assert.equal(inspector.evaluate(frame, 'total').value, '15', 'watch expressions do not mutate the target');
});

test('recursive live frames use their own Wasm base local and initialization history', { skip: !hasArtifact }, () => {
  const context = load(), { symbols, runtime, inspector } = context;
  runTo(context, (frame, location) => location?.line === 10 && frame.locals[1] === 3);
  const recursion = runtime.frames.filter(frame => symbols.functionName(frame.pc) === 'sum');
  assert.equal(recursion.length, 4);
  assert.equal(new Set(recursion.map(frame => frame.id)).size, 4);
  assert.deepEqual(recursion.map(frame => inspector.locals(frame).find(value => value.name === 'index').value), ['0', '1', '2', '3']);
  assert.equal(new Set(recursion.map(frame => symbols.legacyFrameBase(frame).address)).size, 4);
  assert.deepEqual(recursion.slice(0, 3).map(frame => inspector.locals(frame).find(value => value.name === 'current').value), ['3', '5', '7']);
  const terminal = runTo(context, (frame, location) => location?.line === 13 && frame.locals[1] === 3);
  const current = inspector.locals(terminal).find(value => value.name === 'current');
  assert.equal(current.state, 'unavailable');
  assert.match(current.reason, /not been initialized/);
});

test('variables at their declaration boundary are explicit instead of stale stack values', { skip: !hasArtifact }, () => {
  const context = load();
  const frame = runTo(context, (frame, location) => location?.line === 21);
  const total = context.inspector.locals(frame).find(value => value.name === 'total');
  assert.equal(total.state, 'outOfScope');
  assert.match(total.reason, /not executed/);
});

test('real STL signed/unsigned LEB constants and live i64/u64 values remain exact',
  { skip: !existsSync(stlArtifact) || !existsSync(stlSnapshot) }, () => {
    const bytes = readFileSync(stlArtifact), snapshot = JSON.parse(readFileSync(stlSnapshot));
    const symbols = new DwarfSymbols(bytes, snapshot);
    const constants = new Map([...symbols.dies.values()].filter(die => typeof symbols.attr(die, AT.constValue) === 'bigint')
      .map(die => [String(symbols.attr(die, AT.constValue)), die.forms.get(AT.constValue)]));
    assert.equal(constants.get('-9223372036854775808'), 13, 'DW_FORM_sdata retains int64 minimum');
    assert.equal(constants.get('9223372036854775807'), 13, 'DW_FORM_sdata retains int64 maximum');
    assert.equal(constants.get('18446744073709551615'), 15, 'DW_FORM_udata retains uint64 maximum');
    const runtime = new WasmRuntime(bytes, { stdin: '5 9 1 7 2 4\n' });
    const inspector = new VariableInspector(symbols, runtime);
    const targets = new Set(symbols.bindBreakpoint({ sourcePath: 'main.cpp', line: 40 }).pcs);
    assert.ok(targets.size);
    runtime.start(); let frame;
    for (let steps = 0; !runtime.done && steps < 500000; steps++) {
      frame = runtime.frames.at(-1); if (targets.has(frame.pc)) break;
      runtime.step();
    }
    assert.ok(frame && targets.has(frame.pc), 'actual program reaches the post-initialization statement');
    const locals = new Map(inspector.locals(frame).map(value => [value.name, value]));
    assert.equal(locals.get('big').value, '9223372036854775806');
    assert.equal(locals.get('ubig').value, '18446744073709551615');
    assert.equal(locals.get('shortText').value, JSON.stringify('中文😀'));
    assert.equal(locals.get('emptyText').value, '""');
    assert.equal(locals.get('empty').indexedVariables, 0);
    assert.equal(inspector.evaluate(frame, 'big + 1').value, '9223372036854775807');
    assert.equal(inspector.evaluate(frame, 'big + 2').state, 'unsupported');
    assert.equal(inspector.evaluate(frame, 'ubig + 1').value, '0');
  });

test('corrupted real pointer/container state reports bounded unavailability', { skip: !hasArtifact }, () => {
  const context = load(), frame = runTo(context, (frame, location) => location?.line === 24);
  const { runtime, symbols, inspector } = context;
  const locals = new Map(inspector.locals(frame).map(value => [value.name, value]));
  const memory = new DataView(runtime.memory.buffer, runtime.memory.byteOffset, runtime.memory.byteLength);
  const pointer = locals.get('pointer'); memory.setUint32(pointer.address, 0xfffffffc, true);
  const invalidPointer = inspector.locals(frame).find(value => value.name === 'pointer');
  assert.equal(inspector.children(invalidPointer)[0].state, 'unavailable');
  const vector = locals.get('values'), end = inspector._find(symbols.canonical(vector._type), ['__end_']);
  memory.setUint32(vector.address + end.offset, 1, true);
  const invalidVector = inspector.locals(frame).find(value => value.name === 'values');
  assert.equal(invalidVector.state, 'unavailable');
  assert.match(invalidVector.reason, /Invalid libc\+\+ vector/);
  const string = locals.get('longText'), data = inspector._find(symbols.canonical(string._type), ['__r_', '__value_', '__l', '__data_']);
  memory.setUint32(string.address + data.offset, runtime.memory.length + 16, true);
  const invalidString = inspector.locals(frame).find(value => value.name === 'longText');
  assert.equal(invalidString.state, 'unavailable');
  assert.match(invalidString.reason, /outside current linear memory/);
});

// A valid small DWARF fixture covers standard expressions not produced by the
// legacy compiler. Actual artifact tests above remain separate real execution.
const uleb = value => { const out = []; do { const byte = value & 127; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value); return out; };
const u32 = value => [value & 255, value >>> 8 & 255, value >>> 16 & 255, value >>> 24 & 255];
const str = value => [...new TextEncoder().encode(value), 0];
const wasmStr = value => { const bytes = [...new TextEncoder().encode(value)]; return [...uleb(bytes.length), ...bytes]; };
const custom = (name, bytes) => { const payload = [...wasmStr(name), ...bytes]; return [0, ...uleb(payload.length), ...payload]; };
function fixture() {
  const abbrev = [];
  const ab = (code, tag, children, attrs) => abbrev.push(...uleb(code), ...uleb(tag), children, ...attrs.flat(), 0, 0);
  ab(1, 0x11, 1, [[0x25, 8], [3, 8], [0x1b, 8], [0x11, 1], [0x12, 6], [0x10, 0x17]]);
  ab(2, 0x2e, 1, [[3, 8], [0x11, 1], [0x12, 6], [0x40, 0x18]]);
  ab(3, 0x24, 0, [[3, 8], [0x0b, 0x0b], [0x3e, 0x0b]]);
  ab(4, 0x34, 0, [[3, 8], [0x49, 0x13], [2, 0x18]]);
  ab(5, 0x0b, 1, [[0x11, 1], [0x12, 6]]);
  ab(6, 0x13, 1, [[3, 8], [0x0b, 0x0b]]);
  ab(7, 0x0d, 0, [[3, 8], [0x49, 0x13], [0x38, 0x0b]]);
  ab(8, 0x01, 1, [[0x49, 0x13]]);
  ab(9, 0x21, 0, [[0x2f, 0x0b]]);
  ab(10, 0x0f, 0, [[0x49, 0x13]]);
  abbrev.push(0);
  const info = [0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 4];
  info.push(1, ...str('fixture producer'), ...str('main.cpp'), ...str('/project'), ...u32(5), ...u32(3), ...u32(0));
  const int = info.length; info.push(3, ...str('int'), 4, 5);
  const wide = info.length; info.push(3, ...str('long long'), 8, 5);
  const pointer = info.length; info.push(10, ...u32(int));
  const pair = info.length; info.push(6, ...str('Pair'), 8, 7, ...str('x'), ...u32(int), 0, 7, ...str('y'), ...u32(int), 4, 0);
  const array = info.length; info.push(8, ...u32(int), 9, 2, 0);
  info.push(2, ...str('test'), ...u32(5), ...u32(3), 4, 0xed, 0, 0, 0x9f);
  const variable = (name, type, expression) => info.push(4, ...str(name), ...u32(type), ...uleb(expression.length), ...expression);
  variable('fromFrame', int, [0x91, 0x7c]); // fbreg -4
  variable('wide', wide, [0xed, 0, 1, 0x9f]);
  variable('fromGlobal', int, [0xed, 1, 0, 0x9f]);
  variable('pair', pair, [3, ...u32(300)]);
  variable('numbers', array, [3, ...u32(400)]);
  variable('invalid', pointer, [3, ...u32(500)]);
  variable('unknown', int, [0xff]);
  variable('missing', int, []);
  info.push(5, ...u32(7), ...u32(1)); variable('hidden', int, [3, ...u32(600)]); info.push(0, 0, 0);
  info.splice(0, 4, ...u32(info.length - 4));
  const header = [1, 1, 1, 251, 14, 13, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1,
    0, ...str('main.cpp'), 0, 0, 0, 0];
  const program = [0, 5, 2, ...u32(5), 10, 3, 4, 1, 2, 2, 3, 1, 1, 2, 1, 0, 1, 1];
  const line = [4, 0, ...u32(header.length), ...header, ...program];
  const code = [1, 6, 1, 2, 0x7f, 0x41, 0, 0x0b];
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 10, code.length, ...code,
    ...custom('.debug_abbrev', abbrev), ...custom('.debug_info', info), ...custom('.debug_line', [...u32(line.length), ...line])]);
  const snapshot = { files: [{ path: 'main.cpp', text: '\n\n\n\nint x;\nx++;\n' }] };
  const symbols = new DwarfSymbols(bytes, snapshot), memory = new Uint8Array(1024), view = new DataView(memory.buffer);
  view.setInt32(252, 123, true); view.setInt32(300, 42, true); view.setInt32(304, 43, true);
  [7, 8, 9].forEach((n, i) => view.setInt32(400 + i * 4, n, true)); view.setUint32(500, 1022, true);
  const frame = { pc: 5, locals: [256, 9007199254740993n], stack: [] };
  const runtime = { memory, globals: [512] };
  return { bytes, symbols, runtime, frame, inspector: new VariableInspector(symbols, runtime) };
}

test('standard frame-base/fbreg/Wasm location expressions preserve i64 and concrete aggregate types', () => {
  const { inspector, frame, symbols } = fixture();
  assert.deepEqual(symbols.location(5), { sourcePath: 'main.cpp', line: 5, column: 1 });
  const locals = new Map(inspector.locals(frame).map(value => [value.name, value]));
  assert.equal(locals.get('fromFrame').value, '123');
  assert.equal(locals.get('wide').value, '9007199254740993');
  assert.equal(locals.get('fromGlobal').value, '512');
  assert.deepEqual(inspector.children(locals.get('pair')).map(value => value.value), ['42', '43']);
  assert.deepEqual(inspector.children(locals.get('numbers')).map(value => value.value), ['7', '8', '9']);
  assert.equal(inspector.evaluate(frame, 'pair.x + numbers[2]').value, '51');
  assert.equal(inspector.evaluate(frame, 'wide + 2').value, '9007199254740995');
  assert.equal(inspector.evaluate(frame, 'false && invalid[0]').value, '0');
  assert.equal(inspector.evaluate(frame, 'true || (1 / 0)').value, '1');
  assert.equal(inspector.evaluate(frame, '0xffffffff + 1').value, '0', 'unsigned arithmetic wraps at its actual width');
  assert.equal(inspector.evaluate(frame, '~0xffffffff').value, '0');
  assert.equal(inspector.evaluate(frame, '-1 < 0xffffffff').value, '0', 'usual integer conversions preserve unsigned comparisons');
  assert.equal(inspector.evaluate(frame, '2147483647 + 1').state, 'unsupported', 'never invent a result for signed overflow');
  assert.equal(inspector.evaluate(frame, '1 << 32').state, 'error');
  assert.equal(locals.get('hidden').state, 'outOfScope');
  assert.equal(locals.get('unknown').state, 'unsupported');
  assert.equal(locals.get('missing').state, 'optimizedOut');
  assert.equal(inspector.children(locals.get('invalid'))[0].state, 'unavailable');
  assert.equal(inspector.children(locals.get('numbers'), -1, 2)[0].state, 'error');
});

test('malformed debug inputs fail within bounded readers', () => {
  const { bytes } = fixture();
  for (const length of [0, 4, 8, 20, bytes.length - 1])
    assert.throws(() => new DwarfSymbols(bytes.subarray(0, length)), DwarfError);
  assert.throws(() => new Reader(new Uint8Array(12).fill(128)).uleb(), /Overlong LEB128/);
  assert.throws(() => new Reader(new Uint8Array([0x80])).uleb(), /Truncated/);
  assert.throws(() => new Reader(new Uint8Array([65])).string(), /Truncated/);
});
