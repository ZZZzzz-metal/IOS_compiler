import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, createDraft, parseImport, serializeDraft } from '../src/draft-store.mjs';
import { createAutosave } from '../src/autosave.mjs';

function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('source export preserves exact user bytes while project export round-trips driver and stdin', () => {
  const draft = createDraft({ userText: '// 中文 😀\r\nint x;\n', driverText: 'int main() { return x; }\n', stdin: '3 4\r\n' });
  const source = serializeDraft(draft, 'user-source');
  assert.equal(source.filename, 'main.cpp');
  assert.deepEqual(new TextEncoder().encode(source.text), new TextEncoder().encode(draft.userText));
  assert.ok(!source.text.includes(draft.driverText));
  const project = serializeDraft(draft, 'complete-project');
  const restored = parseImport(project.text, { filename: project.filename, id: 'restored' });
  assert.equal(restored.id, 'restored');
  assert.equal(restored.revision, 0);
  for (const key of ['userText', 'driverText', 'stdin', 'language']) assert.deepEqual(restored[key], draft[key]);
});

test('invalid or unsupported project imports fail without invoking storage', () => {
  assert.throws(() => parseImport('{', { filename: 'project.json' }), { code: 'invalid-import' });
  assert.throws(() => parseImport('{"schemaVersion":2}', { filename: 'project.json' }), { code: 'unsupported-format' });
  const project = JSON.parse(serializeDraft(createDraft(), 'complete-project').text);
  project.draft.language.standard = 'c++20';
  assert.throws(() => parseImport(JSON.stringify(project), { filename: 'project.json' }), { code: 'invalid-draft' });
  assert.throws(() => parseImport('\ud800'), { code: 'invalid-import' });
  assert.equal(parseImport('int main(void) {}', { filename: 'main.c' }).language.standard, 'c11');
});

test('unavailable local storage returns an explicit failure', async () => {
  const store = createDraftStore({ indexedDB: null });
  await assert.rejects(store.load('main'), { code: 'storage-unavailable' });
});

test('autosave serializes writes and coalesces typing during a slow save', async () => {
  const first = gate();
  const started = gate();
  const calls = [];
  const store = {
    async load() { return null; },
    async save(draft, expected) {
      calls.push({ text: draft.userText, expected });
      if (calls.length === 1) { started.resolve(); await first.promise; }
      return { revision: calls.length };
    },
  };
  const autosave = createAutosave({ store, delayMs: 60_000 });
  await autosave.restore('main');
  autosave.schedule(createDraft({ userText: 'first' }));
  const flushing = autosave.flush();
  await started.promise;
  autosave.schedule(createDraft({ userText: 'intermediate' }));
  autosave.schedule(createDraft({ userText: 'latest' }));
  first.resolve();
  await flushing;
  assert.deepEqual(calls, [{ text: 'first', expected: null }, { text: 'latest', expected: 1 }]);
  assert.equal(autosave.status.revision, 2);
  assert.equal(autosave.status.dirty, false);
  assert.equal(autosave.status.state, 'saved');
  autosave.dispose();
});

test('failed in-flight save retains the latest edit for an explicit retry', async () => {
  const first = gate();
  const started = gate();
  const calls = [];
  const states = [];
  const store = {
    async load() { return createDraft({ revision: 4, userText: 'saved' }); },
    async save(draft, expected) {
      calls.push({ text: draft.userText, expected });
      if (calls.length === 1) { started.resolve(); await first.promise; throw new Error('disk full'); }
      return { revision: 5 };
    },
  };
  const autosave = createAutosave({ store, delayMs: 60_000, onStatus: status => states.push(status.state) });
  await autosave.restore('main');
  autosave.schedule(createDraft({ userText: 'older edit' }));
  const flushing = autosave.flush();
  await started.promise;
  autosave.schedule(createDraft({ userText: 'latest edit' }));
  first.resolve();
  await assert.rejects(flushing, /disk full/u);
  assert.equal(autosave.status.dirty, true);
  assert.equal(autosave.status.state, 'error');
  assert.equal(autosave.currentRevision, 4);
  await autosave.retry();
  assert.deepEqual(calls, [{ text: 'older edit', expected: 4 }, { text: 'latest edit', expected: 4 }]);
  assert.ok(states.includes('error'));
  assert.equal(autosave.status.state, 'saved');
  autosave.dispose();
});

test('a failed restore cannot silently create a new draft over unread local data', async () => {
  const store = { async load() { throw new Error('blocked'); }, async save() { assert.fail('must not save'); } };
  const autosave = createAutosave({ store });
  await assert.rejects(autosave.restore('main'), /blocked/u);
  assert.throws(() => autosave.schedule(createDraft()), { code: 'not-restored' });
  assert.equal(autosave.status.state, 'error');
  autosave.dispose();
});
