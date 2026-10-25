import { AT, TAG, Reader } from './dwarf.mjs';

const utf8 = new TextDecoder('utf-8', { fatal: false });
const MAX_PAGE = 100, MAX_STRING = 1024, MAX_ELEMENTS = 1000000;
class InspectionError extends Error {
  constructor(message, state = 'unavailable') { super(message); this.state = state; }
}
const fail = (message, state) => { throw new InspectionError(message, state); };
const unavailable = (name, type, error) => ({ name, type, value: `<${error.state ?? 'error'}>`,
  state: error.state ?? 'error', reason: error.message, namedVariables: 0, indexedVariables: 0 });
const addressNumber = value => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 0xffffffff) fail('Address is outside wasm32 memory');
  return number;
};

export class VariableInspector {
  constructor(symbols, runtime) {
    this.symbols = symbols; this.runtime = runtime; this.declarations = new Map();
    this.lifetimeTracking = typeof runtime.registerDeclarationSites === 'function' &&
      typeof runtime.declarationEpoch === 'function' && typeof runtime.wasMemoryWrittenSince === 'function';
    this.declarationSiteErrors = new Map();
    if (this.lifetimeTracking) this._registerDeclarations();
  }
  _registerDeclarations() {
    const sites = new Set();
    for (const die of this.symbols.dies.values()) {
      if (die.tag !== TAG.variable) continue;
      let fn = die.parent;
      while (fn && ![TAG.subprogram, TAG.inline].includes(fn.tag)) fn = fn.parent;
      if (!fn || !this.symbols.ranges(fn).length) continue;
      const declaration = this._declaration(die, fn);
      if (declaration.trackingPC === undefined) continue;
      const pc = declaration.trackingPC;
      // Do not repair an arbitrary line-table address to a nearby instruction.
      // executablePC only normalizes Clang's documented local-vector entry row.
      if (!this.runtime.functions.some(fn => fn.instructions?.has(pc))) {
        this.declarationSiteErrors.set(pc, 'Declaration does not map to an instruction boundary');
        continue;
      }
      sites.add(pc);
    }
    try { this.runtime.registerDeclarationSites([...sites].map(pc => ({ pc }))); }
    catch (error) {
      // Registration is atomic. No variable may fall back to writes from an old
      // lifetime when metadata could not be installed or was installed too late.
      for (const pc of sites) this.declarationSiteErrors.set(pc, error.message);
    }
  }
  _memory(address, size) {
    const memory = this.runtime.memory;
    if (!(memory instanceof Uint8Array)) fail('Runtime linear memory is unavailable');
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(size) || address < 0 || size < 0 || address + size > memory.length)
      fail('Memory range is outside current linear memory');
    return new DataView(memory.buffer, memory.byteOffset + address, size);
  }
  _uint(address, size) {
    const view = this._memory(address, size);
    if (size === 1) return BigInt(view.getUint8(0));
    if (size === 2) return BigInt(view.getUint16(0, true));
    if (size === 4) return BigInt(view.getUint32(0, true));
    if (size === 8) return view.getBigUint64(0, true);
    fail(`Unsupported integer storage size ${size}`, 'unsupported');
  }
  _initialized(frame, address, size, required) {
    if (!required || !this.runtime.wasMemoryWritten) return;
    let written;
    if (required === true) written = this.runtime.wasMemoryWritten(frame, address, size);
    else {
      if (this.runtime.declarationEpoch(frame, required.pc) !== required.epoch)
        fail('Variable reference no longer belongs to the current declaration lifetime');
      written = this.runtime.wasMemoryWrittenSince(frame, address, size, required.epoch);
    }
    if (written === false) fail(required === true ? 'Storage has not been initialized during this frame'
      : 'Storage has not been initialized during this declaration lifetime');
    if (written !== true) fail('Initialization provenance is incomplete for this declaration lifetime');
  }
  _frameBase(frame, fn) {
    const expression = this.symbols.locationExpression(fn, AT.frameBase, frame.pc);
    if (!expression) fail('No DWARF frame base is available');
    return addressNumber(this._expression(expression, frame, fn, true).value);
  }
  _expression(bytes, frame, fn, evaluatingBase = false) {
    const r = new Reader(bytes), stack = []; let operations = 0, stackValue = false;
    const push = (value, direct = false) => stack.push({ value, direct });
    const pop = () => { if (!stack.length) fail('DWARF expression stack underflow', 'unsupported'); return stack.pop(); };
    // LLVM 8 omitted the base expression for stack slots. Accept only the
    // independently checked producer + exact executable prologue, not a guessed
    // stack pointer or an arbitrary initial operand for malformed expressions.
    if (bytes[0] === 0x23 && this.symbols.attr(fn, AT.frameBase) === undefined) {
      const base = this.symbols.legacyFrameBase(frame);
      if (!base) fail('Legacy Clang stack base is not established for this frame', 'unsupported');
      const check = new Reader(bytes); check.u8(); const offset = check.uleb();
      if (check.pos !== check.end || offset >= base.size) fail('Unsupported legacy stack-slot expression', 'unsupported');
      push(BigInt(base.address));
    }
    while (r.pos < r.end) {
      if (++operations > 256 || stack.length > 64) fail('DWARF expression complexity limit', 'unsupported');
      const op = r.u8();
      if (op >= 0x30 && op <= 0x4f) { push(BigInt(op - 0x30)); continue; }
      switch (op) {
        case 0x03: push(BigInt(r.u32())); break;
        case 0x06: push(this._uint(addressNumber(pop().value), fn.cu.addressSize)); break;
        case 0x08: push(BigInt(r.u8())); break;
        case 0x09: push(BigInt.asIntN(8, BigInt(r.u8()))); break;
        case 0x0a: push(BigInt(r.u16())); break;
        case 0x0b: push(BigInt.asIntN(16, BigInt(r.u16()))); break;
        case 0x0c: push(BigInt(r.u32())); break;
        case 0x0d: push(BigInt.asIntN(32, BigInt(r.u32()))); break;
        case 0x0e: push(r.uint(8)); break;
        case 0x0f: push(BigInt.asIntN(64, r.uint(8))); break;
        case 0x10: push(r.leb(false, true)); break;
        case 0x11: push(r.leb(true, true)); break;
        case 0x12: { const value = pop(); stack.push(value, { ...value }); break; }
        case 0x13: pop(); break;
        case 0x14: { if (stack.length < 2) fail('DWARF expression stack underflow', 'unsupported'); stack.push({ ...stack.at(-2) }); break; }
        case 0x16: { const b = pop(), a = pop(); stack.push(b, a); break; }
        case 0x1c: { const b = pop().value; push(BigInt(pop().value) - BigInt(b)); break; }
        case 0x1e: { const b = pop().value; push(BigInt(pop().value) * BigInt(b)); break; }
        case 0x22: { const b = pop().value; push(BigInt(pop().value) + BigInt(b)); break; }
        case 0x23: push(BigInt(pop().value) + r.leb(false, true)); break;
        case 0x91: {
          if (evaluatingBase) fail('Recursive DWARF frame base', 'unsupported');
          push(BigInt(this._frameBase(frame, fn)) + r.leb(true, true)); break;
        }
        case 0x94: { const size = r.u8(); push(this._uint(addressNumber(pop().value), size)); break; }
        case 0x96: break;
        case 0x9f: stackValue = true; break;
        case 0xed: {
          const kind = r.u8(), index = kind === 3 ? r.u32() : r.uleb(); let value;
          if (kind === 0) value = frame.locals[index];
          else if (kind === 1 || kind === 3) value = this.runtime.globals[index];
          else if (kind === 2) value = frame.stack?.[index];
          else fail(`Unsupported DW_OP_WASM_location kind ${kind}`, 'unsupported');
          if (typeof value !== 'number' && typeof value !== 'bigint') fail('Wasm location is not available in this frame');
          push(value, true); break;
        }
        default: fail(`Unsupported DWARF expression opcode 0x${op.toString(16)}`, 'unsupported');
      }
    }
    if (stack.length !== 1) fail('DWARF expression does not produce one location', 'unsupported');
    const result = stack[0];
    return { kind: stackValue || result.direct ? 'value' : 'memory', value: result.value };
  }
  _declaration(die, fn) {
    if (this.declarations.has(die.offset)) return this.declarations.get(die.offset);
    const scopes = [];
    for (let scope = die.parent; scope && scope !== fn; scope = scope.parent)
      if ([TAG.lexical, TAG.inline].includes(scope.tag)) scopes.push(scope);
    const line = this.symbols.attr(die, 0x3b), file = this.symbols.attr(die, 0x3a);
    // A source line can occur at several distinct PCs: for-init, condition and
    // increment all map to the loop header. Only its first statement position
    // in this declaration's own lexical scope is the initialization boundary.
    const row = die.tag === TAG.variable && line !== undefined && file !== undefined
      ? this.symbols.rows.find(row => row.cu === die.cu && row.file === file && row.line === line &&
        row.isStmt && !row.endSequence && this.symbols.contains(fn, row.pc) &&
        scopes.every(scope => !this.symbols.ranges(scope).length || this.symbols.contains(scope, row.pc)))
      : undefined;
    const result = { pc: row?.pc, trackingPC: row ? this.symbols.executablePC(row.pc) : undefined,
      line, file, depth: scopes.length };
    this.declarations.set(die.offset, result); return result;
  }
  _pendingInitializerCall(frame, die, declaration, address, type) {
    const frames = this.runtime.frames;
    if (!frames || frames.at(-1) === frame || !frames.includes(frame)) return false;
    const call = this.runtime.functions[frame.funcIndex]?.instructions?.get(frame.callPC);
    if (!call || ![0x10, 0x11].includes(call.op) || call.nextPC !== frame.pc) return false;
    const row = this.symbols.row(call.pc);
    if (row?.cu !== die.cu || row.file !== declaration.file || row.line !== declaration.line) return false;
    // Several complete declarations and unrelated calls can share a source
    // line. Block only an actual constructor for this object's real storage.
    // Read `this` from its DWARF location rather than assuming Wasm argument 0.
    const callee = frames[frames.indexOf(frame) + 1], fn = this.symbols.subprogram(callee.pc);
    const parameter = fn?.children.find(child => child.tag === TAG.parameter &&
      this.symbols.attr(child, AT.artificial) && this.symbols.attr(child, AT.name) === 'this');
    const pointer = this.symbols.canonical(this.symbols.type(parameter));
    if (pointer?.tag !== TAG.pointer) return false;
    const target = this.symbols.canonical(this.symbols.type(pointer));
    const element = type.tag === TAG.array ? this.symbols.canonical(this.symbols.type(type)) : type;
    if (!target || !element || target.offset !== element.offset) return false;
    const className = this.symbols.attr(target, AT.name)?.split('<')[0];
    if (!className || this.symbols.attr(fn, AT.name) !== className) return false;
    try {
      const expression = this.symbols.locationExpression(parameter, AT.location, callee.pc);
      if (!expression) return false;
      const location = this._expression(expression, callee, fn);
      const object = addressNumber(location.kind === 'memory'
        ? this._uint(addressNumber(location.value), 4) : location.value);
      const size = this.symbols.byteSize(element), total = this.symbols.byteSize(type);
      return !!size && !!total && object >= address && object + size <= address + total &&
        (object - address) % size === 0;
    } catch { return false; }
  }
  locals(frame) {
    return this.symbols.variables(frame.pc).map(({ die, inScope, function: fn }) => {
      const name = this.symbols.attr(die, AT.name) ?? '<anonymous>', type = this.symbols.type(die);
      const declaration = this._declaration(die, fn), row = this.symbols.row(frame.pc);
      const beforeLine = row && row.file === declaration.file && declaration.line > row.line && row.line > 0;
      const context = { _lexicalInScope: inScope, _scopeDepth: declaration.depth,
        _declarationReached: declaration.pc === undefined ? !beforeLine : frame.pc >= declaration.pc };
      try {
        if (!inScope) fail('Variable is outside its lexical scope', 'outOfScope');
        // A stop before the declaration instruction must hide the old lifetime.
        // Once it executes, the runtime advances its epoch independently of any
        // variable query. Only writes at/after that execution establish a value.
        if (die.tag === TAG.variable && (declaration.pc !== undefined ? frame.pc <= declaration.pc :
          row && row.file === declaration.file && declaration.line >= row.line && row.line > 0))
          fail('Variable declaration has not executed at this stop', 'outOfScope');
        let initialized = true;
        if (die.tag === TAG.variable && this.lifetimeTracking) {
          const pc = declaration.trackingPC, error = this.declarationSiteErrors.get(pc);
          if (pc === undefined || error) fail(error ?? 'No executable declaration site is available');
          const epoch = this.runtime.declarationEpoch(frame, pc);
          if (epoch === null) fail('Declaration execution provenance is unavailable for this frame');
          if (epoch === 0) fail('Storage has not been initialized during this declaration lifetime; its declaration site was not executed');
          initialized = { pc, epoch };
        }
        const constant = this.symbols.attr(die, AT.constValue);
        if (constant !== undefined) return { ...this._read(type, { immediate: constant }, name, frame), ...context };
        const expression = this.symbols.locationExpression(die, AT.location, frame.pc);
        if (!expression || !expression.length) fail('No location is available at this PC', 'optimizedOut');
        const location = this._expression(expression, frame, fn);
        const canonical = this.symbols.canonical(type);
        if (initialized !== true && location.kind === 'memory' &&
          [TAG.array, TAG.structure, TAG.class, TAG.union].includes(canonical?.tag) &&
          this._pendingInitializerCall(frame, die, declaration, addressNumber(location.value), canonical))
          fail('Aggregate initializer call has not completed for this declaration lifetime');
        return { ...this._read(type, location.kind === 'memory' ? { address: addressNumber(location.value) } : { immediate: location.value }, name, frame, 0, initialized), ...context };
      } catch (error) { return { ...unavailable(name, this.symbols.typeName(type), error), ...context }; }
    });
  }
  _read(type, storage, name, frame, depth = 0, requireInitialized = false) {
    const displayType = this.symbols.typeName(type), canonical = this.symbols.canonical(type);
    const result = { name, type: displayType, value: '', state: 'available', namedVariables: 0, indexedVariables: 0,
      _type: type, _frame: frame, _requiresInitialized: requireInitialized, ...storage };
    try {
      if (depth > 24) fail('Type indirection depth limit', 'unsupported');
      if (!canonical) fail('No concrete type information', 'unsupported');
      const size = this.symbols.byteSize(canonical);
      if (storage.address !== undefined && size !== undefined) this._memory(storage.address, size);
      const scalar = () => {
        if (storage.immediate !== undefined) return storage.immediate;
        this._initialized(frame, storage.address, size, requireInitialized);
        return this._uint(storage.address, size);
      };
      if ([TAG.pointer, TAG.reference, TAG.rvalueReference].includes(canonical.tag)) {
        const pointer = BigInt.asUintN(32, BigInt(scalar())), target = this.symbols.type(canonical);
        if ([TAG.reference, TAG.rvalueReference].includes(canonical.tag)) {
          if (!pointer) fail('Null reference');
          const dereferenced = this._read(target, { address: addressNumber(pointer) }, name, frame, depth + 1);
          return { ...dereferenced, type: displayType, _referenceType: type };
        }
        result.value = `0x${pointer.toString(16).padStart(8, '0')}`;
        result._scalar = pointer; result._pointerTarget = target;
        if (target) result.namedVariables = 1;
      } else if ([TAG.base, TAG.enumeration].includes(canonical.tag)) {
        const encoding = this.symbols.attr(canonical, AT.encoding) ?? this.symbols.attr(this.symbols.canonical(this.symbols.type(canonical)), AT.encoding);
        if (encoding === 4) {
          let value;
          if (storage.immediate !== undefined) value = Number(storage.immediate);
          else { this._initialized(frame, storage.address, size, requireInitialized); const view = this._memory(storage.address, size); value = size === 4 ? view.getFloat32(0, true) : size === 8 ? view.getFloat64(0, true) : fail('Unsupported floating-point size', 'unsupported'); }
          result.value = String(value); result._scalar = value; result._floatBits = size * 8;
        } else {
          if (![1, 2, 5, 6, 7, 8, 0x10].includes(encoding) && canonical.tag !== TAG.enumeration)
            fail(`Unsupported scalar encoding ${encoding}`, 'unsupported');
          if (!Number.isSafeInteger(size) || size < 1 || size > 8) fail('Unsupported scalar size', 'unsupported');
          let value = BigInt(scalar());
          value = [5, 6].includes(encoding) ? BigInt.asIntN(size * 8, value) : BigInt.asUintN(size * 8, value);
          result._scalar = value;
          result._integer = { bits: size * 8, signed: [5, 6].includes(encoding), boolean: encoding === 2 };
          result.value = encoding === 2 ? (value === 0n ? 'false' : 'true') : value.toString();
          if ([6, 8].includes(encoding) && size === 1) result.value += ` ${JSON.stringify(String.fromCharCode(Number(BigInt.asUintN(8, value))))}`;
          if (canonical.tag === TAG.enumeration) {
            const enumerator = canonical.children.find(die => die.tag === TAG.enumerator && BigInt(this.symbols.attr(die, AT.constValue)) === value);
            if (enumerator) result.value = `${this.symbols.attr(enumerator, AT.name)} (${value})`;
          }
        }
      } else if (canonical.tag === TAG.array) {
        if (storage.address === undefined) fail('Aggregate has no memory location', 'unsupported');
        if (this.symbols.arrayDimensions(canonical)?.length > 1)
          fail('Multidimensional array indexing is outside the supported inspection subset', 'unsupported');
        const count = this.symbols.arrayCount(canonical), element = this.symbols.type(canonical), itemSize = this.symbols.byteSize(element);
        if (count === undefined || !itemSize) fail('Array bounds or element size unavailable', 'unsupported');
        if (count > MAX_ELEMENTS) fail('Array exceeds inspection element limit', 'unsupported');
        this._memory(storage.address, count * itemSize);
        result.value = `${displayType} (${count} elements)`; result.indexedVariables = count;
        result._elements = { type: element, address: storage.address, count, stride: itemSize };
      } else if ([TAG.structure, TAG.class, TAG.union].includes(canonical.tag)) {
        if (storage.address === undefined) fail('Aggregate has no memory location', 'unsupported');
        if (this._isLibcxx(canonical, 'basic_string<')) this._string(result, canonical);
        else if (this._isLibcxx(canonical, 'vector<')) this._vector(result, canonical);
        else {
          const members = this._members(canonical);
          result.value = `{${this.symbols.typeName(canonical)}}`; result.namedVariables = members.length;
          result._members = members;
        }
      } else fail(`Unsupported type tag 0x${canonical.tag.toString(16)}`, 'unsupported');
      return result;
    } catch (error) { return unavailable(name, displayType, error); }
  }
  _isLibcxx(type, prefix) {
    if (!this.symbols.typeName(type).startsWith(prefix)) return false;
    let parent = type.parent;
    if (this.symbols.attr(parent, AT.name) !== '__2') return false;
    parent = parent.parent;
    return this.symbols.attr(parent, AT.name) === 'std';
  }
  _memberOffset(die) {
    const offset = this.symbols.attr(die, AT.memberLocation);
    if (typeof offset === 'number') return offset;
    if (offset instanceof Uint8Array) {
      const r = new Reader(offset);
      // A data-member expression has the containing object on its initial stack.
      if (r.u8() === 0x23) { const n = r.uleb(); if (r.pos === r.end) return n; }
    }
    fail('Member offset is unavailable or requires unsupported DWARF evaluation', 'unsupported');
  }
  _members(type, base = 0, depth = 0) {
    if (depth > 24) fail('Aggregate nesting limit', 'unsupported');
    const members = [];
    for (const die of type.children) {
      if (![TAG.member, TAG.inheritance].includes(die.tag)) continue;
      // Static members are constants or separate locations, not object fields.
      if (this.symbols.attr(die, AT.declaration) && this.symbols.attr(die, AT.memberLocation) === undefined) continue;
      const offset = base + this._memberOffset(die), memberType = this.symbols.type(die), canonical = this.symbols.canonical(memberType);
      const name = this.symbols.attr(die, AT.name);
      if ((die.tag === TAG.inheritance || !name) && canonical && [TAG.class, TAG.structure, TAG.union].includes(canonical.tag))
        members.push(...this._members(canonical, offset, depth + 1));
      else members.push({ name: name ?? '<anonymous>', type: memberType, offset, die });
    }
    return members;
  }
  _find(type, path) {
    let offset = 0, member;
    for (const name of path) {
      const candidates = this._members(this.symbols.canonical(type)).filter(item => item.name === name);
      if (candidates.length !== 1) fail(`Unrecognized libc++ layout: ${name}`, 'unsupported');
      member = candidates[0]; offset += member.offset; type = member.type;
    }
    return { ...member, offset, type };
  }
  _vector(result, type) {
    const begin = this._find(type, ['__begin_']), end = this._find(type, ['__end_']);
    const cap = this._find(type, ['__end_cap_', '__value_']);
    const element = this.symbols.type(this.symbols.canonical(begin.type));
    const stride = this.symbols.byteSize(element);
    if (!stride || this.symbols.byteSize(begin.type) !== 4 || this.symbols.byteSize(end.type) !== 4 || this.symbols.byteSize(cap.type) !== 4)
      fail('Unrecognized libc++ vector pointer layout', 'unsupported');
    const start = Number(this._uint(result.address + begin.offset, 4));
    const finish = Number(this._uint(result.address + end.offset, 4));
    const limit = Number(this._uint(result.address + cap.offset, 4));
    for (const member of [begin, end, cap]) this._initialized(result._frame, result.address + member.offset, 4, result._requiresInitialized);
    if (start > finish || finish > limit || (finish - start) % stride || (limit - start) % stride)
      fail('Invalid libc++ vector begin/end/capacity');
    const count = (finish - start) / stride, capacity = (limit - start) / stride;
    if (capacity > MAX_ELEMENTS) fail('Vector exceeds inspection element limit', 'unsupported');
    if (!start && (count || capacity)) fail('Null vector storage');
    this._memory(start, limit - start);
    result.value = `vector(size=${count}, capacity=${capacity})`;
    result.indexedVariables = count; result._elements = { type: element, address: start, stride, count };
  }
  _string(result, type) {
    const shortMask = type.children.find(die => this.symbols.attr(die, AT.name) === '__short_mask');
    const longMask = type.children.find(die => this.symbols.attr(die, AT.name) === '__long_mask');
    const mask = Number(this.symbols.attr(shortMask, AT.constValue));
    const capMask = BigInt(this.symbols.attr(longMask, AT.constValue) ?? 0);
    if (!((mask === 128 && capMask === 0x80000000n) || (mask === 1 && capMask === 1n)))
      fail('Unrecognized libc++ string discriminator', 'unsupported');
    const rep = ['__r_', '__value_'];
    const shortSize = this._find(type, [...rep, '__s', '__size_']);
    const shortData = this._find(type, [...rep, '__s', '__data_']);
    const longData = this._find(type, [...rep, '__l', '__data_']);
    const longSize = this._find(type, [...rep, '__l', '__size_']);
    const longCap = this._find(type, [...rep, '__l', '__cap_']);
    const element = this.symbols.type(this.symbols.canonical(longData.type));
    if (this.symbols.byteSize(element) !== 1 || this.symbols.byteSize(shortSize.type) !== 1 || this.symbols.byteSize(longSize.type) !== 4)
      fail('Only verified one-byte libc++ strings are supported', 'unsupported');
    const marker = Number(this._uint(result.address + shortSize.offset, 1));
    this._initialized(result._frame, result.address + shortSize.offset, 1, result._requiresInitialized);
    let length, data, capacity;
    if (marker & mask) {
      length = Number(this._uint(result.address + longSize.offset, 4));
      data = Number(this._uint(result.address + longData.offset, 4));
      const rawCap = this._uint(result.address + longCap.offset, 4);
      for (const member of [longData, longSize, longCap]) this._initialized(result._frame, result.address + member.offset, 4, result._requiresInitialized);
      if (!(rawCap & capMask)) fail('Inconsistent libc++ string representation');
      capacity = Number(rawCap & (0xffffffffn ^ capMask)) - 1;
    } else {
      length = mask === 1 ? marker >>> 1 : marker;
      data = result.address + shortData.offset;
      capacity = this.symbols.arrayCount(this.symbols.canonical(shortData.type)) - 1;
    }
    if (!Number.isSafeInteger(capacity) || capacity < 0 || length > capacity || length > MAX_ELEMENTS || (!data && length))
      fail('Invalid libc++ string size/capacity/data');
    this._memory(data, length + 1);
    if (this.runtime.memory[data + length] !== 0) fail('String terminator is not present at its DWARF-derived size');
    const shown = Math.min(length, MAX_STRING);
    result.value = JSON.stringify(utf8.decode(this.runtime.memory.subarray(data, data + shown)));
    if (shown < length) { result.value += `… (${length} bytes)`; result.truncated = true; }
    result.indexedVariables = length;
    result._elements = { type: element, address: data, stride: 1, count: length };
  }
  children(value, start = 0, count = MAX_PAGE) {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0)
      return [unavailable('<page>', '', new InspectionError('Invalid variable page', 'error'))];
    const limit = Math.min(count, MAX_PAGE), frame = value._frame;
    if (value.state !== 'available') return [];
    if (value._pointerTarget) {
      if (start || !limit) return [];
      try {
        const address = addressNumber(value._scalar);
        if (!address) fail('Cannot dereference a null pointer');
        return [this._read(value._pointerTarget, { address }, `*${value.name}`, frame)];
      } catch (error) { return [unavailable(`*${value.name}`, this.symbols.typeName(value._pointerTarget), error)]; }
    }
    if (value._elements) {
      const { type, address, stride, count: total } = value._elements, result = [];
      for (let i = start; i < Math.min(start + limit, total); i++) result.push(this._read(type, { address: address + stride * i }, `[${i}]`, frame, 0,
        this.symbols.canonical(value._type)?.tag === TAG.array ? value._requiresInitialized : false));
      return result;
    }
    if (value._members) return value._members.slice(start, start + limit).map(member => {
      if (this.symbols.attr(member.die, AT.bitSize) !== undefined)
        return unavailable(member.name, this.symbols.typeName(member.type), new InspectionError('Bit-field extraction is unsupported', 'unsupported'));
      return this._read(member.type, { address: value.address + member.offset }, member.name, frame, 0, value._requiresInitialized);
    });
    return [];
  }
  evaluate(frame, expression) {
    try { return new ExpressionParser(this, frame, expression).parse(); }
    catch (error) { return unavailable(expression, '<expression>', error); }
  }
}

