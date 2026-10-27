import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.COMPILER_PROBE_PORT ?? 4172);
const types = { js: 'text/javascript', mjs: 'text/javascript', html: 'text/html; charset=utf-8', json: 'application/json', md: 'text/plain; charset=utf-8' };
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (request.method !== 'GET' || !url.pathname.startsWith('/compiler/')) { response.writeHead(404).end(); return; }
    let relative = decodeURIComponent(url.pathname.slice('/compiler/'.length));
    if (!relative) relative = 'probe.html';
    if (relative.split('/').some(x => !x || x.startsWith('.') || x.includes('\\') || x.includes(':'))) throw new Error('Invalid path');
    const path = await realpath(resolve(root, relative));
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const bytes = await readFile(path);
    const type = types[path.split('.').at(-1)] ?? (['clang', 'lld', 'memfs'].some(n => path.endsWith(sep + n)) ? 'application/wasm' : 'application/octet-stream');
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(bytes);
  } catch { response.writeHead(404).end('Compiler probe file unavailable'); }
}).listen(port, '127.0.0.1', () => console.log(`Compiler probe: http://127.0.0.1:${port}/compiler/probe.html (development server, compiler scope only)`));
