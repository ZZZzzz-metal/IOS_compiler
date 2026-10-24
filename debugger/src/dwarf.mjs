// DWARF 4 for wasm32. PCs are offsets from the *payload* of the code section.
// References: https://dwarfstd.org/doc/DWARF4.pdf and
// https://yurydelendik.github.io/webassembly-dwarf/ . No native APIs are used.
const decoder = new TextDecoder('utf-8', { fatal: false });
export const TAG = Object.freeze({ array: 1, class: 2, enumeration: 4, parameter: 5,
  lexical: 11, member: 13, pointer: 15, reference: 16, compileUnit: 17, structure: 19,
  subroutine: 21, typedef: 22, union: 23, inheritance: 28, inline: 29, subrange: 33,
  base: 36, const: 38, enumerator: 40, subprogram: 46, templateType: 47,
  variable: 52, volatile: 53, namespace: 57, rvalueReference: 66 });
export const AT = Object.freeze({ location: 2, name: 3, byteSize: 11, bitOffset: 12,
  bitSize: 13, stmtList: 16, lowPC: 17, highPC: 18, language: 19, compDir: 27,
  constValue: 28, containingType: 29, lowerBound: 34, producer: 37, upperBound: 47,
  abstractOrigin: 49, accessibility: 50, artificial: 52, count: 55, memberLocation: 56,
  declaration: 60, encoding: 62, external: 63, frameBase: 64, specification: 71,
  type: 73, ranges: 85, linkageName: 110 });

export class DwarfError extends Error {
  constructor(message) { super(message); this.name = 'DwarfError'; }
}

export class Reader {
  constructor(bytes, offset = 0, end = bytes.length) {
    this.bytes = bytes; this.pos = offset; this.end = end;
    if (offset < 0 || end > bytes.length || offset > end) throw new DwarfError('Invalid section bounds');
  }
  need(n) {
    if (!Number.isSafeInteger(n) || n < 0 || this.pos + n > this.end)
      throw new DwarfError(`Truncated debug data at ${this.pos}`);
  }
  u8() { this.need(1); return this.bytes[this.pos++]; }
  u16() { return this.u8() + this.u8() * 256; }
  u32() { return (this.u16() + this.u16() * 65536) >>> 0; }
  uint(n) {
    if (n === 1) return this.u8(); if (n === 2) return this.u16(); if (n === 4) return this.u32();
    if (n === 8) return BigInt(this.u32()) | BigInt(this.u32()) << 32n;
    throw new DwarfError(`Unsupported integer width ${n}`);
  }
  leb(signed = false, bigint = false) {
    let result = 0n, shift = 0n, byte;
    for (let n = 0; n < 10; n++) {
      byte = this.u8(); result |= BigInt(byte & 127) << shift; shift += 7n;
      if (!(byte & 128)) {
        if (signed && byte & 64) result -= 1n << shift;
        if (bigint) return result;
        const number = Number(result);
        if (!Number.isSafeInteger(number)) throw new DwarfError('Integer exceeds safe debug offset');
        return number;
      }
    }
    throw new DwarfError('Overlong LEB128');
  }
  uleb() { return this.leb(); }
  sleb() { return this.leb(true); }
  take(n) { this.need(n); const value = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return value; }
  string() {
    const start = this.pos;
    while (this.u8() !== 0) { /* bounded by need */ }
    return decoder.decode(this.bytes.subarray(start, this.pos - 1));
  }
}

function bytesOf(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new DwarfError('Executable must be bytes');
}

function sectionMap(input) {
  const r = new Reader(bytesOf(input));
  if (r.u32() !== 0x6d736100 || r.u32() !== 1) throw new DwarfError('Expected WebAssembly version 1');
  const sections = new Map(); let codeOffset, code;
  while (r.pos < r.end) {
    const id = r.u8(), size = r.uleb(), start = r.pos;
    r.need(size); const end = start + size;
    if (id === 0) {
      const custom = new Reader(r.bytes, start, end), name = decoder.decode(custom.take(custom.uleb()));
      if (name.startsWith('.debug_')) {
        if (sections.has(name)) throw new DwarfError(`Duplicate debug section ${name}`);
        sections.set(name, r.bytes.subarray(custom.pos, end));
      }
    } else if (id === 10) { codeOffset = start; code = r.bytes.subarray(start, end); }
    r.pos = end;
  }
  return { sections, codeOffset, code };
}

