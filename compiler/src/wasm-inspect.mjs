// Structural evidence only; this does not prove a debugger can evaluate DWARF.
export function inspectWasm(bytes) {
  if (bytes.length < 8 || [...bytes.subarray(0, 8)].join(',') !== '0,97,115,109,1,0,0,0') throw new Error('Not a Wasm v1 module');
  let position = 8;
  const uleb = () => {
    let value = 0, shift = 0;
    while (position < bytes.length && shift < 35) {
      const byte = bytes[position++]; value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error('Invalid Wasm LEB');
  };
  const sections = [];
  while (position < bytes.length) {
    const id = bytes[position++], length = uleb(), start = position, end = start + length;
    if (end > bytes.length) throw new Error('Truncated Wasm section');
    let name;
    if (id === 0) { const size = uleb(); if (position + size > end) throw new Error('Invalid section name'); name = new TextDecoder().decode(bytes.subarray(position, position + size)); position += size; }
    const section = { id, ...(name ? { name } : {}), byteLength: length, payloadOffset: position };
    if (name === '.debug_info' && end - position >= 6) section.dwarfVersion = new DataView(bytes.buffer, bytes.byteOffset + position, end - position).getUint16(4, true);
    sections.push(section);
    position = end;
  }
  return { format: 'wasm-v1', sections, dwarfSections: sections.filter(s => s.name?.startsWith('.debug_')) };
}

export function assertDebugSections(info) {
  for (const name of ['.debug_info', '.debug_abbrev', '.debug_line', '.debug_str']) {
    if (!info.dwarfSections.some(s => s.name === name && s.byteLength > name.length + 1)) throw new Error(`Missing debug section ${name}`);
  }
  if (info.dwarfSections.find(s => s.name === '.debug_info').dwarfVersion !== 4) throw new Error('Expected DWARF 4');
}
