import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { createSnapshot } from '../src/source.mjs';
import { evidenceJSON } from '../src/toolchain-engine.mjs';
import { createNodeProbe } from '../src/node-probe.mjs';

const [sourcePath, outputDirectory, stdinPath] = process.argv.slice(2);
if (!sourcePath || !outputDirectory) {
  console.error('Usage: node compiler/scripts/compile.mjs <source.c|cpp> <output-directory> [stdin-file]');
  process.exit(2);
}
const directory = resolve(outputDirectory);
await mkdir(dirname(directory), { recursive: true });
// Refuse reuse: a failed new invocation must never leave an old executable labelled as new.
await mkdir(directory);
const language = sourcePath.endsWith('.c') ? 'c' : 'cpp';
const snapshot = createSnapshot([{ path: basename(sourcePath), role: 'user', text: await readFile(sourcePath, 'utf8') }], basename(sourcePath));
const request = { requestId: crypto.randomUUID(), snapshot, language, standard: language === 'c' ? 'c11' : 'c++17', mode: 'debug', optimization: 'O0' };
const result = await createNodeProbe().compile(request, stdinPath ? { smokeStdin: await readFile(stdinPath, 'utf8') } : {});
await writeFile(resolve(directory, 'snapshot.json'), JSON.stringify(snapshot, null, 2) + '\n');
await writeFile(resolve(directory, 'evidence.json'), JSON.stringify(evidenceJSON(result), null, 2) + '\n');
if (result.status === 'compiled') {
  await writeFile(resolve(directory, 'main.wasm'), result.executable);
  await writeFile(resolve(directory, 'main.o'), result.object);
}
console.log(JSON.stringify({ status: result.status, sourceHash: result.sourceHash, artifactId: result.artifactId, diagnostics: result.diagnostics, smoke: result.smoke, metrics: result.metrics, directory }, null, 2));
if (result.status !== 'compiled') process.exitCode = 1;
