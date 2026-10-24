/** Convert a Clang UTF-8 byte column into the protocol's 1-based UTF-16 column. */
export function byteColumnToUtf16Column(lineText, byteColumn) {
  if (typeof lineText !== 'string' || !Number.isSafeInteger(byteColumn) || byteColumn < 1) {
    throw new RangeError('Invalid source column');
  }
  let bytes = 1;
  let utf16 = 1;
  for (const character of lineText) {
    if (bytes === byteColumn) return utf16;
    const point = character.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    utf16 += character.length;
    if (bytes > byteColumn) throw new RangeError('Byte column splits a UTF-8 character');
  }
  if (bytes === byteColumn) return utf16;
  throw new RangeError('Byte column lies outside the source line');
}

function sourcePosition(files, reportedPath, line, byteColumn) {
  // Only known project-root spellings are accepted. Never match system headers by basename.
  const sourcePath = reportedPath.startsWith('/project/') ? reportedPath.slice(9) :
    reportedPath.startsWith('project/') ? reportedPath.slice(8) : reportedPath;
  const file = files.get(sourcePath);
  if (!file || !Number.isSafeInteger(line) || line < 1) return undefined;
  const lines = file.text.split('\n');
  if (line > lines.length) return undefined;
  try {
    return { sourcePath: file.path, line, column: byteColumnToUtf16Column(lines[line - 1], byteColumn) };
  } catch {
    // An invalid compiler position is unlocated; it must not invent a user-source marker.
    return undefined;
  }
}

/** Parse ordinary Clang/LLD stderr. Source excerpts, carets and summary lines are ignored. */
export function parseClangDiagnostics(stderr, snapshot) {
  if (typeof stderr !== 'string') throw new TypeError('Compiler stderr must be text');
  const files = new Map((snapshot?.files ?? []).map(file => [file.path, file]));
  const diagnostics = [];
  // Clang normally runs with -fno-color-diagnostics; strip SGR sequences defensively.
  for (const line of stderr.replace(/\u001b\[[0-9;]*m/gu, '').split(/\r?\n/u)) {
    const located = /^(.*):(\d+):(\d+):\s*(fatal error|error|warning|note|remark):\s*(.*)$/u.exec(line);
    const lineOnly = located ? null : /^(.*):(\d+):\s*(fatal error|error|warning|note|remark):\s*(.*)$/u.exec(line);
    const unlocated = located || lineOnly ? null : /^(?:(?:[^\r\n]*?):\s*)?(fatal error|error|warning|note|remark):\s*(.*)$/u.exec(line);
    if (!located && !lineOnly && !unlocated) continue;
    const severity = located?.[4] ?? lineOnly?.[3] ?? unlocated[1];
    let message = located?.[5] ?? lineOnly?.[4] ?? unlocated[2];
    const option = /\s+\[(-[A-Za-z][^\]]*)\]$/u.exec(message);
    if (option) message = message.slice(0, option.index);
    const diagnostic = { severity: severity === 'fatal error' ? 'fatal' : severity === 'remark' ? 'note' : severity, message };
    if (option) diagnostic.code = option[1];
    if (located) {
      const start = sourcePosition(files, located[1], Number(located[2]), Number(located[3]));
      if (start) diagnostic.range = { start };
    }
    // A line without a column cannot promise a precise source position, so keep it unlocated.
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}
