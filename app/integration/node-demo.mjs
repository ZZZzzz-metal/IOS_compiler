// Development integration evidence: actual compilation and execution, no fixture BuildManifest.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createIntegrationCandidate } from './candidate.mjs';
import { createNodeHost, available, breakpoint, pauseKey, frameKey, buildEvidence } from './node-host.mjs';

const lineOf = (text, marker) => text.split('\n').findIndex(line => line.includes(marker)) + 1;
const outputOf = events => events.filter(event => event.kind === 'output' && event.stream === 'stdout').map(event => event.text).join('');

export async function exerciseCpp(host) {
  const source = `#include <string>
#include <vector>
#include <stdio.h>
int add(int value, int increment) {
    int result = value + increment;
    return result;
}
int sum(const std::vector<int>& values, int index) {
    if (index == static_cast<int>(values.size())) return 0;
    int current = values[index]; // recursive-break
    return current + sum(values, index + 1);
}
int main() {
    int array[3] = {2, 8, 6};
    int* pointer = &array[1];
    std::vector<int> values = {3, 5, 7};
    std::string shortText = "hello";
    std::string longText(80, 'x');
    int total = sum(values, 0); // initial-break
    int changed = add(total, *pointer); // add-call
    values.push_back(changed); // mutation
    printf("cpp total=%d changed=%d vector=%d\\n", total, changed, values[3]); // print
    return values[3] == 23 && shortText.size() == 5 && longText.size() == 80 ? 0 : 1;
}
// fresh integration source ${randomUUID()}
`;
  const compiled = await host.compile({ text: source });
  const h = await host.debug(compiled, { initialBreakpoints: [breakpoint(lineOf(source, 'initial-break'), 'main.cpp')] });
  let steps, values, output, termination, trace;
  try {
    const paused = await h.waitFor(event => event.kind === 'paused');
    assert.equal(paused.reason, 'breakpoint'); assert.equal(paused.position.line, lineOf(source, 'initial-break'));
    const bound = h.events.find(event => event.kind === 'breakpoints');
    assert.equal(bound.bindings[0].status, 'bound'); assert.ok(bound.eventSeq < paused.eventSeq);
    const frame = (await h.stack(paused))[0];
    const scopes = await h.query('scopes', frameKey(paused, frame));
    assert.equal(scopes.kind, 'scopes');
    const locals = await h.query('variables', frameKey(paused, frame), { variablesReference: scopes.scopes[0].variablesReference, start: 0, count: 32 });
    assert.equal(locals.kind, 'variables');
    values = Object.fromEntries(locals.variables.map(value => [value.name, value.displayValue]));
    available(await h.evaluate(paused, frame, 'array[1]'), '8');
    available(await h.evaluate(paused, frame, 'values[2]'), '7');
    assert.equal(available(await h.evaluate(paused, frame, '*pointer')), '8');
    assert.ok(available(await h.evaluate(paused, frame, 'shortText')).includes('hello'));
    assert.ok(available(await h.evaluate(paused, frame, 'longText')).includes('x'.repeat(80)));
    const over = await h.step('stepOver', paused);
    assert.equal(over.position.line, lineOf(source, 'add-call'));
    const total = available(await h.evaluate(over, (await h.stack(over))[0], 'total'), '15');
    const stale = await h.query('stack', pauseKey(paused), { start: 0, count: 32 });
    assert.equal(stale.kind, 'error', 'an earlier pause cannot be queried after stepping');
    const inside = await h.step('stepInto', over);
    const calleeStack = await h.stack(inside);
    assert.match(calleeStack[0].functionName, /^add\b/u);
    assert.ok(calleeStack.some(item => /main/u.test(item.functionName)));
    available(await h.evaluate(inside, calleeStack[0], 'value'), '15');
    available(await h.evaluate(inside, calleeStack[0], 'increment'), '8');
    const outside = await h.step('stepOut', inside);
    assert.match((await h.stack(outside))[0].functionName, /main/u);
    // Some DWARF producers return at the call expression; advance to the following statement.
    let mutation = outside;
    if (mutation.position.line === lineOf(source, 'add-call')) mutation = await h.step('stepOver', mutation);
    assert.equal(mutation.position.line, lineOf(source, 'mutation'));
    const changed = available(await h.evaluate(mutation, (await h.stack(mutation))[0], 'changed'), '23');
    const printed = await h.step('stepOver', mutation);
    assert.equal(printed.position.line, lineOf(source, '// print'));
    const vector = available(await h.evaluate(printed, (await h.stack(printed))[0], 'values[3]'), '23');
    assert.equal((await h.command('continue', { key: pauseKey(printed) })).accepted, true);
    termination = await h.waitFor(event => event.kind === 'terminated', printed.eventSeq);
    assert.equal(termination.reason, 'exit'); assert.equal(termination.exitCode, 0);
    output = outputOf(h.events); assert.equal(output, 'cpp total=15 changed=23 vector=23\n');
    steps = { stepOver: over.position, stepInto: inside.position, stepOut: outside.position, calleeStack, total, changed, vector, stalePauseRejected: true };
    h.assertEvents(); trace = structuredClone(h.events);
  } finally { await h.close(); }
  const recursive = await host.debug(compiled, { initialBreakpoints: [breakpoint(lineOf(source, 'recursive-break'), 'main.cpp')] });
  const recursion = [];
  try {
    let paused = await recursive.waitFor(event => event.kind === 'paused');
    for (let level = 0; level < 3; level++) {
      const frames = await recursive.stack(paused), sums = frames.filter(frame => /^sum\b/u.test(frame.functionName));
      assert.equal(sums.length, level + 1); assert.equal(new Set(frames.map(frame => frame.frameId)).size, frames.length);
      const indices = [];
      for (let i = 0; i < sums.length; i++) indices.push(available(await recursive.evaluate(paused, sums[i], 'index'), String(level - i)));
      recursion.push({ level, frames, indices });
      if (level < 2) {
        assert.equal((await recursive.command('continue', { key: pauseKey(paused) })).accepted, true);
        paused = await recursive.waitFor(event => event.kind === 'paused', paused.eventSeq);
      }
    }
    assert.equal((await recursive.command('stop', { key: recursive.key })).accepted, true);
    await recursive.waitFor(event => event.kind === 'terminated'); recursive.assertEvents();
  } finally { await recursive.close(); }
  return { ...buildEvidence(compiled), values, steps, recursion, output, termination, events: trace };
}

