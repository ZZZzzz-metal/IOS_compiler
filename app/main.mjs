import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
export const moduleDefinitions = {
  compiler: { owner: 2, directory: 'compiler/', contract: 'CompilerAdapter' },
  debugger: { owner: 3, directory: 'debugger/', contract: 'DebuggerAdapter' },
  ui: { owner: 4, directory: 'ui/', contract: '真实会话消费者，等待路线' },
  storage: { owner: 4, directory: 'storage/', contract: 'StorageAdapter' },
  validation: { owner: 5, directory: 'tests/ + fixtures/ + docs/validation/', contract: '独立真实验收' },
};

const requested = process.argv[2];
if (requested && !Object.hasOwn(moduleDefinitions, requested)) {
  console.error(`未知模块。可选：${Object.keys(moduleDefinitions).join(', ')}`);
  process.exitCode = 2;
} else if (requested) {
  console.log(JSON.stringify({ module: requested, ...moduleDefinitions[requested], status: 'not-implemented', message: '只有共同约定，尚未接入真实实现。' }, null, 2));
} else {
  const capabilities = await json('contracts/capabilities.json');
  const profiles = await json('contracts/compatibility-profiles.json');
  console.log(JSON.stringify({
    project: 'iPad 离线 C/C++ 编译调试工具', location: fileURLToPath(root),
    delivery: '1 号共同基线；非已安装产品', baseline: 'baseline-v0.1.0',
    protocolVersion: capabilities.protocolVersion, selectedRoute: profiles.selectedCompatibilityId,
    offlineReady: false, deviceValidation: '待验证',
    verifiedCapabilities: capabilities.capabilities.filter(item => item.status === 'verified').length,
    modules: Object.fromEntries(Object.entries(moduleDefinitions).map(([name, info]) => [name, { ...info, status: 'not-implemented' }])),
    next: '2/3 真实编译调试原型 + 5 独立验收；G2 真机离线通过后由 1 冻结路线。',
  }, null, 2));
}
