// Compiler-only host for the pinned legacy wasi_unstable toolchain.
// The memfs binary's public bridge is documented by upstream shared.js (Apache-2.0).
// This is also used by smoke checks; it is not the project's debugger/runtime.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class ToolProcessExit extends Error {
  constructor(code) { super(`Tool exited with code ${code}`); this.code = code; }
}

export class ToolFileSystem {
  static async create(module, { outputLimit = 1024 * 1024 } = {}) {
    const fs = new ToolFileSystem();
    fs.outputLimit = outputLimit;
    fs.instance = await WebAssembly.instantiate(module, { env: {
      copy_in: (dst, src, size) => fs.bytes().set(fs.hostBytes().subarray(src, src + size), dst),
      copy_out: (dst, src, size) => fs.hostBytes().set(fs.bytes().subarray(src, src + size), dst),
      host_write: (...args) => fs.writeOutput(...args),
      host_read: (...args) => fs.readInput(...args),
      memfs_log: (ptr, size) => { throw new Error(`memfs: ${decoder.decode(fs.bytes().subarray(ptr, ptr + size))}`); },
    }});
    fs.exports = fs.instance.exports;
    fs.exports.init();
    fs.directories = new Set(['']);
    fs.files = new Set();
    return fs;
  }
  bytes() { return new Uint8Array(this.exports.memory.buffer); }
  hostBytes() { return new Uint8Array(this.hostMemory.buffer); }
  hostView() { return new DataView(this.hostMemory.buffer); }
  setPath(path) {
    const bytes = encoder.encode(path);
    if (bytes.length > 1000) throw new Error('Toolchain virtual path exceeds 1000 bytes');
    this.bytes().set(bytes, this.exports.GetPathBuf());
    return bytes.length;
  }
  directory(path) {
    path = path.replace(/\/$/u, '');
    if (!path || this.directories.has(path)) return;
    this.directory(path.split('/').slice(0, -1).join('/'));
    this.exports.AddDirectoryNode(this.setPath(path));
    this.directories.add(path);
  }
  put(path, bytes) {
    this.directory(path.split('/').slice(0, -1).join('/'));
    const inode = this.exports.AddFileNode(this.setPath(path), bytes.byteLength);
    this.bytes().set(bytes, this.exports.GetFileNodeAddress(inode));
    this.files.add(path);
  }
  get(path) {
    // Also accepts tool-created output files; the caller only asks after exit code 0.
    const inode = this.exports.FindNode(this.setPath(path));
    if (!inode) throw new Error(`Missing compiler output: ${path}`);
    const address = this.exports.GetFileNodeAddress(inode);
    const size = this.exports.GetFileNodeSize(inode);
    return this.bytes().slice(address, address + size);
  }
  loadTar(bytes) {
    const string = b => decoder.decode(b).replace(/\0.*$/su, '');
    for (let offset = 0; offset + 512 <= bytes.length;) {
      const header = bytes.subarray(offset, offset + 512);
      if (header.every(x => x === 0)) break;
      const name = string(header.subarray(0, 100)).replace(/\/$/u, '');
      const size = parseInt(string(header.subarray(124, 136)).trim(), 8);
      if (!name || name.startsWith('/') || name.split('/').some(x => !x || x === '..' || x === '.') || !Number.isSafeInteger(size)) throw new Error('Invalid sysroot tar entry');
      const storedChecksum = parseInt(string(header.subarray(148, 156)).trim(), 8);
      const actualChecksum = header.reduce((sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value), 0);
      if (storedChecksum !== actualChecksum || offset + 512 + size > bytes.length) throw new Error('Invalid sysroot tar checksum/size');
      if (header[156] === 53) this.directory(name);
      else if (header[156] === 48 || header[156] === 0) this.put(name, bytes.subarray(offset + 512, offset + 512 + size));
      else throw new Error(`Unsupported sysroot tar entry: ${name}`);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  }
  writeOutput(fd, iovs, count, written) {
    if (fd !== 1 && fd !== 2) return 8;
    const view = this.hostView();
    let total = 0;
    for (let i = 0; i < count; i++) {
      const address = view.getUint32(iovs + i * 8, true);
      const size = view.getUint32(iovs + i * 8 + 4, true);
      total += size;
      if (this.outputBytes + size > this.outputLimit) throw new Error('Compiler output limit exceeded');
      this.outputBytes += size;
      this.output[fd] += this.decoders[fd].decode(this.hostBytes().subarray(address, address + size), { stream: true });
    }
    view.setUint32(written, total, true);
    return 0;
  }
  readInput(fd, iovs, count, read) {
    if (fd !== 0) return 8;
    const view = this.hostView();
    let total = 0;
    for (let i = 0; i < count; i++) {
      const address = view.getUint32(iovs + i * 8, true);
      const size = Math.min(view.getUint32(iovs + i * 8 + 4, true), this.stdin.length - this.stdinOffset);
      this.hostBytes().set(this.stdin.subarray(this.stdinOffset, this.stdinOffset + size), address);
      this.stdinOffset += size;
      total += size;
    }
    view.setUint32(read, total, true);
    return 0;
  }
  async run(module, args, stdin = '') {
    this.stdin = encoder.encode(stdin);
    this.stdinOffset = 0;
    this.outputBytes = 0;
    this.output = { 1: '', 2: '' };
    this.decoders = { 1: new TextDecoder(), 2: new TextDecoder() };
    const argv = args.map(arg => encoder.encode(arg + '\0'));
    const imports = { ...this.exports,
      proc_exit: code => { throw new ToolProcessExit(code); },
      environ_sizes_get: (count, size) => { const v = this.hostView(); v.setUint32(count, 0, true); v.setUint32(size, 0, true); return 0; },
      environ_get: () => 0,
      args_sizes_get: (count, size) => { const v = this.hostView(); v.setUint32(count, argv.length, true); v.setUint32(size, argv.reduce((n, arg) => n + arg.length, 0), true); return 0; },
      args_get: (pointers, buffer) => { argv.forEach((arg, i) => { this.hostView().setUint32(pointers + i * 4, buffer, true); this.hostBytes().set(arg, buffer); buffer += arg.length; }); return 0; },
      random_get: (ptr, len) => { for (let offset = 0; offset < len; offset += 65536) crypto.getRandomValues(this.hostBytes().subarray(ptr + offset, ptr + Math.min(len, offset + 65536))); return 0; },
      // Not part of the compiler smoke contract. Fail explicitly if a program uses these.
      clock_time_get: () => 52,
      poll_oneoff: () => 52,
    };
    const instance = await WebAssembly.instantiate(module, { wasi_unstable: imports });
    this.hostMemory = instance.exports.memory;
    let exitCode = 0;
    try { instance.exports._start(); }
    catch (error) { if (error instanceof ToolProcessExit) exitCode = error.code; else throw error; }
    this.output[1] += this.decoders[1].decode();
    this.output[2] += this.decoders[2].decode();
    return { exitCode, stdout: this.output[1], stderr: this.output[2], memoryBytes: this.hostMemory.buffer.byteLength };
  }
}