function formValue(r, form, cu, strings) {
  switch (form) {
    case 1: return r.uint(cu.addressSize);
    case 3: return r.take(r.u16());
    case 4: return r.take(r.u32());
    case 5: return r.u16();
    case 6: return r.u32();
    case 7: return r.uint(8);
    case 8: return r.string();
    case 9: return r.take(r.uleb());
    case 10: return r.take(r.u8());
    case 11: return r.u8();
    case 12: return Boolean(r.u8());
    case 13: {
      const value = r.leb(true, true), number = Number(value);
      return Number.isSafeInteger(number) ? number : value;
    }
    case 14: {
      const offset = r.uint(cu.offsetSize);
      return new Reader(strings, offset).string();
    }
    case 15: {
      const value = r.leb(false, true), number = Number(value);
      return Number.isSafeInteger(number) ? number : value;
    }
    case 16: return r.uint(cu.version === 2 ? cu.addressSize : cu.offsetSize);
    case 17: return r.u8() + cu.offset;
    case 18: return r.u16() + cu.offset;
    case 19: return r.u32() + cu.offset;
    case 20: return Number(r.uint(8)) + cu.offset;
    case 21: return r.uleb() + cu.offset;
    case 23: return r.uint(cu.offsetSize);
    case 24: return r.take(r.uleb());
    case 25: return true;
    case 32: return r.uint(8);
    default: throw new DwarfError(`Unsupported DWARF form 0x${form.toString(16)}`);
  }
}

function unitHeader(r) {
  const offset = r.pos, length = r.u32();
  if (length === 0xffffffff) throw new DwarfError('DWARF64 is unsupported');
  r.need(length);
  return { offset, offsetSize: 4, end: r.pos + length };
}

function abbreviations(bytes, offset) {
  const r = new Reader(bytes, offset), map = new Map();
  while (r.pos < r.end) {
    const code = r.uleb(); if (!code) break;
    const tag = r.uleb(), children = r.u8(), attrs = [];
    if (children > 1 || map.has(code)) throw new DwarfError('Malformed abbreviations');
    while (true) {
      const attr = r.uleb(), form = r.uleb();
      if (!attr && !form) break;
      if (!attr || !form) throw new DwarfError('Malformed abbreviation attribute');
      attrs.push([attr, form]);
    }
    map.set(code, { tag, children, attrs });
  }
  return map;
}

function normalizePath(path) {
  const result = [];
  for (const part of path.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop(); else result.push(part);
  }
  return (path.startsWith('/') ? '/' : '') + result.join('/');
}

