const FORMAT = 'ipad-offline-debugger-draft';
const STORE = 'drafts';

export class DraftStorageError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = 'DraftStorageError';
    this.code = code;
  }
}

function validText(value) {
  if (typeof value !== 'string') return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || typeof draft.id !== 'string' || !draft.id ||
      !Number.isSafeInteger(draft.revision) || draft.revision < 0 ||
      !['userText', 'driverText', 'stdin'].every(key => validText(draft[key])) ||
      !((draft.language?.language === 'c' && draft.language.standard === 'c11') ||
        (draft.language?.language === 'cpp' && draft.language.standard === 'c++17')) ||
      typeof draft.updatedAt !== 'string' || !Number.isFinite(Date.parse(draft.updatedAt))) {
    throw new DraftStorageError('invalid-draft', '草稿格式不完整或包含无效文字，未覆盖已保存的草稿。');
  }
  // Copy only protocol fields, so imported or caller-owned objects cannot mutate saved state.
  return {
    id: draft.id, revision: draft.revision, userText: draft.userText,
    driverText: draft.driverText, language: { ...draft.language },
    stdin: draft.stdin, updatedAt: draft.updatedAt,
  };
}

export function createDraft({ id = 'main', userText = '', driverText = '', stdin = '',
  language = { language: 'cpp', standard: 'c++17' }, revision = 0,
  updatedAt = new Date().toISOString() } = {}) {
  return validateDraft({ id, userText, driverText, stdin, language, revision, updatedAt });
}

export function serializeDraft(draft, mode) {
  const saved = validateDraft(draft);
  if (mode === 'user-source') {
    return { filename: saved.language.language === 'c' ? 'main.c' : 'main.cpp',
      mediaType: 'text/plain;charset=utf-8', text: saved.userText };
  }
  if (mode === 'complete-project') {
    return { filename: 'ipad-debugger-project.json', mediaType: 'application/json;charset=utf-8',
      text: `${JSON.stringify({ format: FORMAT, schemaVersion: 1, draft: saved }, null, 2)}\n` };
  }
  throw new DraftStorageError('invalid-export', '请选择导出源码或完整草稿。');
}

/** Returns a new local draft. Import never writes to the database implicitly. */
export function parseImport(text, { filename = 'main.cpp', id = 'main' } = {}) {
  if (!validText(text)) throw new DraftStorageError('invalid-import', '导入文件不是有效文字。');
  if (/\.json$/iu.test(filename)) {
    let project;
    try { project = JSON.parse(text.replace(/^\uFEFF/u, '')); }
    catch (error) { throw new DraftStorageError('invalid-import', '完整草稿文件无法读取，原草稿未改变。', error); }
    if (project?.format !== FORMAT || project.schemaVersion !== 1) {
      throw new DraftStorageError('unsupported-format', '不支持此草稿文件版本，原草稿未改变。');
    }
    return createDraft({ ...validateDraft(project.draft), id, revision: 0, updatedAt: new Date().toISOString() });
  }
  if (!/\.(c|cpp|cc|cxx|txt)$/iu.test(filename)) {
    throw new DraftStorageError('unsupported-format', '请选择 .c、.cpp、.cc、.cxx、.txt 或完整草稿 .json 文件。');
  }
  const language = /\.c$/u.test(filename) ? { language: 'c', standard: 'c11' } : { language: 'cpp', standard: 'c++17' };
  return createDraft({ id, userText: text, language });
}

function storageError(error) {
  if (error instanceof DraftStorageError) return error;
  const quota = error?.name === 'QuotaExceededError';
  return new DraftStorageError(quota ? 'quota' : 'storage-unavailable', quota
    ? '本地空间不足，草稿尚未保存。请复制或导出代码。'
    : '本地保存不可用，草稿尚未保存。请复制或导出代码。', error);
}

/** IndexedDB compare-and-swap occurs within one read/write transaction, including across tabs. */
export function createDraftStore({ indexedDB = globalThis.indexedDB, dbName = 'ipad-debugger-drafts-v1' } = {}) {
  let opening;
  async function database() {
    if (!indexedDB) throw new DraftStorageError('storage-unavailable', '浏览器未提供本地草稿库，请复制或导出代码。');
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        let request;
        try { request = indexedDB.open(dbName, 1); } catch (error) { reject(storageError(error)); return; }
        let blocked = false;
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onerror = () => reject(storageError(request.error));
        request.onblocked = () => {
          blocked = true;
          reject(new DraftStorageError('storage-blocked', '其他窗口正在使用草稿库，请关闭旧窗口后重试。'));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); opening = undefined; };
          resolve(db);
        };
      });
      opening.catch(() => { opening = undefined; });
    }
    return opening;
  }

  async function transaction(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      let tx;
      let result;
      let failure;
      try { tx = db.transaction(STORE, mode); }
      catch (error) { reject(storageError(error)); return; }
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? storageError(tx.error));
      tx.onerror = () => { /* onabort owns the final rejection. */ };
      const fail = error => { failure = storageError(error); tx.abort(); };
      try { action(tx.objectStore(STORE), value => { result = value; }, fail); }
      catch (error) { fail(error); }
    });
  }

  return {
    async load(id) {
      return transaction('readonly', (store, done, fail) => {
        const request = store.get(id);
        request.onsuccess = () => {
          try { done(request.result === undefined ? null : validateDraft(request.result)); }
          catch (error) { fail(error); }
        };
      });
    },
    async save(draft, expectedRevision) {
      const input = validateDraft(draft);
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
        throw new DraftStorageError('invalid-revision', '保存版本无效，原草稿未改变。');
      }
      return transaction('readwrite', (store, done, fail) => {
        const request = store.get(input.id);
        request.onsuccess = () => {
          try {
            const current = request.result === undefined ? null : validateDraft(request.result);
            if ((current?.revision ?? null) !== expectedRevision) {
              throw new DraftStorageError('conflict', '其他窗口已保存较新草稿。当前修改尚未保存，请先复制或导出，再重新打开。');
            }
            const revision = (current?.revision ?? 0) + 1;
            if (!Number.isSafeInteger(revision)) throw new DraftStorageError('invalid-revision', '草稿版本已超出范围，请导出代码。');
            store.put({ ...input, revision });
            done({ revision });
          } catch (error) { fail(error); }
        };
      });
    },
    async export(id, mode) {
      const draft = await this.load(id);
      if (!draft) throw new DraftStorageError('missing-draft', '尚无已保存草稿，请先保存或复制当前代码。');
      return serializeDraft(draft, mode);
    },
    async close() {
      if (opening) (await opening).close();
      opening = undefined;
    },
  };
}
