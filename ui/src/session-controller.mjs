/** Session consumer for the development UI. All execution data comes from the adapter. */
const identityFields = ['sessionId', 'buildId', 'sourceHash', 'compatibilityId'];
const terminal = state => ['terminated', 'failed'].includes(state);
const copy = value => structuredClone(value);
const same = (a, b) => Boolean(a && b) && identityFields.every(field => a[field] === b[field]);
const keyOf = value => Object.fromEntries(identityFields.map(field => [field, value[field]]));
const emptyView = () => ({ session: null, frames: [], stackTotal: 0, scopes: [], scopePages: [], variables: [], breakpoints: [], outputTail: [], outputTruncated: false, error: null });

export class SessionController {
  constructor({ adapter, onChange = () => {}, idFactory = () => crypto.randomUUID(), maxBufferedEvents = 128, maxOutputBytes = 65536 } = {}) {
    if (!adapter?.subscribe || !adapter?.command || !adapter?.query || !adapter?.resync) throw new Error('A DebuggerAdapter is required');
    this.adapter = adapter;
    this.onChange = onChange;
    this.id = idFactory;
    this.maxBufferedEvents = maxBufferedEvents;
    this.maxOutputBytes = maxOutputBytes;
    this.view = emptyView();
    this.queryEpoch = 0;
    this.stackRequest = null;
    this.resyncRequest = null;
    this.resyncPromise = null;
    this.buffer = [];
    this.bufferOverflow = false;
    this.commandSerial = Promise.resolve();
    this.stopPending = null;
    this.variablePageSize = 100;
    this.disposed = false;
    // Subscribe before dispatching start; even short programs can finish before its ACK.
    this.unsubscribe = adapter.subscribe(event => this._event(event));
  }

  getView() {
    const result = copy(this.view), s = result.session;
    const paused = s?.state === 'paused' && s.synchronized && Boolean(s.pauseId) && !s.pendingControl;
    result.actions = {
      start: !s || terminal(s.state),
      continue: paused, stepInto: paused, stepOver: paused, stepOut: paused,
      stop: Boolean(s && !terminal(s.state) && !this.stopPending),
      inspect: paused, setBreakpoints: Boolean(s && !terminal(s.state) && s.synchronized),
    };
    return result;
  }

  _notify() { if (!this.disposed) this.onChange(); }
  _error(error) { this.view.error = typeof error === 'string' ? error : error?.message ?? String(error); this._notify(); }
  _invalidatePause() {
    ++this.queryEpoch;
    this.stackRequest = null;
    const s = this.view.session;
    if (s) { delete s.pauseId; delete s.frameId; delete s.position; delete s.reason; }
    this.view.frames = []; this.view.stackTotal = 0; this.view.scopes = []; this.view.scopePages = []; this.view.variables = [];
  }
  _pauseMatches(key, epoch) {
    const s = this.view.session;
    return epoch === this.queryEpoch && same(s, key) && s.synchronized && !s.pendingControl &&
      s.state === 'paused' && s.pauseId === key.pauseId &&
      (key.frameId === undefined || s.frameId === key.frameId);
  }
  _appendOutput(part) {
    this.view.outputTail.push(copy(part));
    const bytes = () => this.view.outputTail.reduce((sum, item) => sum + new TextEncoder().encode(item.text).length, 0);
    while (this.view.outputTail.length > 128 || bytes() > this.maxOutputBytes) {
      this.view.outputTail.shift(); this.view.outputTruncated = true;
    }
  }
  _buffer(event) {
    if (this.buffer.length >= this.maxBufferedEvents) { this.buffer.shift(); this.bufferOverflow = true; }
    this.buffer.push(copy(event));
  }
  _event(event) {
    const s = this.view.session;
    if (this.disposed || !same(s, event) || terminal(s.state) || !Number.isSafeInteger(event.eventSeq) || event.eventSeq <= s.eventSeq) return;
    if (!s.synchronized || event.eventSeq !== s.eventSeq + 1) {
      if (s.synchronized) { s.synchronized = false; this._invalidatePause(); }
      this._buffer(event); this._notify();
      if (!this.resyncPromise) void this.resync().catch(() => {});
      return;
    }
    this._applyEvent(event);
    this._notify();
    this._autoInspect();
  }
  _applyEvent(event) {
    const s = this.view.session;
    s.eventSeq = event.eventSeq;
    if (event.kind === 'state') { this._invalidatePause(); s.state = event.state; }
    if (event.kind === 'paused') {
      this._invalidatePause();
      Object.assign(s, { state: 'paused', pauseId: event.pauseId, reason: event.reason });
      if (event.position) s.position = copy(event.position);
    }
    if (event.kind === 'breakpoints') this.view.breakpoints = copy(event.bindings);
    if (event.kind === 'output') this._appendOutput({ eventSeq: event.eventSeq, stream: event.stream, text: event.text });
    if (event.kind === 'output-truncated') this.view.outputTruncated = true;
    if (event.kind === 'terminated') {
      this._invalidatePause(); s.state = 'terminated'; s.pendingControl = null;
      s.termination = { reason: event.reason, ...(event.exitCode === undefined ? {} : { exitCode: event.exitCode }), ...(event.message ? { message: event.message } : {}) };
    }
    if (event.kind === 'error') {
      this.view.error = event.message;
      if (event.fatal) { this._invalidatePause(); s.state = 'failed'; s.pendingControl = null; s.failure = { code: event.code, message: event.message }; }
    }
  }
  _autoInspect() {
    const s = this.view.session;
    if (s?.state === 'paused' && s.synchronized && s.pauseId && !s.pendingControl && !this.stackRequest && !this.view.frames.length) {
      void this.refreshStack().catch(error => this._error(error));
    }
  }