// A bounded parser, deliberately independent of JavaScript eval or target calls.
const precedence = new Map([['||', 1], ['&&', 2], ['|', 3], ['^', 4], ['&', 5],
  ['==', 6], ['!=', 6], ['<', 7], ['>', 7], ['<=', 7], ['>=', 7], ['<<', 8], ['>>', 8],
  ['+', 9], ['-', 9], ['*', 10], ['/', 10], ['%', 10]]);
class ExpressionParser {
  constructor(inspector, frame, expression) {
    if (typeof expression !== 'string' || !expression.trim() || expression.length > 2048)
      fail('Expression must contain 1–2048 characters', 'unsupported');
    this.inspector = inspector; this.frame = frame; this.expression = expression;
    this.tokens = []; this.pos = 0; this.depth = 0;
    const token = /\s*(?:(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([A-Za-z_$][\w$]*)|(->|\+\+|--|<<|>>|<=|>=|==|!=|&&|\|\||[+\-*/%~!<>&|^()[\].=,?:]))/y;
    let offset = 0;
    while (offset < expression.length) {
      if (!expression.slice(offset).trim()) break;
      token.lastIndex = offset; const match = token.exec(expression);
      if (!match) fail('Unsupported expression token', 'unsupported');
      const text = match[1] ?? match[2] ?? match[3];
      if (['++', '--', '=', ',', '?', ':'].includes(text)) fail('Assignments, calls, and side effects are unsupported', 'unsupported');
      this.tokens.push({ text, kind: match[1] ? 'number' : match[2] ? 'identifier' : 'operator' });
      offset = token.lastIndex;
      if (this.tokens.length > 256) fail('Expression token limit', 'unsupported');
    }
    this.locals = inspector.locals(frame);
  }
  peek(text) { return this.tokens[this.pos]?.text === text; }
  take(text) {
    if (!this.peek(text)) fail(`Expected ${text}`, 'unsupported');
    this.pos++;
  }
  scalar(value) {
    if (value.state !== 'available') fail(value.reason ?? 'Expression operand is unavailable', value.state);
    if (value._scalar === undefined) fail('Scalar operand required', 'unsupported');
    return value._scalar;
  }
  literal(value, type = typeof value === 'number' ? 'double' : 'int', integer = typeof value === 'bigint' ? { bits: 32, signed: true } : undefined) {
    return { name: this.expression, type, value: String(value), state: 'available', namedVariables: 0,
      indexedVariables: 0, _scalar: value, _integer: integer,
      ...(typeof value === 'number' ? { _floatBits: 64 } : {}), _frame: this.frame };
  }
  integerType(value) {
    const type = value._integer;
    if (!type) fail('Integer type information is unavailable', 'unsupported');
    return type.bits < 32 || type.boolean ? { bits: 32, signed: true } : type;
  }
  converted(value, type) {
    return type.signed ? BigInt.asIntN(type.bits, value) : BigInt.asUintN(type.bits, value);
  }
  commonType(left, right) {
    const a = this.integerType(left), b = this.integerType(right);
    if (a.signed === b.signed) return { bits: Math.max(a.bits, b.bits), signed: a.signed };
    const signed = a.signed ? a : b, unsigned = a.signed ? b : a;
    return unsigned.bits >= signed.bits ? { bits: unsigned.bits, signed: false } : { bits: signed.bits, signed: true };
  }
  integerResult(value, type) {
    if (type.signed && (value < -(1n << BigInt(type.bits - 1)) || value >= 1n << BigInt(type.bits - 1)))
      fail('Signed integer overflow is outside the supported expression subset', 'unsupported');
    return this.literal(this.converted(value, type), `${type.signed ? '' : 'unsigned '}${type.bits === 64 ? 'long long' : 'int'}`, type);
  }
  numericLiteral(text) {
    if (/[.eE]/.test(text) && !/^0x/.test(text)) {
      const value = Number(text);
      if (!Number.isFinite(value)) fail('Floating literal is outside the finite supported range', 'unsupported');
      return this.literal(value);
    }
    const value = BigInt(text), candidates = /^0x/.test(text)
      ? [{ bits: 32, signed: true }, { bits: 32, signed: false }, { bits: 64, signed: true }, { bits: 64, signed: false }]
      : [{ bits: 32, signed: true }, { bits: 64, signed: true }];
    const type = candidates.find(type => value < 1n << BigInt(type.bits - (type.signed ? 1 : 0)));
    if (!type) fail('Integer literal is outside the supported 64-bit range', 'unsupported');
    return this.integerResult(value, type);
  }
  parse() {
    const value = this.binary(0);
    if (this.pos !== this.tokens.length) fail('Calls, casts, or trailing tokens are unsupported', 'unsupported');
    return { ...value, name: this.expression };
  }
  binary(minimum, evaluate = true) {
    if (++this.depth > 64) fail('Expression nesting limit', 'unsupported');
    let left = this.unary(evaluate);
    while (precedence.has(this.tokens[this.pos]?.text) && precedence.get(this.tokens[this.pos].text) >= minimum) {
      const op = this.tokens[this.pos++].text;
      const shortCircuit = evaluate && (op === '&&' && !this.scalar(left) || op === '||' && !!this.scalar(left));
      const right = this.binary(precedence.get(op) + 1, evaluate && !shortCircuit);
      if (!evaluate) { left = this.literal(0n); continue; }
      if (shortCircuit) { left = this.literal(op === '&&' ? 0n : 1n, 'bool', { bits: 8, signed: false, boolean: true }); continue; }
      const a = this.scalar(left), b = this.scalar(right);
      // Pointer arithmetic scales by the actual DWARF element size.
      if (left._pointerTarget && ['+', '-'].includes(op) && typeof b === 'bigint') {
        const size = this.inspector.symbols.byteSize(left._pointerTarget);
        if (!size) fail('Pointer target size unavailable', 'unsupported');
        left = { ...left, _scalar: a + (op === '+' ? b : -b) * BigInt(size) };
        left.value = `0x${addressNumber(left._scalar).toString(16).padStart(8, '0')}`; continue;
      }
      if (left._pointerTarget || right._pointerTarget) {
        if (!['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(op)) fail('Unsupported pointer operation', 'unsupported');
        if (!left._pointerTarget || !right._pointerTarget) {
          const integer = left._pointerTarget ? b : a;
          if (integer !== 0n || !['==', '!=', '&&', '||'].includes(op)) fail('Only null integer comparisons with pointers are supported', 'unsupported');
        }
      }
      const floating = typeof a === 'number' || typeof b === 'number';
      const logical = ['&&', '||'].includes(op), comparison = ['==', '!=', '<', '>', '<=', '>='].includes(op);
      const pointerComparison = !!(left._pointerTarget || right._pointerTarget);
      const shift = ['<<', '>>'].includes(op);
      const type = floating || logical || pointerComparison ? undefined : shift ? this.integerType(left) : this.commonType(left, right);
      const x = floating ? Number(a) : type ? this.converted(a, type) : a;
      const y = floating ? Number(b) : type && !shift ? this.converted(b, type) : b;
      if (['/', '%'].includes(op) && type?.signed && y === -1n && x === -(1n << BigInt(type.bits - 1)))
        fail('Signed integer division overflow is unsupported', 'unsupported');
      let result;
      switch (op) {
        case '+': result = x + y; break; case '-': result = x - y; break; case '*': result = x * y; break;
        case '/': if (y === 0n || y === 0) fail('Division by zero', 'error'); result = x / y; break;
        case '%': if (floating) fail('Integer remainder operands required', 'unsupported'); if (!y) fail('Division by zero', 'error'); result = x % y; break;
        case '==': result = BigInt(x === y); break; case '!=': result = BigInt(x !== y); break;
        case '<': result = BigInt(x < y); break; case '>': result = BigInt(x > y); break;
        case '<=': result = BigInt(x <= y); break; case '>=': result = BigInt(x >= y); break;
        case '&&': result = BigInt(!!x && !!y); break; case '||': result = BigInt(!!x || !!y); break;
        default:
          if (floating) fail('Integer bitwise operands required', 'unsupported');
          if (shift && (y < 0n || y >= BigInt(type.bits))) fail('Shift count outside promoted integer width', 'error');
          if (op === '<<' && type.signed && x < 0n) fail('Left shift of a negative signed integer is unsupported', 'unsupported');
          if (op === '<<') result = x << y; else if (op === '>>') result = x >> y;
          else if (op === '&') result = x & y; else if (op === '|') result = x | y; else if (op === '^') result = x ^ y;
      }
      if (comparison || logical) left = this.literal(result, 'bool', { bits: 8, signed: false, boolean: true });
      else if (floating) {
        const bits = Math.max(left._floatBits ?? 0, right._floatBits ?? 0);
        left = this.literal(bits === 32 ? Math.fround(result) : result, bits === 32 ? 'float' : 'double'); left._floatBits = bits;
      } else left = this.integerResult(result, type);
    }
    this.depth--; return left;
  }
  unary(evaluate = true) {
    const op = this.tokens[this.pos]?.text;
    if (['+', '-', '!', '~', '*', '&'].includes(op)) {
      this.pos++; const value = this.unary(evaluate);
      if (!evaluate) return this.literal(0n);
      if (op === '*') return this.dereference(value);
      if (op === '&') {
        if (value.address === undefined || !value._type) fail('Operand has no addressable location', 'unsupported');
        return { ...this.literal(BigInt(value.address), `${value.type}*`), value: `0x${value.address.toString(16).padStart(8, '0')}`,
          _pointerTarget: value._type, namedVariables: 1 };
      }
      const scalar = this.scalar(value);
      if (op === '~' && typeof scalar !== 'bigint') fail('Integer operand required', 'unsupported');
      if (op === '!') return this.literal(BigInt(!scalar), 'bool', { bits: 8, signed: false, boolean: true });
      if (value._pointerTarget) fail('Unary arithmetic on pointers is unsupported', 'unsupported');
      if (typeof scalar === 'number') return this.literal(op === '-' ? -scalar : scalar);
      const type = this.integerType(value), promoted = this.converted(scalar, type);
      return this.integerResult(op === '+' ? promoted : op === '-' ? -promoted : ~promoted, type);
    }
    return this.postfix(evaluate);
  }
  dereference(value) {
    if (!value._pointerTarget) fail('Pointer operand required', 'unsupported');
    const address = addressNumber(this.scalar(value)); if (!address) fail('Cannot dereference a null pointer');
    return this.inspector._read(value._pointerTarget, { address }, `*${value.name}`, this.frame);
  }
  postfix(evaluate = true) {
    let value;
    if (this.peek('(')) { this.pos++; value = this.binary(0, evaluate); this.take(')'); }
    else {
      const token = this.tokens[this.pos++];
      if (!token) fail('Incomplete expression', 'unsupported');
      if (token.kind === 'number') value = this.numericLiteral(token.text);
      else if (token.kind === 'identifier') {
        if (!evaluate) value = this.literal(0n);
        else if (token.text === 'true' || token.text === 'false') value = this.literal(BigInt(token.text === 'true'), 'bool');
        else {
          const visible = this.locals.filter(value => value.name === token.text && value._lexicalInScope && value._declarationReached);
          const depth = Math.max(...visible.map(value => value._scopeDepth));
          const matches = visible.filter(value => value._scopeDepth === depth);
          if (matches.length !== 1) fail(`Identifier ${token.text} is unavailable or ambiguous`);
          value = matches[0];
        }
      } else fail('Unsupported primary expression', 'unsupported');
    }
    while (true) {
      if (this.peek('[')) {
        this.pos++; const indexValue = this.binary(0, evaluate); this.take(']');
        if (!evaluate) { value = this.literal(0n); continue; }
        const index = this.scalar(indexValue);
        if (typeof index !== 'bigint' || index < 0n || index > BigInt(MAX_ELEMENTS)) fail('Array index outside inspection bounds', 'error');
        if (value._elements) {
          const { type, address, stride, count } = value._elements;
          if (index >= BigInt(count)) fail('Array index is out of bounds', 'error');
          value = this.inspector._read(type, { address: address + Number(index) * stride }, `[${index}]`, this.frame, 0,
            this.inspector.symbols.canonical(value._type)?.tag === TAG.array ? value._requiresInitialized : false);
        } else if (value._pointerTarget) {
          const size = this.inspector.symbols.byteSize(value._pointerTarget);
          if (!size) fail('Pointer target size unavailable', 'unsupported');
          const base = this.scalar(value); if (!base) fail('Cannot index a null pointer');
          value = this.inspector._read(value._pointerTarget, { address: addressNumber(base + index * BigInt(size)) }, `[${index}]`, this.frame);
        } else fail('Array, vector, string, or pointer operand required', 'unsupported');
      } else if (this.peek('.') || this.peek('->')) {
        const pointer = this.peek('->'); this.pos++;
        if (pointer && evaluate) value = this.dereference(value);
        const member = this.tokens[this.pos++];
        if (member?.kind !== 'identifier') fail('Member name required', 'unsupported');
        if (!evaluate) { value = this.literal(0n); continue; }
        if (value.state !== 'available') fail(value.reason, value.state);
        const type = this.inspector.symbols.canonical(value._type);
        if (!type || value.address === undefined) fail('Aggregate operand required', 'unsupported');
        const matches = this.inspector._members(type).filter(item => item.name === member.text);
        if (matches.length !== 1) fail(`Member ${member.text} is unavailable or ambiguous`, 'unsupported');
        const item = matches[0];
        if (this.inspector.symbols.attr(item.die, AT.bitSize) !== undefined) fail('Bit-fields are unsupported', 'unsupported');
        value = this.inspector._read(item.type, { address: value.address + item.offset }, member.text, this.frame, 0, value._requiresInitialized);
      } else break;
    }
    return value;
  }
}
