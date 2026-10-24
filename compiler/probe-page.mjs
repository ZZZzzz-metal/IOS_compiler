import { CompilerProbe } from './src/compiler-probe.mjs';
import { createSnapshot } from './src/source.mjs';
import { evidenceJSON } from './src/toolchain-engine.mjs';
const element = id => document.getElementById(id);
let resourcesReady = false, revision = 0, currentResult = null, currentSnapshot = null, activeRequestId = null;
const probe = new CompilerProbe({ onProgress: event => {
  if (event.phase === 'compiling') element('status').textContent = '正在本机编译…';
  if (event.phase === 'linking') element('status').textContent = '正在本机链接…';
}});
function buttons(busy = false) {
  element('compile').disabled = busy || !resourcesReady;
  element('smoke').disabled = busy || !resourcesReady;
  element('cancel').disabled = !busy;
  element('download').disabled = busy || currentResult?.status !== 'compiled';
}
function edited() { revision++; currentResult = null; buttons(Boolean(activeRequestId)); if (!activeRequestId) element('status').textContent = '源码已修改，请重新编译。'; }
element('source').addEventListener('input', edited);
element('language').addEventListener('change', edited);
async function prepare(repair = true) {
  resourcesReady = false;
  buttons(Boolean(activeRequestId));
  element('prepare').disabled = true;
  element('resource-status').textContent = '正在准备约 60 MB 编译资源并逐项校验…';
  try {
    if (!isSecureContext || !navigator.serviceWorker) throw new Error('需要 HTTPS 或 localhost，才能保存离线资源。');
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    const worker = registration.installing || registration.waiting || registration.active;
    if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('离线资源准备超时，可重试。')), 180000);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
        if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('资源缓存或完整性校验失败。')); }
      });
    });
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('缓存校验超时，可重新准备。')); }, 180000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        if (event.data?.ok) resolve(); else reject(new Error(event.data?.message || '编译缓存不完整，请联网重新准备。'));
      };
      navigator.serviceWorker.controller.postMessage({ kind: 'verify-resources', repair }, [channel.port2]);
    });
    resourcesReady = true;
    element('resource-status').textContent = '编译资源已校验缓存。请关闭页面、断网后重开，再验证一份新源码。';
    element('status').textContent = '可编译。该状态仅代表编译资源准备完成。';
    buttons();
  } catch (error) { element('resource-status').textContent = error.message; }
  finally { element('prepare').disabled = false; }
}
element('prepare').onclick = () => prepare(true);
if (navigator.serviceWorker?.controller) prepare(false);

async function compile(smoke) {
  const language = element('language').value;
  const path = language === 'cpp' ? 'main.cpp' : 'main.c';
  const snapshot = createSnapshot([{ path, role: 'user', text: element('source').value }], path);
  const requestId = crypto.randomUUID();
  const request = { requestId, snapshot, language, standard: language === 'cpp' ? 'c++17' : 'c11', optimization: 'O0', mode: 'debug' };
  const compilationRevision = revision;
  activeRequestId = requestId;
  currentResult = null;
  element('result').textContent = '';
  element('status').textContent = '正在装载本地工具链…';
  buttons(true);
  const result = await probe.compile(request, smoke ? { smokeStdin: element('stdin').value } : {});
  activeRequestId = null;
  const unchanged = compilationRevision === revision;
  currentResult = unchanged ? result : null;
  currentSnapshot = snapshot;
  element('status').textContent = result.status === 'compiled' ? (unchanged ? '编译成功，DWARF 4 已保留。' : '旧快照编译完成；当前源码已修改，请重新编译。') : result.status === 'cancelled' ? '编译已取消，可再次编译。' : '编译失败，诊断见下方。';
  const metadata = evidenceJSON(result);
  element('result').textContent = JSON.stringify({ status: metadata.status, sourceHash: metadata.sourceHash, artifactId: metadata.artifactId, diagnostics: metadata.diagnostics, smoke: metadata.smoke, metrics: metadata.metrics }, null, 2);
  buttons();
}
element('compile').onclick = () => compile(false);
element('smoke').onclick = () => compile(true);
element('cancel').onclick = () => probe.cancel(activeRequestId);
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
element('download').onclick = () => {
  if (!currentResult || currentResult.status !== 'compiled') return;
  download('main.wasm', currentResult.executable, 'application/wasm');
  download('compiler-evidence.json', JSON.stringify({ snapshot: currentSnapshot, evidence: evidenceJSON(currentResult) }, null, 2), 'application/json');
};