  async start(request) {
    if (this.disposed) throw new Error('Session controller is disposed');
    if (!this.getView().actions.start) throw new Error('Stop the current session before starting another');
    this._invalidatePause(); this.resyncRequest = null; this.resyncPromise = null; this.buffer = []; this.bufferOverflow = false;
    this.stopPending = null;
    this.variablePageSize = Number.isSafeInteger(request.limits?.variablePageSize) ? Math.max(1, Math.min(100, request.limits.variablePageSize)) : 100;
    this.view = emptyView();
    const commandId = this.id();
    this.view.session = { ...keyOf(request), state: 'created', eventSeq: 0, synchronized: true, pendingControl: commandId };
    this.view.breakpoints = copy(request.initialBreakpoints ?? []).map(bp => ({ breakpointId: bp.breakpointId, requested: bp.requested, status: 'pending', actual: [] }));
    this._notify();
    const promise = this._send({ commandId, kind: 'start', request: copy(request) });
    this.commandSerial = promise.catch(() => {});
    return promise;
  }
  async _send(command) {
    const key = keyOf(command.kind === 'start' ? command.request : command.key);
    const synchronization = this.resyncRequest;
    let ack;
    try { ack = await this.adapter.command(command); }
    catch (error) { ack = { commandId: command.commandId, accepted: false, code: 'resource-error', message: error.message }; }
    const s = this.view.session;
    if (this.disposed || !same(s, key) || ack.commandId !== command.commandId || this.resyncRequest !== synchronization) return ack;
    if (s.pendingControl === command.commandId) s.pendingControl = null;
    // ACKs are acknowledgments only: never restore state, eventSeq, pauseId, or handles.
    if (!ack.accepted) {
      this.view.error = ack.message ?? 'Command was rejected';
      if (command.kind === 'start' && s.eventSeq === 0) {
        this._invalidatePause(); s.state = 'failed'; s.failure = { code: ack.code, message: this.view.error };
      } else if (!terminal(s.state)) await this.resync().catch(() => {});
    }
    this._notify(); this._autoInspect();
    return ack;
  }
  control(kind) {
    if (!['continue', 'stepInto', 'stepOver', 'stepOut', 'stop'].includes(kind)) return Promise.reject(new Error('Unsupported control'));
    if (kind === 'stop' && this.stopPending) return this.stopPending;
    if (!this.getView().actions[kind]) return Promise.reject(new Error('Control is unavailable in the current session state'));
    const s = this.view.session, commandId = this.id();
    const key = { ...keyOf(s), ...(kind === 'stop' ? {} : { pauseId: s.pauseId }) };
    this._invalidatePause(); s.pendingControl = commandId; this._notify();
    if (kind === 'stop') {
      // Stop bypasses a slow start/control ACK and is handled by the adapter's independent watchdog.
      const promise = this._send({ commandId, kind, key });
      this.stopPending = promise;
      this._notify();
      void promise.finally(() => { if (this.stopPending === promise) { this.stopPending = null; this._notify(); } });
      return promise;
    }
    const promise = this.commandSerial.then(() => this._send({ commandId, kind, key }));
    this.commandSerial = promise.catch(() => {});
    return promise;
  }
  setBreakpoints(sourcePath, breakpoints) {
    if (!this.getView().actions.setBreakpoints) return Promise.reject(new Error('Breakpoint changes require a synchronized active session'));
    const command = { commandId: this.id(), kind: 'setBreakpoints', key: keyOf(this.view.session), sourcePath, breakpoints: copy(breakpoints) };
    const promise = this.commandSerial.then(() => this._send(command));
    this.commandSerial = promise.catch(() => {});
    return promise;
  }

