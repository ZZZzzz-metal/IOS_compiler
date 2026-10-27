// Browser-only dependencies: standard JS, TextEncoder, WebAssembly.Memory and crypto.
// Execution follows the WebAssembly core instruction semantics, one instruction per step.
// https://webassembly.github.io/spec/core/exec/instructions.html
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const PAGE = 65536;
const MAX_DECLARATION_SITES = 16384, MAX_WRITE_EPOCH_RANGES = 2048;
const s64 = value => BigInt.asIntN(64, value);
const u64 = value => BigInt.asUintN(64, value);
const zero = type => type === 0x7e ? 0n : type === 0x70 || type === 0x6f ? null : 0;
// JS promotes an f32 signaling NaN to a quiet f64 NaN. Keep NaN bits while
// executing bit-preserving Wasm instructions; ordinary arithmetic unboxes them.
class RawNaN {
  constructor(bits, float32) { this.bits = bits; this.float32 = float32; }
  valueOf() { return NaN; }
  toString() { return 'NaN'; }
}
const unbox = value => value instanceof RawNaN ? NaN : value;
const round32 = value => value instanceof RawNaN ? value : Math.fround(value);
function readFloat(view, address, size) {
  if (size === 4) {
    const bits = view.getUint32(address, true);
    if ((bits & 0x7f800000) === 0x7f800000 && (bits & 0x7fffff)) return new RawNaN(bits, true);
    return view.getFloat32(address, true);
  }
  const bits = view.getBigUint64(address, true);
  if ((bits & 0x7ff0000000000000n) === 0x7ff0000000000000n && (bits & 0xfffffffffffffn)) return new RawNaN(bits, false);
  return view.getFloat64(address, true);
}
function writeFloat(view, address, value, size) {
  if (value instanceof RawNaN && value.float32 === (size === 4)) {
    if (size === 4) view.setUint32(address, value.bits, true);
    else view.setBigUint64(address, value.bits, true);
  } else if (size === 4) view.setFloat32(address, unbox(value), true);
  else view.setFloat64(address, unbox(value), true);
}

export class WasmTrap extends Error {
  constructor(code, message = code) { super(message); this.name = 'WasmTrap'; this.code = code; }
}
const trap = (code, message) => { throw new WasmTrap(code, message); };
const unsupported = message => { throw new Error(`Unsupported WebAssembly feature: ${message}`); };

class Reader {
  constructor(bytes, pos = 0, end = bytes.length) { this.bytes = bytes; this.pos = pos; this.end = end; }
  byte() { if (this.pos >= this.end) throw new Error('Unexpected end of Wasm'); return this.bytes[this.pos++]; }
  uint() {
    let value = 0, scale = 1;
    for (let i = 0; i < 5; i++) { const b = this.byte(); value += (b & 127) * scale; if (!(b & 128)) return value; scale *= 128; }
    throw new Error('Invalid u32 LEB128');
  }
  signed(bits = 32) {
    let value = 0n, shift = 0n, b;
    do { b = this.byte(); value |= BigInt(b & 127) << shift; shift += 7n; if (shift > 70n) throw new Error('Invalid signed LEB128'); } while (b & 128);
    if (b & 64) value |= (-1n) << shift;
    return bits === 64 ? s64(value) : Number(value);
  }
  take(length) { const start = this.pos; this.pos += length; if (this.pos > this.end) throw new Error('Truncated Wasm section'); return this.bytes.subarray(start, this.pos); }
  string() { return decoder.decode(this.take(this.uint())); }
  vector(read) { return Array.from({ length: this.uint() }, () => read(this)); }
  float(size) { const bytes = this.take(size); return readFloat(new DataView(bytes.buffer, bytes.byteOffset, size), 0, size); }
}

function limits(reader) {
  const flags = reader.uint();
  if (flags > 1) unsupported('shared or 64-bit memory/table limits');
  return { min: reader.uint(), max: flags & 1 ? reader.uint() : undefined };
}

function blockType(reader, types) {
  const type = reader.signed(33);
  if (type === -64) return { params: [], results: [] };
  if (type < 0) return { params: [], results: [type & 127] };
  if (!types[type]) throw new Error('Invalid block type index');
  return types[type];
}

function instruction(reader, types, base) {
  const ins = { pc: reader.pos - base, absolutePC: reader.pos, op: reader.byte() };
  const op = ins.op;
  if (op >= 0x02 && op <= 0x04) ins.blockType = blockType(reader, types);
  else if ([0x0c, 0x0d, 0x10, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0xd2].includes(op)) ins.index = reader.uint();
  else if (op === 0x0e) { ins.targets = reader.vector(r => r.uint()); ins.defaultTarget = reader.uint(); }
  else if (op === 0x11) { ins.typeIndex = reader.uint(); ins.tableIndex = reader.uint(); }
  else if (op === 0x1c) ins.types = reader.vector(r => r.byte());
  else if (op >= 0x28 && op <= 0x3e) { ins.align = reader.uint(); ins.offset = reader.uint(); }
  else if (op === 0x3f || op === 0x40) ins.memoryIndex = reader.uint();
  else if (op === 0x41) ins.value = reader.signed(32) | 0;
  else if (op === 0x42) ins.value = reader.signed(64);
  else if (op === 0x43 || op === 0x44) ins.value = reader.float(op === 0x43 ? 4 : 8);
  else if (op === 0xd0) ins.refType = reader.signed(33);
  else if (op === 0xfc) {
    ins.sub = reader.uint();
    if (ins.sub === 8 || ins.sub === 12 || ins.sub === 14) { ins.a = reader.uint(); ins.b = reader.uint(); }
    else if ([9, 11, 13, 15, 16, 17].includes(ins.sub)) ins.a = reader.uint();
    else if (ins.sub === 10) { ins.a = reader.uint(); ins.b = reader.uint(); }
    else if (ins.sub > 7) unsupported(`0xfc opcode ${ins.sub}`);
  } else if (!([0x00, 0x01, 0x05, 0x0b, 0x0f, 0x1a, 0x1b, 0xd1].includes(op) || (op >= 0x45 && op <= 0xc4))) {
    unsupported(`opcode 0x${op.toString(16)} at file offset ${ins.absolutePC}`);
  }
  ins.nextPC = reader.pos - base;
  return ins;
}

