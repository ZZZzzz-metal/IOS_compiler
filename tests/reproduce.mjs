// Run: node tests/reproduce.mjs shadow|loop-header . Nonzero means a real defect.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { root, compile, Harness, breakpoint, marker, available, observations } from './lib/harness.mjs';
const name = process.argv[2] ?? 'shadow';
assert.ok(['shadow', 'loop-header'].includes(name));
const source = name === 'shadow' ? 'regressions/lexical-shadow.cpp' : 'regressions/loop-header.cpp';
const definition = { id: `regression-${name}`, source, language: 'cpp', standard: 'c++17', stdin: '' };
const text = await readFile(new URL(`fixtures/${source}`, root), 'utf8');
const value = await compile(definition);
assert.equal(value.result.status, 'compiled'); assert.equal(value.result.smoke.exitCode, 0);
const h = new Harness();
let failure;
const samples = [];
try {
  const point = name === 'shadow' ? 'inner' : 'header';
  await h.start(value, definition, { initialBreakpoints: [breakpoint(value, marker(text, point))] });
  if (name === 'shadow') {
    const pause = await h.wait(e => e.kind === 'paused');
    const locals = await h.locals(pause); const actual = await h.evaluate(pause, 'value');
    samples.push({ pause, locals, actual, expected: '19' }); available(actual, 19);
  } else {
    // The first visit can precede initialization. Body values and subsequent headers
    // distinguish this from merely guessing an uninitialized declaration value.
    await h.command('setBreakpoints', { key: h.current, sourcePath: value.snapshot.translationUnit,
      breakpoints: [breakpoint(value, marker(text, 'header')), breakpoint(value, marker(text, 'body'))] });
    let after = 0;
    for (let i = 0; i < 8; ++i) {
      const event = await h.wait(e => e.kind === 'paused' || e.kind === 'terminated', after);
      if (event.kind === 'terminated') break;
      const variable = await h.evaluate(event, 'i'); const sum = await h.evaluate(event, 'sum');
      samples.push({ line: event.position.line, actual: variable, sum, pause: event });
      after = event.eventSeq; await h.control('continue', event);
    }
    const body = samples.filter(s => s.line === marker(text, 'body'));
    assert.deepEqual(body.map(s => s.actual.displayValue), ['0', '1', '2']);
    const laterHeaders = samples.filter(s => s.line === marker(text, 'header')).slice(1);
    assert.equal(laterHeaders.length, 3);
    // Several instructions/columns share the for-line. Require a real initialized
    // value, without guessing whether this binding precedes or follows ++i.
    for (const sample of laterHeaders) available(sample.actual);
  }
} catch (error) { failure = { message: error.message, stack: error.stack }; }
finally { await h.close(); }
const directory = new URL('tests/evidence/', root); await mkdir(directory, { recursive: true });
const result = { name, status: failure ? 'failed' : 'passed', recordedAt: new Date().toISOString(),
  scope: 'desktop-node-real-program', ipadTested: false, samples, failure, observations };
await writeFile(new URL(`regression-${name}.json`, directory), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ name, status: result.status, samples: samples.map(s => ({ line: s.line ?? s.pause.position.line, actual: s.actual, expected: s.expected })) }, null, 2));
process.exitCode = failure ? 1 : 0;