  resync() {
    if (this.resyncPromise) return this.resyncPromise;
    if (!this.view.session || this.disposed) return Promise.reject(new Error('No active session'));
    const key = keyOf(this.view.session), token = this.id();
    this.resyncRequest = token;
    this.view.session.synchronized = false; this._invalidatePause(); this._notify();
    const run = async () => {
      // Bounded retries handle another gap/overflow without an unbounded busy loop.
      for (let attempt = 0; attempt < 3; ++attempt) {
        const requestId = this.id();
        const reply = await this.adapter.resync({ requestId, key });
        const current = this.view.session, snapshot = reply?.snapshot;
        if (this.disposed || this.resyncRequest !== token || !same(current, key)) return null;
        if (reply.requestId !== requestId || !same(snapshot, key) || !Number.isSafeInteger(snapshot.eventSeq) || snapshot.eventSeq < current.eventSeq) throw new Error('Rejected an outdated or mismatched session snapshot');
        const hadOverflow = this.bufferOverflow;
        const pending = this.buffer.filter(e => e.eventSeq > snapshot.eventSeq).sort((a, b) => a.eventSeq - b.eventSeq);
        this.buffer = []; this.bufferOverflow = false;
        this._invalidatePause();
        this.view.session = { ...keyOf(snapshot), state: snapshot.state, eventSeq: snapshot.eventSeq, synchronized: true, pendingControl: null };
        const s = this.view.session;
        if (snapshot.pause) Object.assign(s, { pauseId: snapshot.pause.pauseId, reason: snapshot.pause.reason, ...(snapshot.pause.position ? { position: copy(snapshot.pause.position) } : {}) });
        if (snapshot.termination) s.termination = copy(snapshot.termination);
        if (snapshot.failure) s.failure = copy(snapshot.failure);
        this.view.breakpoints = copy(snapshot.breakpoints ?? []);
        this.view.outputTail = []; this.view.outputTruncated = Boolean(snapshot.outputTruncated);
        for (const part of snapshot.outputTail ?? []) this._appendOutput(part);
        let gap = false;
        for (const event of pending) {
          if (event.eventSeq <= s.eventSeq || terminal(s.state)) continue;
          if (event.eventSeq !== s.eventSeq + 1) { gap = true; this._buffer(event); }
          else if (gap) this._buffer(event);
          else this._applyEvent(event);
        }
        if (!gap && !hadOverflow) { this._notify(); return this.getView(); }
        s.synchronized = false; this._invalidatePause(); this._notify();
      }
      throw new Error('Session is still out of sync; try synchronizing again');
    };
    const promise = run().catch(error => {
      if (same(this.view.session, key) && this.resyncRequest === token) { this.view.session.synchronized = false; this._invalidatePause(); this._error(error); }
      throw error;
    }).finally(() => {
      if (this.resyncRequest === token) { this.resyncPromise = null; this._autoInspect(); }
    });
    this.resyncPromise = promise;
    return promise;
  }

