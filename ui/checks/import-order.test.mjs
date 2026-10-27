import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createDraft, parseImport, serializeDraft } from '../../storage/src/draft-store.mjs';
import { createAutosave } from '../../storage/src/autosave.mjs';

// Execute the application's actual handler rather than a second implementation
// of its race guards. Only the DOM and persistence transport are controlled here.
// UI_REVIEW_REF intentionally runs these assertions against a fixed historical
// source for before/after evidence. A failure in that mode is not a passing run.
const source = process.env.UI_REVIEW_REF
  ? execFileSync('git', ['show', `${process.env.UI_REVIEW_REF}:ui/src/main.mjs`], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
  })
  : await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const main = source.replace(/\r\n/gu, '\n');
function between(start, end) {
  const first = main.indexOf(start);
  assert.notEqual(first, -1, `Missing application source marker: ${start}`);
  const last = main.indexOf(end, first + start.length);
  assert.notEqual(last, -1, `Missing application source marker: ${end}`);
  return main.slice(first, last);
}
function declaration(name) {
  const line = main.split('\n').find(value => value.startsWith(`const ${name}=`));
  assert.ok(line, `Missing application declaration: ${name}`);
  return line;
}
const handler = between("$('file').onchange=", "\n$('export').onclick=");
const scheduleSave = between('function scheduleSave(){', '\nfunction edited(){');
const edited = between('function edited(){', '\nfunction showText(){');
const editorHandlers = between("$('source').oninput=edited;", "\n$('user-tab').onclick=");

function deferredFile(name, { size = 40 } = {}) {
  let resolve;
  let reject;
  let started;
  const reading = new Promise((done, fail) => { resolve = done; reject = fail; });
  const began = new Promise(done => { started = done; });
  return {
    name, size, began, resolve, reject,
    text() { started(); return reading; },
  };
}