function decodeFunction(fn, bytes, types, base) {
  const reader = new Reader(bytes, fn.bodyOffset, fn.bodyEnd);
  fn.localTypes = [];
  for (let n = reader.uint(); n > 0; n--) {
    const count = reader.uint(), type = reader.byte();
    if (fn.localTypes.length + count > 1000000) unsupported('more than one million locals');
    for (let i = 0; i < count; i++) fn.localTypes.push(type);
  }
  fn.codeStart = reader.pos - base;
  fn.absoluteCodeStart = reader.pos;
  fn.codeEnd = fn.bodyEnd - base;
  fn.instructions = new Map();
  const controls = [];
  while (reader.pos < reader.end) {
    const ins = instruction(reader, types, base);
    fn.instructions.set(ins.pc, ins);
    if (ins.op >= 0x02 && ins.op <= 0x04) controls.push(ins);
    else if (ins.op === 0x05) {
      const open = controls.at(-1);
      if (!open || open.op !== 0x04) throw new Error('Unmatched else');
      open.elsePC = ins.pc; open.elseNextPC = ins.nextPC; ins.open = open;
    } else if (ins.op === 0x0b) {
      const open = controls.pop();
      if (open) {
        open.endPC = ins.pc; open.endNextPC = ins.nextPC;
        if (open.elsePC !== undefined) fn.instructions.get(open.elsePC).endPC = ins.pc;
      } else { fn.endPC = ins.pc; }
    }
  }
  if (controls.length || fn.endPC === undefined) throw new Error('Unterminated Wasm function');
}