  async refreshStack() {
    if (!this.getView().actions.inspect) return null;
    const s = this.view.session, key = { ...keyOf(s), pauseId: s.pauseId }, epoch = this.queryEpoch, requestId = this.id();
    this.stackRequest = requestId;
    const reply = await this._safeQuery({ requestId, kind: 'stack', key, start: 0, count: 100 }, epoch);
    if (!reply || !this._pauseMatches(key, epoch) || this.stackRequest !== requestId || reply.requestId !== requestId || !same(reply.key, key) || reply.key.pauseId !== key.pauseId) return null;
    this.stackRequest = null;
    if (reply.kind !== 'stack') { this._error(reply.message ?? 'Unable to load stack'); return reply; }
    this.view.frames = copy(reply.frames); this.view.stackTotal = reply.total; this._notify();
    if (reply.frames.length) await this.selectFrame(reply.frames[0].frameId);
    return reply;
  }
  async selectFrame(frameId) {
    if (!this.getView().actions.inspect || !this.view.frames.some(frame => frame.frameId === frameId)) return null;
    const s = this.view.session;
    ++this.queryEpoch; this.stackRequest = null;
    s.frameId = frameId; this.view.scopes = []; this.view.scopePages = []; this.view.variables = []; this._notify();
    const key = { ...keyOf(s), pauseId: s.pauseId, frameId }, epoch = this.queryEpoch, requestId = this.id();
    const reply = await this._safeQuery({ requestId, kind: 'scopes', key }, epoch);
    if (!this._validReply(reply, key, epoch, requestId)) return null;
    if (reply.kind !== 'scopes') { this._error(reply.message ?? 'Unable to load scopes'); return reply; }
    this.view.scopes = copy(reply.scopes); this._notify();
    const values = [];
    const pages = [];
    for (const scope of reply.scopes) {
      const part = await this.variables(scope.variablesReference, { start: 0, count: 100 });
      if (!this._pauseMatches(key, epoch)) return null;
      if (part?.kind === 'variables') {
        values.push(...part.variables.map(variable => ({ ...variable, scopeName: scope.name, scopeReference: scope.variablesReference })));
        pages.push({ scopeName: scope.name, variablesReference: scope.variablesReference, nextStart: part.variables.length, hasMore: part.hasMore, ...(part.total === undefined ? {} : { total: part.total }) });
      }
    }
    if (this._pauseMatches(key, epoch)) { this.view.variables = values; this.view.scopePages = pages; this._notify(); }
    return reply;
  }
  async loadMoreScope(variablesReference) {
    const page = this.view.scopePages.find(item => item.variablesReference === variablesReference);
    if (!page?.hasMore) return null;
    const s = this.view.session, key = { ...keyOf(s), pauseId: s.pauseId, frameId: s.frameId }, epoch = this.queryEpoch;
    // Avoid duplicate pagination requests appending the same page twice.
    if (page.loading) return null;
    page.loading = true; this._notify();
    const reply = await this.variables(variablesReference, { start: page.nextStart, count: 100 });
    if (!this._pauseMatches(key, epoch) || !this.view.scopePages.includes(page)) return null;
    page.loading = false;
    if (reply?.kind === 'variables') {
      this.view.variables.push(...reply.variables.map(variable => ({ ...variable, scopeName: page.scopeName, scopeReference: variablesReference })));
      page.nextStart += reply.variables.length; page.hasMore = reply.hasMore;
      if (reply.total !== undefined) page.total = reply.total;
      if (!reply.variables.length && reply.hasMore) { page.hasMore = false; this._error('Variable page made no progress; some values remain unread'); }
    }
    this._notify();
    return reply;
  }
  _validReply(reply, key, epoch, requestId) {
    return this._pauseMatches(key, epoch) && reply?.requestId === requestId && same(reply.key, key) && reply.key.pauseId === key.pauseId && reply.key.frameId === key.frameId;
  }
  async _safeQuery(query, epoch) {
    try { return await this.adapter.query(query); }
    catch (error) { if (this._pauseMatches(query.key, epoch)) this._error(error); return null; }
  }
  async _frameQuery(kind, extra) {
    const s = this.view.session;
    if (!this.getView().actions.inspect || !s.frameId) return null;
    const key = { ...keyOf(s), pauseId: s.pauseId, frameId: s.frameId }, epoch = this.queryEpoch, requestId = this.id();
    const reply = await this._safeQuery({ requestId, kind, key, ...extra }, epoch);
    if (!this._validReply(reply, key, epoch, requestId)) return null;
    if (reply.kind === 'error') this._error(reply.message);
    return reply;
  }
  variables(variablesReference, { start = 0, count = 100 } = {}) {
    return this._frameQuery('variables', { variablesReference, start, count: Math.max(1, Math.min(this.variablePageSize, count)) });
  }
  evaluate(expression) { return this._frameQuery('evaluate', { expression, allowSideEffects: false }); }
  dispose() { this.disposed = true; this.resyncRequest = null; ++this.queryEpoch; this.unsubscribe?.(); }
}