async function fixture(t) {
  const original = createDraft({ id: 'main', revision: 1, userText: 'original source\n',
    driverText: 'original driver\n', stdin: 'original input\n' });
  const records = new Map([[original.id, structuredClone(original)]]);
  const writes = [];
  const scheduled = [];
  const statuses = [];
  const store = {
    async load(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
    async save(draft, expectedRevision) {
      const existing = records.get(draft.id);
      assert.equal(existing?.revision ?? null, expectedRevision, 'autosave must keep its real CAS revision');
      const saved = { ...structuredClone(draft), revision: (existing?.revision ?? 0) + 1 };
      records.set(saved.id, saved);
      writes.push(saved);
      return { revision: saved.revision };
    },
  };
  const autosave = createAutosave({ store, delayMs: 60_000, onStatus: status => statuses.push(status) });
  const restored = await autosave.restore(original.id);
  const realSchedule = autosave.schedule.bind(autosave);
  autosave.schedule = value => { scheduled.push(structuredClone(value)); realSchedule(value); };
  t.after(() => autosave.dispose());
  const nodes = new Map();
  for (const id of ['file', 'language', 'stdin', 'source', 'message', 'save-recovery']) {
    nodes.set(id, { value: '', textContent: '', hidden: true, files: [] });
  }
  nodes.get('source').value = restored.userText;
  nodes.get('stdin').value = restored.stdin;
  const context = vm.createContext({
    $: id => { assert.ok(nodes.has(id), `Unexpected DOM dependency: ${id}`); return nodes.get(id); },
    draft: restored, currentTab: 'driver', snapshotMode: true, requested: [{ breakpointId: 'old' }],
    importSequence: 0, draftGeneration: 0, recovering: false, restored: true,
    unqueuedEdits: false, saveFailed: false, autoSave: autosave, parseImport,
    render() {}, syncScroll() {},
    showText() { nodes.get('source').value = context.draft.userText; },
  });
  vm.runInContext([declaration('fault'), declaration('safe'), declaration('language'), scheduleSave, edited,
    editorHandlers, handler].join('\n'), context);
  function start(file) {
    nodes.get('file').files = [file];
    nodes.get('file').value = file.name;
    return nodes.get('file').onchange();
  }
  return {
    context, nodes, original, records, writes, scheduled, statuses, autosave, start,
    get message() { return nodes.get('message').textContent; },
    async edit(text) {
      context.draft.userText = text;
      nodes.get('source').value = text;
      vm.runInContext('scheduleSave()', context);
    },
  };
}

test('REV-005: B finishing before A is the only import delivered to autosave', async t => {
  const app = await fixture(t);
  const a = deferredFile('A.cpp');
  const aDone = app.start(a); await a.began;
  const b = deferredFile('B.cpp');
  const bDone = app.start(b); await b.began;
  b.resolve('int value = 22;\n'); await bDone;
  a.resolve('int value = 11;\n'); await aDone;
  await app.autosave.flush();
  assert.equal(app.context.draft.userText, 'int value = 22;\n');
  assert.deepEqual(app.scheduled.map(draft => draft.userText), ['int value = 22;\n']);
  assert.deepEqual(app.writes.map(draft => draft.userText), ['int value = 22;\n']);
  assert.equal(app.records.get('main').revision, 2);
});

test('REV-005: obsolete A failure neither overwrites B feedback nor clears B selection', async t => {
  const app = await fixture(t);
  const a = deferredFile('A.cpp');
  const aDone = app.start(a); await a.began;
  const b = deferredFile('B.cpp');
  const bDone = app.start(b); await b.began;
  app.nodes.get('message').textContent = 'B 的当前提示';
  app.nodes.get('message').hidden = false;
  a.reject(new Error('旧 A 读取失败')); await aDone;
  assert.equal(app.message, 'B 的当前提示');
  assert.equal(app.nodes.get('file').value, 'B.cpp');
  assert.equal(app.context.draft.userText, app.original.userText);
  assert.equal(app.scheduled.length, 0);
  b.resolve('int b = 2;'); await bDone;
  await app.autosave.flush();
  assert.equal(app.context.draft.userText, 'int b = 2;');
});

test('REV-005: A success/finally cannot clear the file input while B is reading', async t => {
  const app = await fixture(t);
  const a = deferredFile('A.cpp');
  const aDone = app.start(a); await a.began;
  const b = deferredFile('B.cpp');
  const bDone = app.start(b); await b.began;
  a.resolve('int a = 1;'); await aDone;
  assert.equal(app.nodes.get('file').value, 'B.cpp');
  assert.equal(app.context.draft.userText, app.original.userText);
  assert.equal(app.scheduled.length, 0);
  b.resolve('int b = 2;'); await bDone;
  assert.equal(app.nodes.get('file').value, '');
  await app.autosave.flush();
  assert.equal(app.writes[0].userText, 'int b = 2;');
});

test('REV-005: a late A error does not replace feedback after B has completed', async t => {
  const app = await fixture(t);
  const a = deferredFile('A.cpp');
  const aDone = app.start(a); await a.began;
  const b = deferredFile('B.cpp');
  const bDone = app.start(b); await b.began;
  app.nodes.get('message').textContent = '导入前的旧提示';
  app.nodes.get('message').hidden = false;
  b.resolve('int b = 2;'); await bDone;
  assert.equal(app.nodes.get('message').hidden, true, 'successful B import must dismiss the prior error');
  const afterSuccess = app.message;
  a.reject(new Error('A 的旧失败')); await aDone;
  assert.equal(app.message, afterSuccess);
  assert.equal(app.nodes.get('message').hidden, true, 'obsolete A must not reopen an error after B succeeds');
  await app.autosave.flush();
  assert.deepEqual(app.writes.map(draft => draft.userText), ['int b = 2;']);
});

test('REV-005: a late A read error cannot replace the actual newer B import error', async t => {
  const app = await fixture(t);
  const a = deferredFile('A.cpp');
  const aDone = app.start(a); await a.began;
  const b = deferredFile('B.json');
  const bDone = app.start(b); await b.began;
  b.resolve('{invalid project'); await bDone;
  const bError = app.message;
  assert.match(bError, /草稿|文件|读取|格式/u);
  a.reject(new Error('迟到的 A 文件读取错误')); await aDone;
  assert.equal(app.message, bError);
  assert.equal(app.nodes.get('message').hidden, false);
  assert.equal(app.context.draft.userText, app.original.userText);
  assert.equal(app.scheduled.length, 0);
  assert.equal(app.nodes.get('file').value, '');
});

for (const scenario of [
  {
    name: 'editing', prompt: '当前编辑已保留，等待自动保存', expectedWrites: ['newer edit before rejection\n'],
    async change(app) { await app.edit('newer edit before rejection\n'); },
  },
  {
    name: 'switching drafts', prompt: '已切换到另一份草稿', expectedWrites: [],
    async change(app) {
      app.context.draft = createDraft({ id: 'other', userText: 'switched draft\n', stdin: 'other sample' });
      app.nodes.get('source').value = app.context.draft.userText;
    },
  },
  {
    name: 'starting recovery', prompt: '正在将当前内容保存为恢复副本', expectedWrites: [],
    async change(app) { app.context.recovering = true; app.context.draftGeneration++; },
  },
]) {
  test(`REV-005: a pending read rejection after ${scenario.name} preserves the newer operation's prompt`, async t => {
    const app = await fixture(t);
    const file = deferredFile('pending-before-new-operation.cpp');
    const done = app.start(file); await file.began;
    await scenario.change(app);
    const currentDraft = app.context.draft;
    const currentContent = structuredClone(currentDraft);
    app.nodes.get('message').textContent = scenario.prompt;
    app.nodes.get('message').hidden = false;
    file.reject(new Error('过期导入的文件读取失败')); await done;
    assert.equal(app.message, scenario.prompt, 'stale failure must not replace feedback for the newer operation');
    assert.equal(app.nodes.get('message').hidden, false);
    assert.equal(app.context.draft, currentDraft);
    assert.deepEqual(structuredClone(app.context.draft), currentContent);
    assert.deepEqual(app.scheduled.map(draft => draft.userText), scenario.expectedWrites,
      'only a real newer edit may enter autosave; the rejected import must not schedule content');
    await app.autosave.flush();
    assert.deepEqual(app.writes.map(draft => draft.userText), scenario.expectedWrites);
  });
}

test('REV-005: edits made while the file is reading survive and produce an explanatory prompt', async t => {
  const app = await fixture(t);
  const file = deferredFile('incoming.cpp');
  const done = app.start(file); await file.began;
  await app.edit('newer user edit\n');
  file.resolve('older imported source\n'); await done;
  assert.equal(app.context.draft.userText, 'newer user edit\n');
  assert.equal(app.nodes.get('source').value, 'newer user edit\n');
  assert.equal(app.context.draftGeneration, 1, 'real scheduleSave must invalidate the pending import');
  assert.match(app.message, /修改|编辑|变化|改变/u);
  await app.autosave.flush();
  assert.deepEqual(app.writes.map(draft => draft.userText), ['newer user edit\n']);
});

test('REV-005: real source, stdin and language handlers all increment the edit generation', async t => {
  const app = await fixture(t);
  app.context.currentTab = 'user';
  app.context.snapshotMode = false;
  app.nodes.get('source').value = 'typed source\n';
  app.nodes.get('source').oninput();
  assert.equal(app.context.draftGeneration, 1);
  app.nodes.get('stdin').value = 'new sample input\n';
  app.nodes.get('stdin').oninput();
  assert.equal(app.context.draftGeneration, 2);
  app.nodes.get('language').value = 'c';
  app.nodes.get('language').onchange();
  assert.equal(app.context.draftGeneration, 3);
  assert.equal(app.scheduled.length, 3);
  await app.autosave.flush();
  const saved = app.records.get('main');
  assert.equal(saved.userText, 'typed source\n');
  assert.equal(saved.stdin, 'new sample input\n');
  assert.deepEqual(saved.language, { language: 'c', standard: 'c11' });
});

test('REV-005: switching draft objects during a read never imports into the new draft', async t => {
  const app = await fixture(t);
  const file = deferredFile('incoming.cpp');
  const done = app.start(file); await file.began;
  const other = createDraft({ id: 'other', userText: 'other draft\n', stdin: 'other input' });
  app.context.draft = other;
  app.nodes.get('source').value = other.userText;
  file.resolve('incoming source'); await done;
  assert.equal(app.context.draft, other);
  assert.equal(app.context.draft.userText, 'other draft\n');
  assert.equal(app.scheduled.length, 0);
  assert.equal(app.writes.length, 0);
  assert.match(app.message, /草稿|切换|变化|改变/u);
});

test('REV-005: replacing the same draft id still invalidates the old read by object identity', async t => {
  const app = await fixture(t);
  const file = deferredFile('incoming.cpp');
  const done = app.start(file); await file.began;
  const replacement = createDraft({ id: 'main', userText: 'restored replacement\n' });
  app.context.draft = replacement;
  file.resolve('obsolete source'); await done;
  assert.equal(app.context.draft, replacement);
  assert.equal(app.scheduled.length, 0);
  assert.match(app.message, /草稿|变化|改变|切换/u);
});

test('REV-005: entering recovery while reading prevents import and saving', async t => {
  const app = await fixture(t);
  const file = deferredFile('incoming.cpp');
  const done = app.start(file); await file.began;
  app.context.recovering = true;
  file.resolve('must not replace recovery'); await done;
  assert.equal(app.context.draft.userText, app.original.userText);
  assert.equal(app.scheduled.length, 0);
  assert.equal(app.writes.length, 0);
  assert.match(app.message, /保留|修改|切换/u);
});

test('REV-005: import requested during recovery is rejected without changing the draft', async t => {
  const app = await fixture(t);
  app.context.recovering = true;
  let read = false;
  app.nodes.get('message').textContent = '正在保存恢复副本';
  await app.start({ name: 'incoming.cpp', size: 40, async text() { read = true; return 'must not replace recovery'; } });
  assert.equal(app.context.draft.userText, app.original.userText);
  assert.equal(app.scheduled.length, 0);
  assert.equal(read, false);
  assert.equal(app.message, '正在保存恢复副本');
});

test('REV-005: the latest import error preserves source, driver, input and persisted draft', async t => {
  const app = await fixture(t);
  const before = structuredClone(app.context.draft);
  const file = deferredFile('broken.json');
  const done = app.start(file); await file.began;
  file.resolve('{broken'); await done;
  assert.deepEqual(structuredClone(app.context.draft), before);
  assert.deepEqual(app.records.get('main'), before);
  assert.equal(app.scheduled.length, 0);
  assert.match(app.message, /草稿|文件|读取|格式/u);
  assert.equal(app.nodes.get('file').value, '');
});

test('REV-005: a normal C import updates the editor and is saved with the existing CAS revision', async t => {
  const app = await fixture(t);
  const source = '// 中文\r\nint main(void) { return 0; }\n';
  await app.start({ name: 'main.c', size: source.length, async text() { return source; } });
  await app.autosave.flush();
  const saved = app.records.get('main');
  assert.equal(saved.userText, source);
  assert.equal(saved.driverText, '');
  assert.equal(saved.stdin, '');
  assert.deepEqual(saved.language, { language: 'c', standard: 'c11' });
  assert.equal(saved.revision, 2);
  assert.equal(app.nodes.get('source').value, source);
  assert.equal(app.nodes.get('language').value, 'c');
  assert.equal(app.context.currentTab, 'user');
  assert.equal(app.context.snapshotMode, false);
  assert.equal(app.context.requested.length, 0);
});

test('REV-005: complete-project JSON imports driver/input but retains the local draft identity', async t => {
  const app = await fixture(t);
  const exported = createDraft({ id: 'foreign-project', revision: 99,
    userText: 'class Solution {};\n', driverText: '#include "user.inc"\nint main() {}\n', stdin: '12 34\n' });
  const file = serializeDraft(exported, 'complete-project');
  await app.start({ name: file.filename, size: file.text.length, async text() { return file.text; } });
  await app.autosave.flush();
  const saved = app.records.get('main');
  assert.equal(saved.id, 'main');
  assert.equal(saved.revision, 2);
  for (const key of ['userText', 'driverText', 'stdin', 'language']) assert.deepEqual(saved[key], exported[key]);
  assert.equal(app.nodes.get('stdin').value, exported.stdin);
  assert.equal(app.nodes.get('language').value, 'cpp');
  assert.equal(app.records.has('foreign-project'), false);
});