export class DwarfSymbols {
  constructor(bytes, snapshot = { files: [] }) {
    const { sections, codeOffset, code } = sectionMap(bytes);
    this.sections = sections; this.codeOffset = codeOffset; this.snapshot = snapshot;
    this.units = []; this.dies = new Map(); this.rows = []; this.functions = [];
    this._abbrevs = new Map(); this._lines = new Map(); this._rangeCache = new Map(); this._prologueCache = new Map(); this.bodies = [];
    if (code) {
      const r = new Reader(code), count = r.uleb();
      if (count > code.length) throw new DwarfError('Invalid code body count');
      for (let i = 0; i < count; i++) {
        const size = r.uleb(), bodyStart = r.pos, end = bodyStart + size;
        r.need(size); const groups = r.uleb();
        if (groups > size) throw new DwarfError('Invalid local group count');
        for (let n = 0; n < groups; n++) { r.uleb(); r.u8(); }
        if (r.pos >= end) throw new DwarfError('Empty function instructions');
        this.bodies.push({ bodyStart, codeStart: r.pos, end, code }); r.pos = end;
      }
    }
    for (const name of ['.debug_abbrev', '.debug_info', '.debug_line'])
      if (!sections.has(name)) throw new DwarfError(`Missing ${name}`);
    this._readInfo();
    for (const cu of this.units) {
      const stmt = this.attr(cu.root, AT.stmtList);
      if (stmt === undefined) continue;
      const table = this._readLine(stmt, cu); this._lines.set(stmt, table);
      cu.lineTable = table; this.rows.push(...table.rows);
    }
    this.rows.sort((a, b) => a.pc - b.pc);
    for (const die of this.dies.values()) {
      if ([TAG.subprogram, TAG.inline].includes(die.tag) && this.ranges(die).length)
        this.functions.push(die);
    }
  }
  _readInfo() {
    const bytes = this.sections.get('.debug_info'), r = new Reader(bytes);
    const strings = this.sections.get('.debug_str') ?? new Uint8Array();
    while (r.pos < r.end) {
      const cu = unitHeader(r); cu.version = r.u16();
      if (cu.version < 2 || cu.version > 4) throw new DwarfError(`Unsupported DWARF version ${cu.version}`);
      cu.abbrevOffset = r.u32(); cu.addressSize = r.u8();
      if (cu.addressSize !== 4) throw new DwarfError('Only wasm32 address size is supported');
      if (!this._abbrevs.has(cu.abbrevOffset)) this._abbrevs.set(cu.abbrevOffset,
        abbreviations(this.sections.get('.debug_abbrev'), cu.abbrevOffset));
      const abbrevs = this._abbrevs.get(cu.abbrevOffset), parents = [];
      const cr = new Reader(bytes, r.pos, cu.end);
      while (cr.pos < cr.end) {
        const offset = cr.pos, code = cr.uleb();
        if (!code) {
          if (!parents.length) throw new DwarfError('Unexpected DIE terminator');
          parents.pop(); continue;
        }
        const ab = abbrevs.get(code);
        if (!ab) throw new DwarfError(`Unknown abbreviation ${code}`);
        const parent = parents.at(-1), die = { offset, tag: ab.tag, attrs: new Map(), forms: new Map(), children: [], parent, cu };
        for (const [attr, rawForm] of ab.attrs) {
          const form = rawForm === 22 ? cr.uleb() : rawForm;
          die.attrs.set(attr, formValue(cr, form, cu, strings)); die.forms.set(attr, form);
        }
        if (parent) parent.children.push(die);
        else if (cu.root) throw new DwarfError('Multiple roots in compilation unit');
        else cu.root = die;
        this.dies.set(offset, die);
        if (ab.children) {
          if (parents.length > 256) throw new DwarfError('DIE nesting limit');
          parents.push(die);
        }
      }
      if (parents.length || !cu.root) throw new DwarfError('Unterminated compilation unit');
      this.units.push(cu); r.pos = cu.end;
    }
  }
  attr(die, attr, seen = new Set()) {
    if (!die || seen.has(die.offset)) return undefined;
    seen.add(die.offset);
    if (die.attrs.has(attr)) return die.attrs.get(attr);
    for (const inherit of [AT.abstractOrigin, AT.specification]) {
      const target = this.dies.get(die.attrs.get(inherit));
      const value = this.attr(target, attr, seen);
      if (value !== undefined) return value;
    }
  }
  type(die) { return this.dies.get(this.attr(die, AT.type)); }
  canonical(type) {
    const seen = new Set();
    while (type && [TAG.typedef, TAG.const, TAG.volatile].includes(type.tag)) {
      if (seen.has(type.offset)) return undefined;
      seen.add(type.offset); type = this.type(type);
    }
    return type;
  }
  typeName(type, depth = 0) {
    if (!type) return 'void'; if (depth > 24) return '<recursive type>';
    const name = this.attr(type, AT.name);
    if (name) return name;
    const target = this.type(type);
    switch (type.tag) {
      case TAG.pointer: return `${this.typeName(target, depth + 1)}*`;
      case TAG.reference: return `${this.typeName(target, depth + 1)}&`;
      case TAG.rvalueReference: return `${this.typeName(target, depth + 1)}&&`;
      case TAG.const: return `const ${this.typeName(target, depth + 1)}`;
      case TAG.volatile: return `volatile ${this.typeName(target, depth + 1)}`;
      case TAG.array: {
        const dimensions = this.arrayDimensions(type);
        return `${this.typeName(target, depth + 1)}${dimensions?.map(count => `[${count}]`).join('') ?? '[?]'}`;
      }
      case TAG.subroutine: return '<function>';
      default: return '<anonymous>';
    }
  }
  arrayCount(type) {
    const counts = this.arrayDimensions(type);
    if (!counts) return undefined;
    const count = counts.reduce((product, n) => product * n, 1);
    return Number.isSafeInteger(count) && count <= 0x7fffffff ? count : undefined;
  }
  arrayDimensions(type) {
    const dimensions = type?.children.filter(child => child.tag === TAG.subrange) ?? [];
    if (!dimensions.length) return undefined;
    const counts = [];
    for (const dim of dimensions) {
      const n = this.attr(dim, AT.count) ?? (this.attr(dim, AT.upperBound) === undefined ? undefined
        : this.attr(dim, AT.upperBound) - (this.attr(dim, AT.lowerBound) ?? 0) + 1);
      if (!Number.isSafeInteger(n) || n < 0 || n > 0x7fffffff) return undefined;
      counts.push(n);
    }
    return counts;
  }
  byteSize(type, seen = new Set()) {
    if (!type || seen.has(type.offset)) return undefined;
    seen.add(type.offset);
    const size = this.attr(type, AT.byteSize);
    if (size !== undefined) return size;
    if ([TAG.pointer, TAG.reference, TAG.rvalueReference].includes(type.tag)) return type.cu.addressSize;
    if ([TAG.const, TAG.volatile, TAG.typedef].includes(type.tag)) return this.byteSize(this.type(type), seen);
    if (type.tag === TAG.array) {
      const count = this.arrayCount(type), item = this.byteSize(this.type(type), seen);
      return count === undefined || item === undefined ? undefined : count * item;
    }
  }
  _readLine(offset, cu) {
    const r = new Reader(this.sections.get('.debug_line'), offset), unit = unitHeader(r);
    r.end = unit.end;
    const version = r.u16();
    if (version < 2 || version > 4) throw new DwarfError(`Unsupported line version ${version}`);
    const headerLength = r.u32(), headerEnd = r.pos + headerLength;
    if (headerEnd > unit.end) throw new DwarfError('Line header exceeds unit');
    const minimum = r.u8(), maxOps = version >= 4 ? r.u8() : 1;
    const defaultStmt = !!r.u8(), rawBase = r.u8(), lineBase = rawBase >= 128 ? rawBase - 256 : rawBase;
    const lineRange = r.u8(), opcodeBase = r.u8();
    if (!minimum || maxOps !== 1 || !lineRange || !opcodeBase) throw new DwarfError('Unsupported line operation parameters');
    const lengths = [0]; for (let i = 1; i < opcodeBase; i++) lengths.push(r.u8());
    const dirs = ['']; while (true) { const dir = r.string(); if (!dir) break; dirs.push(dir); }
    const files = [undefined];
    const readFile = () => { const name = r.string(); if (!name) return false;
      files.push({ name, directory: r.uleb(), modified: r.uleb(), size: r.uleb() }); return true; };
    while (readFile()) { /* file table */ }
    if (r.pos > headerEnd) throw new DwarfError('Line table overflows header');
    r.pos = headerEnd; const rows = []; let state;
    const reset = () => { state = { pc: 0, file: 1, line: 1, column: 0, isStmt: defaultStmt,
      basicBlock: false, prologueEnd: false, epilogueBegin: false, discriminator: 0 }; };
    const emit = endSequence => {
      const file = files[state.file];
      if (!file) throw new DwarfError('Line references missing file');
      const dir = dirs[file.directory];
      if (dir === undefined) throw new DwarfError('Line references missing directory');
      const path = file.name.startsWith('/') ? file.name : `${dir || this.attr(cu.root, AT.compDir) || ''}/${file.name}`;
      const sourcePath = this.sourcePath(path, cu);
      rows.push({ ...state, sourcePath, endSequence, cu });
      state.basicBlock = state.prologueEnd = state.epilogueBegin = false; state.discriminator = 0;
    };
    reset();
    while (r.pos < unit.end) {
      const opcode = r.u8();
      if (!opcode) {
        const size = r.uleb(), end = r.pos + size;
        if (!size || end > unit.end) throw new DwarfError('Malformed extended line opcode');
        const extended = r.u8();
        if (extended === 1) { emit(true); reset(); }
        else if (extended === 2) state.pc = r.uint(cu.addressSize);
        else if (extended === 3) readFile();
        else if (extended === 4) state.discriminator = r.uleb();
        if (r.pos > end) throw new DwarfError('Extended line operand overflow');
        r.pos = end;
      } else if (opcode < opcodeBase) {
        switch (opcode) {
          case 1: emit(false); break;
          case 2: state.pc += r.uleb() * minimum; break;
          case 3: state.line += r.sleb(); break;
          case 4: state.file = r.uleb(); break;
          case 5: state.column = r.uleb(); break;
          case 6: state.isStmt = !state.isStmt; break;
          case 7: state.basicBlock = true; break;
          case 8: state.pc += Math.floor((255 - opcodeBase) / lineRange) * minimum; break;
          case 9: state.pc += r.u16(); break;
          case 10: state.prologueEnd = true; break;
          case 11: state.epilogueBegin = true; break;
          case 12: r.uleb(); break;
          default: for (let n = lengths[opcode] ?? 0; n; n--) r.uleb();
        }
      } else {
        const adjusted = opcode - opcodeBase;
        state.pc += Math.floor(adjusted / lineRange) * minimum;
        state.line += lineBase + adjusted % lineRange; emit(false);
      }
    }
    if (rows.length && !rows.at(-1).endSequence) throw new DwarfError('Unterminated line sequence');
    return { rows, files, dirs };
  }
  sourcePath(rawPath, cu) {
    const path = normalizePath(rawPath), compDir = normalizePath(this.attr(cu.root, AT.compDir) ?? '');
    const relative = compDir && path.startsWith(`${compDir}/`) ? path.slice(compDir.length + 1) : path;
    const candidates = (this.snapshot.files ?? []).filter(file => file.path === path || file.path === relative);
    return candidates.length === 1 ? candidates[0].path : undefined;
  }
  _position(row) {
    if (!row?.sourcePath || row.line < 1) return undefined;
    const file = this.snapshot.files.find(file => file.path === row.sourcePath);
    const text = file?.text.split('\n')[row.line - 1];
    if (text === undefined) return undefined;
    // Clang emits byte columns. The protocol uses 1-based UTF-16 code units.
    let column = 1;
    if (row.column > 0) {
      const encoded = new TextEncoder().encode(text);
      if (row.column > encoded.length + 1 || row.column <= encoded.length && (encoded[row.column - 1] & 0xc0) === 0x80)
        return undefined;
      const prefix = encoded.subarray(0, row.column - 1);
      column = decoder.decode(prefix).length + 1;
    }
    return { sourcePath: row.sourcePath, line: row.line, column };
  }
  row(pc) {
    if (!Number.isSafeInteger(pc) || pc < 0) return undefined;
    let lo = 0, hi = this.rows.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.rows[mid].pc <= pc) lo = mid + 1; else hi = mid; }
    const row = this.rows[lo - 1];
    return row && !row.endSequence ? row : undefined;
  }
  prologueEnd(die) {
    if (!die) return undefined;
    if (!this._prologueCache.has(die.offset)) {
      const row = this.rows.find(row => row.prologueEnd && !row.endSequence && this.contains(die, row.pc));
      this._prologueCache.set(die.offset, row?.pc);
    }
    return this._prologueCache.get(die.offset);
  }
  location(pc) {
    const row = this.row(pc);
    if (!this._position(row)) return undefined;
    const readyPC = this.prologueEnd(this.subprogram(pc));
    if (readyPC !== undefined && pc < readyPC) return undefined;
    return this._position(row);
  }
  bindBreakpoint(position) {
    if (!position || !Number.isSafeInteger(position.line) || position.line < 1)
      return { verified: false, actual: [], pcs: [], reason: 'Invalid source line' };
    const candidates = this.rows.filter(row => row.sourcePath === position.sourcePath &&
      row.line === position.line && !row.endSequence && row.isStmt && this._position(row));
    // Bind every emitted statement on the requested line. Moving an empty line to
    // another statement would silently change the requested stopping point.
    let selected = candidates;
    if (position.column !== undefined && candidates.length) {
      const columns = candidates.map(row => this._position(row).column).filter(column => column >= position.column);
      selected = columns.length ? candidates.filter(row => this._position(row).column === Math.min(...columns)) : [];
    }
    const pcs = [...new Set(selected.map(row => {
      const readyPC = this.prologueEnd(this.subprogram(row.pc));
      return this.executablePC(readyPC !== undefined && row.pc < readyPC ? readyPC : row.pc);
    }))].filter(pc => this.location(pc));
    const actual = [...new Map(pcs.map(pc => { const p = this.location(pc); return [JSON.stringify(p), p]; })).values()].filter(Boolean);
    return { verified: !!pcs.length, actual, pcs, ...(pcs.length ? {} : { reason: 'No executable statement at the requested source position' }) };
  }
  executablePC(pc) {
    // Clang 8's entry rows address the local declaration vector, before code.
    const body = this.bodies.find(body => pc >= body.bodyStart && pc < body.end);
    return body && pc < body.codeStart ? body.codeStart : pc;
  }
  legacyFrameBase(frame) {
    const fn = this.subprogram(frame.pc), producer = this.attr(fn?.cu.root, AT.producer) ?? '';
    if (!/^clang version 8\./.test(producer) || this.attr(fn, AT.frameBase) !== undefined) return undefined;
    const body = this.bodies.find(body => frame.pc >= body.bodyStart && frame.pc < body.end);
    if (!body) return undefined;
    // Explicit compatibility rule for the observed Clang 8 legacy output:
    // global.get G; local.set A; i32.const N; local.set B;
    // local.get A; local.get B; i32.sub; local.set/tee C.
    // The base comes from this frame's actual C local. Never substitute the
    // current global stack pointer: recursive and suspended frames differ.
    try {
      const r = new Reader(body.code, body.codeStart, Math.min(body.end, body.codeStart + 64));
      if (r.u8() !== 0x23) return undefined; const globalIndex = r.uleb();
      if (r.u8() !== 0x21) return undefined; const first = r.uleb();
      if (r.u8() !== 0x41) return undefined; const size = r.sleb();
      if (size <= 0 || size > 0x1000000 || r.u8() !== 0x21) return undefined;
      const second = r.uleb();
      if (r.u8() !== 0x20 || r.uleb() !== first || r.u8() !== 0x20 || r.uleb() !== second || r.u8() !== 0x6b) return undefined;
      const assignment = r.u8(); if (assignment !== 0x21 && assignment !== 0x22) return undefined;
      const localIndex = r.uleb(), readyPC = r.pos;
      if (frame.pc < readyPC) return undefined;
      const value = frame.locals[localIndex];
      if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
      return { address: value >>> 0, size, localIndex, globalIndex, readyPC,
        provenance: 'clang-8-verified-prologue' };
    } catch { return undefined; }
  }
  ranges(die) {
    if (!die) return [];
    if (this._rangeCache.has(die.offset)) return this._rangeCache.get(die.offset);
    const low = this.attr(die, AT.lowPC), high = this.attr(die, AT.highPC), rangeOffset = this.attr(die, AT.ranges);
    const ranges = [];
    if (rangeOffset !== undefined) {
      const bytes = this.sections.get('.debug_ranges');
      if (!bytes) throw new DwarfError('Missing .debug_ranges');
      const r = new Reader(bytes, rangeOffset); let base = this.attr(die.cu.root, AT.lowPC) ?? 0, terminated = false;
      while (r.pos < r.end) {
        const start = r.u32(), end = r.u32();
        if (!start && !end) { terminated = true; break; }
        if (start === 0xffffffff) base = end;
        else if (start !== end) ranges.push([base + start, base + end]);
      }
      if (!terminated) throw new DwarfError('Unterminated range list');
    } else if (low !== undefined && high !== undefined) {
      // high_pc is absolute only when its form is DW_FORM_addr.
      const end = die.forms.get(AT.highPC) === 1 ? high : low + Number(high);
      if (end > low) ranges.push([low, end]);
    }
    this._rangeCache.set(die.offset, ranges); return ranges;
  }
  contains(die, pc) { return this.ranges(die).some(([low, high]) => pc >= low && pc < high); }
  subprogram(pc) {
    const candidates = this.functions.filter(die => this.contains(die, pc));
    candidates.sort((a, b) => {
      const span = die => this.ranges(die).reduce((sum, [low, high]) => sum + high - low, 0);
      return span(a) - span(b);
    });
    return candidates[0];
  }
  functionName(pc) { const die = this.subprogram(pc); return this.attr(die, AT.name); }
  variables(pc) {
    const fn = this.subprogram(pc); if (!fn) return [];
    const result = [];
    const visit = (scope, inScope) => {
      for (const child of scope.children) {
        if ([TAG.parameter, TAG.variable].includes(child.tag)) result.push({ die: child, inScope, function: fn });
        else if ([TAG.lexical, TAG.inline].includes(child.tag))
          visit(child, inScope && (!this.ranges(child).length || this.contains(child, pc)));
      }
    };
    visit(fn, true); return result;
  }
  locationExpression(die, attr, pc) {
    const value = this.attr(die, attr);
    if (value instanceof Uint8Array) return value;
    if (typeof value !== 'number') return undefined;
    const bytes = this.sections.get('.debug_loc');
    if (!bytes) throw new DwarfError('Missing .debug_loc for location list');
    const r = new Reader(bytes, value); let base = this.attr(die.cu.root, AT.lowPC) ?? 0;
    while (r.pos < r.end) {
      const low = r.u32(), high = r.u32();
      if (!low && !high) return undefined;
      if (low === 0xffffffff) { base = high; continue; }
      const expression = r.take(r.u16());
      if (pc >= base + low && pc < base + high) return expression;
    }
    throw new DwarfError('Unterminated location list');
  }
}
