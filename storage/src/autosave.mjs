import { validateDraft, DraftStorageError } from './draft-store.mjs';

/** One writer per editor. An in-flight save is followed by only the latest pending edit. */
export function createAutosave({ store, onStatus = () => {}, delayMs = 400 } = {}) {
  let id;
  let revision = null;
  let pending;
  let running;
  let timer;
  let state = 'idle';
  let lastError;
  let disposed = false;
  function report(next, error) {
    state = next;
    lastError = error;
    onStatus({ state, revision, error });
  }
  function assertActive() {
    if (disposed) throw new DraftStorageError('autosave-closed', '此编辑器的自动保存已关闭。');
  }
  async function drain() {
    if (running) return running;
    if (!pending) return;
    running = (async () => {
      while (pending) {
        const next = pending;
        pending = undefined;
        report('saving');
        try {
          const saved = await store.save({ ...next, revision: revision ?? 0 }, revision);
          revision = saved.revision;
        } catch (error) {
          // Keep the newest edit when an older in-flight save fails.
          pending ??= next;
          clearTimeout(timer);
          report('error', error);
          throw error;
        }
      }
      report('saved');
    })();
    try { await running; }
    finally { running = undefined; }
  }
  return {
    get status() { return { state, revision, error: lastError, dirty: Boolean(pending || running) }; },
    get currentRevision() { return revision; },
    async restore(draftId) {
      assertActive();
      if (pending || running) throw new DraftStorageError('unsaved-draft', '当前草稿尚未保存，不能切换草稿。');
      report('loading');
      try {
        const draft = await store.load(draftId);
        id = draftId;
        revision = draft?.revision ?? null;
        report(draft ? 'saved' : 'idle');
        return draft;
      } catch (error) { report('error', error); throw error; }
    },
    schedule(draft) {
      assertActive();
      const next = validateDraft(draft);
      if (id === undefined) throw new DraftStorageError('not-restored', '请先读取本地草稿后再启用自动保存。');
      if (next.id !== id) throw new DraftStorageError('wrong-draft', '不能将另一个草稿写入当前编辑器。');
      pending = next;
      clearTimeout(timer);
      report('dirty');
      timer = setTimeout(() => { drain().catch(() => {}); }, delayMs);
    },
    async flush() {
      assertActive();
      clearTimeout(timer);
      await drain();
    },
    async retry() { return this.flush(); },
    dispose() {
      clearTimeout(timer);
      disposed = true;
      // A caller must flush before dispose; unsaved edits remain observable in status.
    },
  };
}