function nearest(value) {
  if (!Number.isFinite(value) || value === 0 || Math.abs(value) >= 2 ** 52) return value;
  const floor = Math.floor(value), diff = value - floor;
  const result = diff < 0.5 ? floor : diff > 0.5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1;
  return result === 0 && value < 0 ? -0 : result;
}
function truncInteger(value, bits, signed, saturating = false) {
  value = unbox(value);
  if (Number.isNaN(value)) { if (saturating) return bits === 64 ? 0n : 0; trap('invalid-conversion-to-integer'); }
  const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
  const max = signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n;
  let integer;
  if (Number.isFinite(value)) integer = BigInt(Math.trunc(value));
  else integer = value < 0 ? min - 1n : max + 1n;
  if (integer < min || integer > max) {
    if (!saturating) trap('integer-overflow');
    integer = integer < min ? min : max;
  }
  return bits === 64 ? s64(integer) : Number(integer) | 0;
}
function float32FromBigInt(value) {
  // Avoid double rounding through f64 for large i64 -> f32 conversions.
  if (value === 0n) return 0;
  const negative = value < 0n;
  let magnitude = negative ? -value : value;
  const shift = magnitude.toString(2).length - 24;
  if (shift > 0) {
    const distance = BigInt(shift), half = 1n << (distance - 1n);
    let high = magnitude >> distance;
    const low = magnitude - (high << distance);
    if (low > half || (low === half && (high & 1n))) high++;
    magnitude = high << distance;
  }
  return Math.fround(Number(negative ? -magnitude : magnitude));
}
const bitBuffer = new DataView(new ArrayBuffer(8));
function reinterpret(value, from, to) {
  if (from === 'i32') bitBuffer.setInt32(0, value, true);
  else if (from === 'i64') bitBuffer.setBigInt64(0, value, true);
  else if (from === 'f32') writeFloat(bitBuffer, 0, value, 4);
  else writeFloat(bitBuffer, 0, value, 8);
  if (to === 'i32') return bitBuffer.getInt32(0, true);
  if (to === 'i64') return bitBuffer.getBigInt64(0, true);
  return readFloat(bitBuffer, 0, to === 'f32' ? 4 : 8);
}
function copySign(value, sign, float32) {
  if (float32) {
    writeFloat(bitBuffer, 0, sign, 4); const signBit = bitBuffer.getUint32(0, true) & 0x80000000;
    writeFloat(bitBuffer, 0, value, 4); bitBuffer.setUint32(0, (bitBuffer.getUint32(0, true) & 0x7fffffff) | signBit, true);
    return readFloat(bitBuffer, 0, 4);
  }
  writeFloat(bitBuffer, 0, sign, 8); const signBit = bitBuffer.getBigUint64(0, true) & (1n << 63n);
  writeFloat(bitBuffer, 0, value, 8); bitBuffer.setBigUint64(0, (bitBuffer.getBigUint64(0, true) & ((1n << 63n) - 1n)) | signBit, true);
  return readFloat(bitBuffer, 0, 8);
}
function popcount32(value) {
  value >>>= 0; value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function ctz32(value) { return value === 0 ? 32 : 31 - Math.clz32((value & -value) >>> 0); }
function ctz64(value) { value = u64(value); return value === 0n ? 64n : BigInt(ctz32(Number(value & 0xffffffffn))) + ((value & 0xffffffffn) === 0n ? BigInt(ctz32(Number(value >> 32n))) : 0n); }
function div32(a, b, signed, remainder = false) {
  if (!signed) { a >>>= 0; b >>>= 0; }
  if (b === 0) trap('integer-divide-by-zero');
  if (!remainder && signed && a === -2147483648 && b === -1) trap('integer-overflow');
  return (remainder ? a % b : Math.trunc(a / b)) | 0;
}
function div64(a, b, signed, remainder = false) {
  if (!signed) { a = u64(a); b = u64(b); }
  if (b === 0n) trap('integer-divide-by-zero');
  if (!remainder && signed && a === -(1n << 63n) && b === -1n) trap('integer-overflow');
  return s64(remainder ? a % b : a / b);
}

const numeric = new Map();
const unary = (op, fn, raw = false) => numeric.set(op, stack => { const value = stack.pop(); stack.push(fn(raw ? value : unbox(value))); });
const binary = (op, fn, raw = false) => numeric.set(op, stack => { const b = stack.pop(), a = stack.pop(); stack.push(fn(raw ? a : unbox(a), raw ? b : unbox(b))); });
unary(0x45, a => +(a === 0)); unary(0x50, a => +(a === 0n));
for (const [start, convert] of [[0x46, a => a], [0x51, a => a]]) {
  const wide = start === 0x51, unsigned = wide ? u64 : a => a >>> 0;
  const comparisons = [(a,b)=>a===b,(a,b)=>a!==b,(a,b)=>a<b,(a,b)=>unsigned(a)<unsigned(b),(a,b)=>a>b,(a,b)=>unsigned(a)>unsigned(b),(a,b)=>a<=b,(a,b)=>unsigned(a)<=unsigned(b),(a,b)=>a>=b,(a,b)=>unsigned(a)>=unsigned(b)];
  comparisons.forEach((fn, i) => binary(start + i, (a, b) => +fn(convert(a), convert(b))));
}
for (const start of [0x5b, 0x61]) [(a,b)=>a===b,(a,b)=>a!==b,(a,b)=>a<b,(a,b)=>a>b,(a,b)=>a<=b,(a,b)=>a>=b].forEach((fn, i) => binary(start + i, (a,b)=>+fn(a,b)));
unary(0x67, Math.clz32); unary(0x68, ctz32); unary(0x69, popcount32);
const int32Binary = [
  (a,b)=>(a+b)|0,(a,b)=>(a-b)|0,Math.imul,(a,b)=>div32(a,b,true),(a,b)=>div32(a,b,false),(a,b)=>div32(a,b,true,true),(a,b)=>div32(a,b,false,true),
  (a,b)=>a&b,(a,b)=>a|b,(a,b)=>a^b,(a,b)=>a<<b,(a,b)=>a>>b,(a,b)=>(a>>>b)|0,(a,b)=>(a<<(b&31))|(a>>>(32-(b&31))),(a,b)=>(a>>>(b&31))|(a<<(32-(b&31))),
];
int32Binary.forEach((fn,i)=>binary(0x6a+i,fn));
unary(0x79, a => BigInt(64 - (u64(a) === 0n ? 0 : u64(a).toString(2).length)));
unary(0x7a, ctz64); unary(0x7b, a => BigInt(popcount32(Number(u64(a) & 0xffffffffn)) + popcount32(Number(u64(a) >> 32n))));
const int64Binary = [
  (a,b)=>s64(a+b),(a,b)=>s64(a-b),(a,b)=>s64(a*b),(a,b)=>div64(a,b,true),(a,b)=>div64(a,b,false),(a,b)=>div64(a,b,true,true),(a,b)=>div64(a,b,false,true),
  (a,b)=>a&b,(a,b)=>a|b,(a,b)=>a^b,(a,b)=>s64(a<<(b&63n)),(a,b)=>a>>(b&63n),(a,b)=>s64(u64(a)>>(b&63n)),
  (a,b)=>s64((u64(a)<<(b&63n))|(u64(a)>>(64n-(b&63n)))),(a,b)=>s64((u64(a)>>(b&63n))|(u64(a)<<(64n-(b&63n)))),
];
int64Binary.forEach((fn,i)=>binary(0x7c+i,fn));
for (const [start, round] of [[0x8b, round32], [0x99, a => a]]) {
  [Math.abs,a=>-a,Math.ceil,Math.floor,Math.trunc,nearest,Math.sqrt].forEach((fn,i)=>unary(start+i,a=>{
    if (a instanceof RawNaN && i <= 1) {
      const bits = a.float32 ? (i === 0 ? a.bits & 0x7fffffff : (a.bits ^ 0x80000000) >>> 0) : (i === 0 ? a.bits & ((1n << 63n) - 1n) : a.bits ^ (1n << 63n));
      return new RawNaN(bits, a.float32);
    }
    return round(fn(a));
  }, i <= 1));
  [(a,b)=>a+b,(a,b)=>a-b,(a,b)=>a*b,(a,b)=>a/b,Math.min,Math.max,(a,b)=>copySign(a,b,start===0x8b)].forEach((fn,i)=>binary(start+7+i,(a,b)=>round(fn(a,b)),i===6));
}
unary(0xa7, a => Number(BigInt.asIntN(32, a)));
for (const [op,bits,signed] of [[0xa8,32,true],[0xa9,32,false],[0xaa,32,true],[0xab,32,false],[0xae,64,true],[0xaf,64,false],[0xb0,64,true],[0xb1,64,false]]) unary(op,a=>truncInteger(a,bits,signed));
unary(0xac, a => BigInt(a)); unary(0xad, a => BigInt(a>>>0));
unary(0xb2, a => Math.fround(a)); unary(0xb3, a => Math.fround(a>>>0));
unary(0xb4, float32FromBigInt); unary(0xb5, a=>float32FromBigInt(u64(a))); unary(0xb6, Math.fround);
unary(0xb7, a=>a); unary(0xb8,a=>a>>>0); unary(0xb9,Number); unary(0xba,a=>Number(u64(a))); unary(0xbb,a=>a);
unary(0xbc,a=>reinterpret(a,'f32','i32'),true); unary(0xbd,a=>reinterpret(a,'f64','i64'),true);
unary(0xbe,a=>reinterpret(a,'i32','f32'),true); unary(0xbf,a=>reinterpret(a,'i64','f64'),true);
unary(0xc0,a=>(a<<24)>>24); unary(0xc1,a=>(a<<16)>>16);
unary(0xc2,a=>BigInt.asIntN(8,a)); unary(0xc3,a=>BigInt.asIntN(16,a)); unary(0xc4,a=>BigInt.asIntN(32,a));

/**
 * A pausable Wasm32 interpreter. pc/codeStart are relative to the code-section
 * payload (including its function count); absolutePC is a file byte offset.
 * No instruction is executed by start(), including a module start function.
 */
export class WasmRuntime {
  constructor(bytes, { stdin = '', onOutput = () => {}, memoryBytes = 256 * 1024 * 1024, args = ['program'], maxFrames = 4096 } = {}) {
    this.bytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes).slice();
    if (typeof WebAssembly !== 'undefined' && !WebAssembly.validate(this.bytes)) throw new Error('Invalid WebAssembly module (native validation failed)');
    this.memoryLimit = Math.floor(memoryBytes / PAGE);
    if (!Number.isSafeInteger(this.memoryLimit) || this.memoryLimit < 0 || this.memoryLimit > 65536) throw new Error('Invalid memoryBytes limit');
    this.maxFrames = maxFrames;
    this.onOutput = onOutput;
    this.stdin = typeof stdin === 'string' ? encoder.encode(stdin) : new Uint8Array(stdin).slice();
    this.stdinOffset = 0;
    this.args = args.map(arg => encoder.encode(String(arg) + '\0'));
    this.frames = []; this.functions = []; this.globals = []; this.globalTypes = [];
    this.types = []; this.exports = new Map(); this.tables = []; this.sections = []; this.dataSegments = []; this.elementSegments = [];
    this.done = false; this.exitCode = null; this.trap = null; this.started = false; this.instructionsExecuted = 0; this._frameId = 0;
    this._declarationSites = new Map(); this._declarationSiteCount = 0; this._writeEpochs = new WeakMap();
    this._closedFDs = new Set();
    this._parse();
  }

  get memory() {
    if (!this._memory) return this._emptyMemory ??= new Uint8Array();
    if (this._memoryBytes?.buffer !== this._memory.buffer) {
      this._memoryBytes = new Uint8Array(this._memory.buffer);
      this._memoryView = new DataView(this._memory.buffer);
    }
    return this._memoryBytes;
  }
  get locationPC() { return this.frames.at(-1)?.pc ?? null; }
  get absolutePC() { const pc = this.locationPC; return pc === null ? null : this.codeSectionOffset + pc; }

  /** Register observed declaration instruction PCs before execution starts.
   * This metadata never changes guest memory, operands, globals or control flow.
   * Registration is atomic: unsupported PCs/limits leave existing sites intact.
   */
  registerDeclarationSites(sites) {
    if (this.started) throw new Error('Declaration sites must be registered before runtime.start()');
    if (!Array.isArray(sites) || sites.length > MAX_DECLARATION_SITES) throw new Error('Declaration site registration limit exceeded');
    const defined = this.functions.filter(fn => !fn.imported), additions = new Map();
    for (const site of sites) {
      const pc = site?.pc;
      if (!Number.isSafeInteger(pc) || pc < 0) throw new Error('Invalid declaration instruction PC');
      let low = 0, high = defined.length;
      while (low < high) { const middle = (low + high) >>> 1; if (defined[middle].codeStart <= pc) low = middle + 1; else high = middle; }
      const fn = defined[low - 1];
      if (!fn?.instructions.has(pc)) throw new Error(`Declaration PC ${pc} is not an executable instruction`);
      if (!this._declarationSites.get(fn.index)?.has(pc)) additions.set(pc, fn.index);
    }
    if (this._declarationSiteCount + additions.size > MAX_DECLARATION_SITES) throw new Error('Declaration site registration limit exceeded');
    for (const [pc, index] of additions) {
      if (!this._declarationSites.has(index)) this._declarationSites.set(index, new Set());
      this._declarationSites.get(index).add(pc); this._declarationSiteCount++;
    }
    return { registered: [...new Set(sites.map(site => site.pc))] };
  }

  // Zero means this registered declaration has not executed in this activation.
  // Null means its provenance is untracked, expired or cannot be represented.
  declarationEpoch(frame, pc) {
    const history = this._writeEpochs.get(frame);
    if (!history || !this._declarationSites.get(frame.funcIndex)?.has(pc) || !Number.isSafeInteger(this.instructionsExecuted)) return null;
    return history.visits.get(pc) ?? 0;
  }

  wasMemoryWrittenSince(frame, address, size, epoch) {
    const history = this._writeEpochs.get(frame);
    if (!history || !Number.isSafeInteger(epoch) || epoch <= 0 || !Number.isSafeInteger(address) || !Number.isSafeInteger(size) ||
      address < 0 || size < 0 || address + size > this.memory.length || !Number.isSafeInteger(this.instructionsExecuted)) return null;
    if (!size) return true;
    let cursor = address; const end = address + size;
    for (const [start, stop, tick] of history.ranges) {
      if (stop <= cursor) continue;
      if (start > cursor || tick < epoch) return history.complete ? false : null;
      cursor = Math.min(stop, end);
      if (cursor === end) return true;
    }
    return history.complete ? false : null;
  }

  _constant(reader) {
    const op = reader.byte(); let value;
    if (op === 0x41) value = reader.signed(32) | 0;
    else if (op === 0x42) value = reader.signed(64);
    else if (op === 0x43 || op === 0x44) value = reader.float(op === 0x43 ? 4 : 8);
    else if (op === 0x23) value = this.globals[reader.uint()];
    else if (op === 0xd0) { reader.signed(33); value = null; }
    else if (op === 0xd2) value = reader.uint();
    else unsupported(`constant expression opcode 0x${op.toString(16)}`);
    if (reader.byte() !== 0x0b) unsupported('extended constant expressions');
    return value;
  }

  _parse() {
    const reader = new Reader(this.bytes); reader.take(8);
    const names = new Map(), localNames = new Map(), exportNames = new Map();
    let memoryLimits;
    while (reader.pos < reader.end) {
      const id = reader.byte(), size = reader.uint(), offset = reader.pos;
      const section = new Reader(this.bytes, offset, offset + size);
      this.sections.push({ id, payloadOffset: offset, byteLength: size });
      reader.take(size);
      if (id === 0) {
        const name = section.string(); this.sections.at(-1).name = name;
        if (name === 'name') while (section.pos < section.end) {
          const subId = section.byte(), subLength = section.uint(), end = section.pos + subLength;
          if (subId === 1) for (let n = section.uint(); n; n--) { const index = section.uint(); names.set(index, section.string()); }
          else if (subId === 2) for (let n = section.uint(); n; n--) {
            const index = section.uint(), locals = new Map();
            for (let m = section.uint(); m; m--) { const local = section.uint(); locals.set(local, section.string()); }
            localNames.set(index, locals);
          }
          section.pos = end;
        }
      } else if (id === 1) {
        this.types = section.vector(r => {
          if (r.byte() !== 0x60) unsupported('GC/recursive types');
          const type = { params: r.vector(q => q.byte()), results: r.vector(q => q.byte()) };
          if ([...type.params, ...type.results].some(t=>![0x7f,0x7e,0x7d,0x7c,0x70,0x6f].includes(t))) unsupported('non-numeric/SIMD value types');
          return type;
        });
      } else if (id === 2) {
        for (let n = section.uint(); n; n--) {
          const module = section.string(), name = section.string(), kind = section.byte();
          if (kind !== 0) unsupported(`import ${module}.${name} kind ${kind}`);
          const typeIndex = section.uint(), index = this.functions.length;
          if (!['wasi_unstable', 'wasi_snapshot_preview1'].includes(module)) unsupported(`import module ${module}`);
          if (!WASI_IMPORTS.has(name)) unsupported(`WASI import ${name}`);
          this.functions.push({ index, typeIndex, module, importName: name, imported: true, name, codeStart: null });
        }
      } else if (id === 3) {
        for (let n = section.uint(); n; n--) this.functions.push({ index: this.functions.length, typeIndex: section.uint(), imported: false });
      } else if (id === 4) {
        for (let n = section.uint(); n; n--) {
          const type = section.byte(), bound = limits(section);
          if (type !== 0x70) unsupported('non-funcref table');
          if (bound.min > 1000000) unsupported('table exceeds one million entries');
          this.tables.push({ ...bound, values: Array(bound.min).fill(null) });
        }
      } else if (id === 5) {
        if (section.uint() !== 1) unsupported('multiple linear memories');
        memoryLimits = limits(section);
      } else if (id === 6) {
        for (let n = section.uint(); n; n--) {
          const type = section.byte(), mutable = section.byte();
          this.globalTypes.push({ type, mutable: !!mutable }); this.globals.push(this._constant(section));
        }
      } else if (id === 7) {
        for (let n = section.uint(); n; n--) {
          const name = section.string(), kind = section.byte(), index = section.uint();
          this.exports.set(name, { kind, index }); if (kind === 0 && !exportNames.has(index)) exportNames.set(index, name);
        }
      } else if (id === 8) this.startFunction = section.uint();
      else if (id === 9) {
        for (let n = section.uint(); n; n--) {
          const flags = section.uint();
          if (flags > 7) unsupported(`element segment flags ${flags}`);
          const active = !(flags & 1), tableIndex = flags === 2 || flags === 6 ? section.uint() : 0;
          const offsetValue = active ? this._constant(section) >>> 0 : null;
          if ((flags & 3) !== 0) { const elemType = section.byte(); if (elemType !== (flags & 4 ? 0x70 : 0)) unsupported('element type'); }
          const values = section.vector(r => flags & 4 ? this._constant(r) : r.uint());
          this.elementSegments.push({ values, active, tableIndex, offset: offsetValue, dropped: active || flags === 3 || flags === 7 });
        }
      } else if (id === 10) {
        this.codeSectionOffset = offset;
        const defined = this.functions.filter(fn => !fn.imported), count = section.uint();
        if (count !== defined.length) throw new Error('Function/code count mismatch');
        for (let i = 0; i < count; i++) {
          const bodySize = section.uint(), fn = defined[i];
          fn.bodyOffset = section.pos; fn.bodyEnd = section.pos + bodySize;
          decodeFunction(fn, this.bytes, this.types, offset); section.take(bodySize);
        }
      } else if (id === 11) {
        for (let n = section.uint(); n; n--) {
          const flags = section.uint(); if (flags > 2) unsupported(`data segment flags ${flags}`);
          const active = flags !== 1, memoryIndex = flags === 2 ? section.uint() : 0;
          if (memoryIndex !== 0) unsupported('nonzero memory index');
          const dataOffset = active ? this._constant(section) >>> 0 : null;
          this.dataSegments.push({ bytes: section.take(section.uint()), active, offset: dataOffset, dropped: active });
        }
      } else if (id === 12) section.uint();
      else unsupported(`section id ${id}`);
    }
    if (memoryLimits) {
      if (memoryLimits.min > this.memoryLimit) throw new Error('Initial linear memory exceeds memoryBytes limit');
      const maximum = Math.min(memoryLimits.max ?? 65536, this.memoryLimit);
      this._memory = new WebAssembly.Memory({ initial: memoryLimits.min, maximum });
      this.memoryMaximum = maximum;
      for (const data of this.dataSegments) if (data.active) { this._bounds(data.offset, data.bytes.length); this.memory.set(data.bytes, data.offset); }
    } else if (this.dataSegments.some(data=>data.active)) throw new Error('Data without linear memory');
    for (const segment of this.elementSegments) if (segment.active) {
      const table = this.tables[segment.tableIndex];
      if (!table || segment.offset + segment.values.length > table.values.length) throw new Error('Element segment out of bounds');
      segment.values.forEach((value,i)=>{ table.values[segment.offset+i] = value; });
    }
    for (const fn of this.functions) {
      fn.name = names.get(fn.index) ?? exportNames.get(fn.index) ?? fn.name ?? `wasm-function[${fn.index}]`;
      fn.localNames = localNames.get(fn.index) ?? new Map(); fn.type = this.types[fn.typeIndex];
    }
  }

  start(entry = '_start', args = []) {
    if (this.started) throw new Error('A runtime instance cannot be restarted; create a fresh instance');
    const exported = typeof entry === 'number' ? { kind: 0, index: entry } : this.exports.get(entry);
    if (!exported || exported.kind !== 0 || !this.functions[exported.index]) throw new Error(`Missing Wasm entry function: ${entry}`);
    const fn = this.functions[exported.index];
    if (args.length !== fn.type.params.length) throw new Error(`Entry ${entry} requires ${fn.type.params.length} arguments`);
    this.started = true; this._pendingEntry = { index: exported.index, args };
    if (this.startFunction !== undefined) this._invoke(this.startFunction, []);
    else { this._pendingEntry = null; this._invoke(exported.index, args); }
    return this;
  }

  _invoke(index, args) {
    const fn = this.functions[index]; if (!fn) trap('undefined-function');
    if (fn.imported) {
      const value = this._wasi(fn.importName, args, fn.module);
      if (this.frames.length && fn.type.results.length) this.frames.at(-1).stack.push(value | 0);
      return;
    }
    if (this.frames.length >= this.maxFrames) trap('call-stack-exhausted');
    const parameters = args.map((value, index) => {
      const type = fn.type.params[index];
      if (type === 0x7f) return Number(value) | 0;
      if (type === 0x7e) return s64(BigInt(value));
      if (type === 0x7d) return value instanceof RawNaN && value.float32 ? value : Math.fround(unbox(value));
      if (type === 0x7c) return value instanceof RawNaN && !value.float32 ? value : Number(unbox(value));
      return value;
    });
    const frame = {
      id: `wasm-frame-${++this._frameId}`, funcIndex: index, name: fn.name,
      locals: [...parameters, ...fn.localTypes.map(zero)], stack: [], pc: fn.codeStart,
      absolutePC: fn.absoluteCodeStart, lastPC: null, callPC: null,
      memoryWrites: [], memoryWritesComplete: true,
      controls: [{ kind: 'function', height: 0, resultCount: fn.type.results.length, paramCount: 0, endPC: fn.endPC }],
    };
    if (this._declarationSites.get(index)?.size) this._writeEpochs.set(frame, { visits: new Map(), ranges: [], complete: true });
    this.frames.push(frame);
  }

  _finishFrame() {
    const frame = this.frames.pop(), fn = this.functions[frame.funcIndex];
    this._writeEpochs.delete(frame);
    const results = fn.type.results.length ? frame.stack.slice(-fn.type.results.length) : [];
    if (this.frames.length) this.frames.at(-1).stack.push(...results);
    else if (this._pendingEntry) {
      const next = this._pendingEntry; this._pendingEntry = null; this._invoke(next.index, next.args);
    } else {
      this.returnValues = results.map(unbox); this.returnValue = this.returnValues[0]; this.done = true; this.exitCode = 0;
    }
  }

  _branch(frame, depth) {
    const targetIndex = frame.controls.length - 1 - depth, target = frame.controls[targetIndex];
    if (!target) trap('invalid-label');
    if (target.kind === 'function') { this._finishFrame(); return; }
    const loop = target.kind === 'loop', count = loop ? target.paramCount : target.resultCount;
    const values = count ? frame.stack.slice(-count) : [];
    frame.stack.length = target.height; frame.stack.push(...values);
    frame.controls.length = targetIndex + (loop ? 1 : 0);
    frame.pc = loop ? target.startPC : target.endNextPC;
  }

  _bounds(address, size) {
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(size) || address < 0 || size < 0 || address + size > this.memory.length) trap('out-of-bounds-memory-access');
  }
  // Debug metadata only: merged actual writes since each activation began.
  // Ancestors see callee writes, including C++ object constructor writes. The
  // bounded history reports unknown after overflow, never false initialization.
  _recordWrite(address, size) {
    if (!size) return;
    for (const frame of this.frames) {
      const history = this._writeEpochs.get(frame);
      if (history) this._recordEpochWrite(history, address, size);
      const ranges = frame.memoryWrites;
      let low = 0, high = ranges.length;
      while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle][1] < address) low = middle + 1; else high = middle; }
      const first = low; let end = address + size, start = address;
      while (low < ranges.length && ranges[low][0] <= end) {
        start = Math.min(start, ranges[low][0]); end = Math.max(end, ranges[low][1]); low++;
      }
      if (ranges.length - (low - first) >= 2048) { frame.memoryWritesComplete = false; continue; }
      ranges.splice(first, low - first, [start, end]);
    }
  }
  _recordEpochWrite(history, address, size) {
    const ranges = history.ranges, end = address + size, tick = this.instructionsExecuted;
    if (!Number.isSafeInteger(tick)) { history.ranges = []; history.complete = false; return; }
    let low = 0, high = ranges.length;
    while (low < high) { const middle = (low + high) >>> 1; if (ranges[middle][1] <= address) low = middle + 1; else high = middle; }
    const first = low, replacement = [];
    if (ranges[first]?.[0] < address) replacement.push([ranges[first][0], address, ranges[first][2]]);
    while (low < ranges.length && ranges[low][0] < end) low++;
    replacement.push([address, end, tick]);
    if (low > first && ranges[low - 1][1] > end) replacement.push([end, ranges[low - 1][1], ranges[low - 1][2]]);
    ranges.splice(first, low - first, ...replacement);
    // Several iovecs/constructor fields can be written by the same instruction.
    for (let i = Math.max(0, first - 1); i + 1 < ranges.length && i <= first + replacement.length;) {
      const a = ranges[i], b = ranges[i + 1];
      if (a[1] === b[0] && a[2] === b[2]) { a[1] = b[1]; ranges.splice(i + 1, 1); }
      else i++;
    }
    if (ranges.length > MAX_WRITE_EPOCH_RANGES) {
      // Retain recent known intervals; missing intervals become explicitly
      // unknown. Drop half at once to keep pruning cost amortized and bounded.
      const recent = new Set([...ranges].sort((a,b) => b[2] - a[2]).slice(0, MAX_WRITE_EPOCH_RANGES / 2));
      history.ranges = ranges.filter(range => recent.has(range)); history.complete = false;
    }
  }
  wasMemoryWritten(frame, address, size) {
    if (!frame?.memoryWrites || !Number.isSafeInteger(address) || !Number.isSafeInteger(size) || size < 0) return null;
    if (size === 0) return true;
    const covered = frame.memoryWrites.some(([start,end]) => start <= address && end >= address + size);
    return covered ? true : frame.memoryWritesComplete ? false : null;
  }
  _table(index) { const table = this.tables[index]; if (!table) trap('undefined-table'); return table; }
  _tableBounds(table, address, length) { if (address < 0 || address + length > table.values.length) trap('out-of-bounds-table-access'); }

  step() {
    if (!this.started) throw new Error('Call start() before step()');
    if (this.done) return { done: true, trap: this.trap };
    const frame = this.frames.at(-1), fn = this.functions[frame.funcIndex], ins = fn.instructions.get(frame.pc);
    const info = { funcIndex: frame.funcIndex, pc: frame.pc, absolutePC: this.codeSectionOffset + frame.pc, opcode: ins?.op, done: false };
    try {
      if (!ins) trap('invalid-instruction-pointer');
      const history = this._writeEpochs.get(frame);
      if (history && this._declarationSites.get(frame.funcIndex).has(frame.pc)) history.visits.set(frame.pc, this.instructionsExecuted + 1);
      frame.lastPC = frame.pc; frame.pc = ins.nextPC;
      this.instructionsExecuted++;
      this._execute(frame, ins);
      for (const active of this.frames) active.absolutePC = this.codeSectionOffset + active.pc;
    } catch (error) {
      const fault = error instanceof Error ? error : new Error(String(error));
      fault.pc = info.pc; fault.absolutePC = info.absolutePC; fault.funcIndex = info.funcIndex;
      this.trap = fault; this.done = true; this.exitCode = null;
      // Keep faulting frames and locals available for post-mortem inspection.
      frame.pc = info.pc; frame.absolutePC = info.absolutePC;
      info.trap = fault;
    }
    info.done = this.done;
    return info;
  }

  _execute(frame, ins) {
    const op = ins.op, stack = frame.stack;
    const arithmetic = numeric.get(op); if (arithmetic) { arithmetic(stack); return; }
    if (op >= 0x28 && op <= 0x3e) { this._memoryInstruction(stack, ins); return; }
    switch (op) {
      case 0x00: trap('unreachable'); break;
      case 0x01: break;
      case 0x02: case 0x03: case 0x04: {
        const condition = op === 0x04 ? stack.pop() : 1;
        const control = { kind: op === 0x03 ? 'loop' : 'block', height: stack.length - ins.blockType.params.length,
          resultCount: ins.blockType.results.length, paramCount: ins.blockType.params.length,
          startPC: ins.nextPC, endPC: ins.endPC, endNextPC: ins.endNextPC };
        frame.controls.push(control);
        if (!condition) frame.pc = ins.elseNextPC ?? ins.endPC;
        break;
      }
      case 0x05: frame.pc = ins.endPC; break;
      case 0x0b: {
        const control = frame.controls.at(-1);
        if (control.kind === 'function') this._finishFrame();
        else {
          const values = control.resultCount ? stack.slice(-control.resultCount) : [];
          stack.length = control.height; stack.push(...values); frame.controls.pop();
        }
        break;
      }
      case 0x0c: this._branch(frame, ins.index); break;
      case 0x0d: if (stack.pop()) this._branch(frame, ins.index); break;
      case 0x0e: { const index = stack.pop() >>> 0; this._branch(frame, ins.targets[index] ?? ins.defaultTarget); break; }
      case 0x0f: this._finishFrame(); break;
      case 0x10: case 0x11: {
        let index = ins.index;
        if (op === 0x11) {
          const table = this._table(ins.tableIndex), slot = stack.pop() >>> 0;
          this._tableBounds(table, slot, 1); index = table.values[slot];
          if (index === null) trap('uninitialized-element');
          const expected = this.types[ins.typeIndex], actual = this.functions[index]?.type;
          if (!actual || expected.params.join() !== actual.params.join() || expected.results.join() !== actual.results.join()) trap('indirect-call-type-mismatch');
        }
        const callee = this.functions[index]; if (!callee) trap('undefined-function');
        const args = callee.type.params.length ? stack.splice(-callee.type.params.length) : [];
        frame.callPC = ins.pc; this._invoke(index, args); break;
      }
      case 0x1a: stack.pop(); break;
      case 0x1b: case 0x1c: { const condition = stack.pop(), b = stack.pop(), a = stack.pop(); stack.push(condition ? a : b); break; }
      case 0x20: stack.push(frame.locals[ins.index]); break;
      case 0x21: frame.locals[ins.index] = stack.pop(); break;
      case 0x22: frame.locals[ins.index] = stack.at(-1); break;
      case 0x23: stack.push(this.globals[ins.index]); break;
      case 0x24: this.globals[ins.index] = stack.pop(); break;
      case 0x25: { const table = this._table(ins.index), index = stack.pop() >>> 0; this._tableBounds(table,index,1); stack.push(table.values[index]); break; }
      case 0x26: { const table = this._table(ins.index), value = stack.pop(), index = stack.pop() >>> 0; this._tableBounds(table,index,1); table.values[index] = value; break; }
      case 0x3f: if (ins.memoryIndex !== 0) unsupported('nonzero memory index'); stack.push(this.memory.length / PAGE); break;
      case 0x40: {
        if (ins.memoryIndex !== 0) unsupported('nonzero memory index');
        const pages = stack.pop() >>> 0;
        try { if (!this._memory) trap('undefined-memory'); stack.push(this._memory.grow(pages)); this.memory; }
        catch (error) { if (error instanceof RangeError) stack.push(-1); else throw error; }
        break;
      }
      case 0x41: case 0x42: case 0x43: case 0x44: stack.push(ins.value); break;
      case 0xd0: stack.push(null); break;
      case 0xd1: stack.push(+(stack.pop() === null)); break;
      case 0xd2: stack.push(ins.index); break;
      case 0xfc: this._extended(stack, ins); break;
      default: unsupported(`opcode 0x${op.toString(16)}`);
    }
  }

  _memoryInstruction(stack, ins) {
    const store = ins.op >= 0x36, value = store ? stack.pop() : null;
    const address = (stack.pop() >>> 0) + ins.offset;
    const sizes = [4,8,4,8,1,1,2,2,1,1,2,2,4,4,4,8,4,8,1,2,1,2,4];
    this._bounds(address, sizes[ins.op - 0x28]);
    const view = this._memoryView;
    switch (ins.op) {
      case 0x28: stack.push(view.getInt32(address,true)); break;
      case 0x29: stack.push(view.getBigInt64(address,true)); break;
      case 0x2a: stack.push(readFloat(view,address,4)); break;
      case 0x2b: stack.push(readFloat(view,address,8)); break;
      case 0x2c: stack.push(view.getInt8(address)); break;
      case 0x2d: stack.push(view.getUint8(address)); break;
      case 0x2e: stack.push(view.getInt16(address,true)); break;
      case 0x2f: stack.push(view.getUint16(address,true)); break;
      case 0x30: stack.push(BigInt(view.getInt8(address))); break;
      case 0x31: stack.push(BigInt(view.getUint8(address))); break;
      case 0x32: stack.push(BigInt(view.getInt16(address,true))); break;
      case 0x33: stack.push(BigInt(view.getUint16(address,true))); break;
      case 0x34: stack.push(BigInt(view.getInt32(address,true))); break;
      case 0x35: stack.push(BigInt(view.getUint32(address,true))); break;
      case 0x36: view.setInt32(address,value,true); break;
      case 0x37: view.setBigInt64(address,value,true); break;
      case 0x38: writeFloat(view,address,value,4); break;
      case 0x39: writeFloat(view,address,value,8); break;
      case 0x3a: view.setInt8(address,value); break;
      case 0x3b: view.setInt16(address,value,true); break;
      case 0x3c: view.setInt8(address,Number(value&255n)); break;
      case 0x3d: view.setInt16(address,Number(value&65535n),true); break;
      case 0x3e: view.setInt32(address,Number(value&0xffffffffn),true); break;
    }
    if (store) this._recordWrite(address, sizes[ins.op - 0x28]);
  }

  _extended(stack, ins) {
    if (ins.sub <= 7) {
      stack.push(truncInteger(stack.pop(), ins.sub < 4 ? 32 : 64, !(ins.sub & 1), true)); return;
    }
    const pop32 = () => stack.pop() >>> 0;
    if (ins.sub === 8) {
      if (ins.b !== 0) unsupported('nonzero memory index');
      const length = pop32(), source = pop32(), destination = pop32(), segment = this.dataSegments[ins.a];
      if (!segment || source + length > (segment.dropped ? 0 : segment.bytes.length)) trap('out-of-bounds-memory-access');
      this._bounds(destination,length); this.memory.set(segment.bytes.subarray(source,source+length),destination);
      this._recordWrite(destination,length);
    } else if (ins.sub === 9) this.dataSegments[ins.a].dropped = true;
    else if (ins.sub === 10) {
      if (ins.a !== 0 || ins.b !== 0) unsupported('nonzero memory index');
      const length = pop32(), source = pop32(), destination = pop32(); this._bounds(source,length); this._bounds(destination,length);
      this.memory.copyWithin(destination,source,source+length);
      this._recordWrite(destination,length);
    } else if (ins.sub === 11) {
      if (ins.a !== 0) unsupported('nonzero memory index');
      const length = pop32(), value = pop32(), destination = pop32(); this._bounds(destination,length); this.memory.fill(value,destination,destination+length);
      this._recordWrite(destination,length);
    } else if (ins.sub === 12) {
      const length = pop32(), source = pop32(), destination = pop32(), segment = this.elementSegments[ins.a], table = this._table(ins.b);
      if (!segment || source + length > (segment.dropped ? 0 : segment.values.length)) trap('out-of-bounds-table-access');
      this._tableBounds(table,destination,length); for (let i=0;i<length;i++) table.values[destination+i]=segment.values[source+i];
    } else if (ins.sub === 13) this.elementSegments[ins.a].dropped = true;
    else if (ins.sub === 14) {
      const length = pop32(), source = pop32(), destination = pop32(), dst = this._table(ins.a), src = this._table(ins.b);
      this._tableBounds(src,source,length); this._tableBounds(dst,destination,length);
      const values = src.values.slice(source,source+length); for(let i=0;i<length;i++) dst.values[destination+i]=values[i];
    } else if (ins.sub === 15) {
      const length = pop32(), value = stack.pop(), table = this._table(ins.a), old = table.values.length;
      if (old + length > Math.min(table.max ?? 1000000,1000000)) stack.push(-1);
      else { table.values.length += length; table.values.fill(value,old); stack.push(old); }
    } else if (ins.sub === 16) stack.push(this._table(ins.a).values.length);
    else if (ins.sub === 17) {
      const length = pop32(), value = stack.pop(), offset = pop32(), table = this._table(ins.a); this._tableBounds(table,offset,length); table.values.fill(value,offset,offset+length);
    }
  }

  _wasi(name, rawArgs) {
    // No host filesystem is exposed. Unsupported WASI operations return ENOSYS,
    // and filesystem capabilities are rejected with their actual WASI errno.
    const args = rawArgs.map(value=>typeof value==='number'?value>>>0:value);
    const validFD = fd => fd <= 2 && !this._closedFDs.has(fd);
    const span = (pointer,length) => { this._bounds(pointer,length); return this.memory.subarray(pointer,pointer+length); };
    const write32 = (pointer,value) => { span(pointer,4); this._memoryView.setUint32(pointer,value,true); this._recordWrite(pointer,4); };
    const write64 = (pointer,value) => { span(pointer,8); this._memoryView.setBigUint64(pointer,u64(value),true); this._recordWrite(pointer,8); };
    const [a,b,c,d] = args;
    try {
      if (name === 'proc_exit') { this.done = true; this.exitCode = a; for (const frame of this.frames) this._writeEpochs.delete(frame); this.frames.length = 0; this._pendingEntry = null; return; }
      if (name === 'args_sizes_get') { write32(a,this.args.length); write32(b,this.args.reduce((total,arg)=>total+arg.length,0)); return 0; }
      if (name === 'args_get') {
        let address = b; span(a,this.args.length*4); span(b,this.args.reduce((total,arg)=>total+arg.length,0));
        this.args.forEach((arg,i)=>{ write32(a+i*4,address); this.memory.set(arg,address); this._recordWrite(address,arg.length); address+=arg.length; }); return 0;
      }
      if (name === 'environ_sizes_get') { write32(a,0); write32(b,0); return 0; }
      if (name === 'environ_get') return 0;
      if (name === 'fd_write' || name === 'fd_read' || name === 'fd_pread' || name === 'fd_pwrite') {
        if (name === 'fd_pread' || name === 'fd_pwrite') return validFD(a) ? 70 : 8;
        if (!validFD(a) || (name==='fd_read' ? a!==0 : a!==1&&a!==2)) return 8;
        if (c > 1024) return 28; // Implementation IOV_MAX; never allocate guest-sized object counts.
        span(b,c*8); span(d,4); let total=0;
        // Validate every iovec before causing observable output/input changes.
        const vectors=[];
        for(let i=0;i<c;i++) { const address=this._memoryView.getUint32(b+i*8,true),size=this._memoryView.getUint32(b+i*8+4,true); span(address,size); vectors.push({address,size}); }
        for(const {address,size} of vectors) {
          // WASI permits short I/O. Bound the work of one imported instruction,
          // allowing the execution scheduler and Stop to run between retries.
          const available = Math.min(size, 1048576 - total);
          if(name==='fd_write') {
            for(let offset=0;offset<available;offset+=65536) this.onOutput(a===1?'stdout':'stderr',this.memory.slice(address+offset,address+Math.min(available,offset+65536)));
            total+=available;
          }
          else { const count=Math.min(available,this.stdin.length-this.stdinOffset); this.memory.set(this.stdin.subarray(this.stdinOffset,this.stdinOffset+count),address); this._recordWrite(address,count); this.stdinOffset+=count; total+=count; }
          if(total===1048576)break;
        }
        write32(d,total); return 0;
      }
      if (name === 'fd_prestat_get' || name === 'fd_prestat_dir_name') return 8;
      if (name === 'fd_close') { if(!validFD(a))return 8; this._closedFDs.add(a); return 0; }
      if (name === 'fd_fdstat_get') {
        if(!validFD(a))return 8; span(b,24).fill(0); this._recordWrite(b,24); this.memory[b]=2;
        write64(b+8,a===0?2n:(1n<<6n)); write64(b+16,0n); return 0;
      }
      if (name === 'fd_fdstat_set_flags' || name === 'fd_sync' || name === 'fd_datasync' || name === 'fd_advise') return validFD(a)?0:8;
      if (name === 'fd_fdstat_set_rights') return validFD(a)?76:8;
      if (name === 'fd_seek' || name === 'fd_tell') return validFD(a)?70:8;
      if (name === 'fd_filestat_get') { if(!validFD(a))return 8; span(b,64).fill(0); this._recordWrite(b,64); this.memory[b+16]=2; write64(b+24,1n); return 0; }
      if (name === 'clock_time_get') {
        if(a>3)return 28;
        const milliseconds = a===0 ? Date.now() : (globalThis.performance?.now() ?? Date.now());
        write64(c,BigInt(Math.floor(milliseconds*1000000))); return 0;
      }
      if (name === 'clock_res_get') { if(a>3)return 28; write64(b,1000000n); return 0; }
      if (name === 'random_get') {
        const target=span(a,b); if(!globalThis.crypto?.getRandomValues) return 52;
        for(let offset=0;offset<b;offset+=65536) { const size=Math.min(b-offset,65536); globalThis.crypto.getRandomValues(target.subarray(offset,offset+size)); this._recordWrite(a+offset,size); } return 0;
      }
      if(name==='sched_yield')return 0;
      if(name.startsWith('path_'))return 76;
      if(name.startsWith('sock_'))return 8;
      return 52;
    } catch(error) {
      if(error instanceof WasmTrap && error.code==='out-of-bounds-memory-access')return 21;
      throw error;
    }
  }
}

const WASI_IMPORTS = new Set([
  'args_get','args_sizes_get','environ_get','environ_sizes_get','clock_res_get','clock_time_get','fd_advise','fd_allocate','fd_close','fd_datasync','fd_fdstat_get','fd_fdstat_set_flags','fd_fdstat_set_rights','fd_filestat_get','fd_filestat_set_size','fd_filestat_set_times','fd_pread','fd_prestat_get','fd_prestat_dir_name','fd_pwrite','fd_read','fd_readdir','fd_renumber','fd_seek','fd_sync','fd_tell','fd_write','path_create_directory','path_filestat_get','path_filestat_set_times','path_link','path_open','path_readlink','path_remove_directory','path_rename','path_symlink','path_unlink_file','poll_oneoff','proc_exit','proc_raise','random_get','sched_yield','sock_accept','sock_recv','sock_send','sock_shutdown',
]);