export async function exerciseC(host) {
  const source = `#include <stdio.h>
#include <stdint.h>
#include <inttypes.h>
int sum(const int *values, int n) {
    if (n == 0) return 0;
    return values[n - 1] + sum(values, n - 1);
}
int main(void) {
    int values[4] = {0};
    for (int i = 0; i < 4; ++i) {
        if (scanf("%d", &values[i]) != 1) return 2;
    }
    int *first = &values[0];
    int64_t large = INT64_C(9223372036854775806);
    printf("sum=%d first=%d int64=%" PRId64 "\\n", sum(values, 4), *first, large); // output-break
    return 0;
}
// fresh integration source ${randomUUID()}
`;
  const compiled = await host.compile({ text: source, language: 'c' });
  const h = await host.debug(compiled, { stdin: { text: '2 4 6 8\n', encoding: 'utf-8', eof: true }, initialBreakpoints: [breakpoint(lineOf(source, 'output-break'), 'main.c')] });
  try {
    const paused = await h.waitFor(event => event.kind === 'paused');
    assert.equal(paused.position.line, lineOf(source, 'output-break'));
    const frame = (await h.stack(paused))[0];
    const first = available(await h.evaluate(paused, frame, '*first'), '2');
    const large = available(await h.evaluate(paused, frame, 'large'), '9223372036854775806');
    assert.equal((await h.command('continue', { key: pauseKey(paused) })).accepted, true);
    const termination = await h.waitFor(event => event.kind === 'terminated', paused.eventSeq);
    assert.equal(termination.reason, 'exit'); assert.equal(termination.exitCode, 0);
    const output = outputOf(h.events); assert.equal(output, 'sum=20 first=2 int64=9223372036854775806\n');
    h.assertEvents();
    return { ...buildEvidence(compiled), first, large, output, termination, events: structuredClone(h.events) };
  } finally { await h.close(); }
}

export async function exerciseStopRestart(host) {
  const infinite = await host.compile({ language: 'c', text: `int main(void) {\n volatile unsigned count = 0;\n while (1) { count++; }\n}\n// fresh ${randomUUID()}\n` });
  const h = await host.debug(infinite);
  let stopped, stopMs, staleQuery;
  try {
    await h.waitFor(event => event.kind === 'state' && event.state === 'running');
    await delay(30);
    const started = performance.now();
    assert.equal((await h.command('stop', { key: h.key })).accepted, true);
    stopped = await h.waitFor(event => event.kind === 'terminated'); stopMs = Math.round(performance.now() - started);
    assert.equal(stopped.reason, 'stop'); assert.ok(stopMs < 3000, `stop took ${stopMs} ms`);
    staleQuery = await h.query('stack', { ...h.key, pauseId: 'invalid-old-pause' }, { start: 0, count: 1 });
    assert.equal(staleQuery.kind, 'error'); h.assertEvents();
  } finally { await h.close(); }
  const recovered = await host.compile({ language: 'c', text: `#include <stdio.h>\nint main(void) {\n int answer = 47;\n printf("recompiled=%d\\n", answer);\n return answer == 47 ? 0 : 1;\n}\n// fresh ${randomUUID()}\n` });
  assert.notEqual(recovered.result.build.buildId, infinite.result.build.buildId);
  assert.notEqual(recovered.snapshot.sourceHash, infinite.snapshot.sourceHash);
  const next = await host.debug(recovered);
  try {
    assert.notEqual(next.key.sessionId, h.key.sessionId);
    const termination = await next.waitFor(event => event.kind === 'terminated');
    assert.equal(termination.reason, 'exit'); assert.equal(termination.exitCode, 0);
    const output = outputOf(next.events); assert.equal(output, 'recompiled=47\n'); next.assertEvents();
    return { infinite: buildEvidence(infinite), stopMs, stopped, staleQueryRejected: staleQuery.kind === 'error',
      recovered: buildEvidence(recovered), output, termination, events: structuredClone(next.events) };
  } finally { await next.close(); }
}

export async function runIntegrationDemo() {
  const candidate = await createIntegrationCandidate(), host = createNodeHost(candidate);
  const started = new Date().toISOString();
  const cpp = await exerciseCpp(host), c = await exerciseC(host), stopRestart = await exerciseStopRestart(host);
  return { kind: 'development-node-compiler-debugger-integration', started, finished: new Date().toISOString(),
    node: process.version, platform: process.platform, profile: candidate.profile,
    resourceCount: candidate.resources.length, resourceBytes: candidate.resources.reduce((sum, resource) => sum + resource.byteLength, 0),
    limitations: ['Desktop Node evidence only; iPad execution, offline installation and UI acceptance are unverified.',
      'These explicit samples do not establish complete C/C++ language, DWARF or standard-library coverage.'],
    cpp, c, stopRestart };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runIntegrationDemo().then(report => { process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); }, error => {
    process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1;
  });
}
