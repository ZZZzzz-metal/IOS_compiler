import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
export const moduleDefinitions = {
  compiler: { owner: 2, directory: 'compiler/', contract: 'CompilerAdapter', status: 'desktop-prototype-integrated', command: 'npm run demo:integration' },
  debugger: { owner: 3, directory: 'debugger/', contract: 'DebuggerAdapter', status: 'desktop-prototype-integrated', command: 'npm run demo:integration' },
  ui: { owner: 4, directory: 'ui/', contract: '真实会话消费者，等待路线', status: 'not-implemented' },
  storage: { owner: 4, directory: 'storage/', contract: 'StorageAdapter', status: 'not-implemented' },
  validation: { owner: 5, directory: 'tests/ + fixtures/ + docs/validation/', contract: '独立真实验收', status: 'desktop-acceptance-integrated', command: 'npm run test:acceptance' },
};

const requested = process.argv[2];
if (requested && !Object.hasOwn(moduleDefinitions, requested)) {
  console.error(`未知模块。可选：${Object.keys(moduleDefinitions).join(', ')}`);
  process.exitCode = 2;
} else if (requested) {
  console.log(JSON.stringify({ module: requested, ...moduleDefinitions[requested], deviceValidation: '待验证' }, null, 2));
} else {
  const capabilities = await json('contracts/capabilities.json');
  const profiles = await json('contracts/compatibility-profiles.json');
  console.log(JSON.stringify({
    project: 'iPad 离线 C/C++ 编译调试工具', location: fileURLToPath(root),
    delivery: '2/3 编译调试原型与 5 号独立验收材料已集成', baseline: 'integration-v0.2.1',
    protocolVersion: capabilities.protocolVersion, selectedRoute: profiles.selectedCompatibilityId,
    offlineReady: false, deviceValidation: '待验证',
    verifiedCapabilities: capabilities.capabilities.filter(item => item.status === 'verified').length,
    implementedUnverifiedCapabilities: capabilities.capabilities.filter(item => item.status === 'implemented-unverified').length,
    modules: moduleDefinitions,
    commands: { demo: 'npm run demo:integration', tests: 'npm run test:integration', acceptance: 'npm run test:acceptance', regressions: 'npm run test:regressions', browserProbe: 'npm run prepare:probe && npm run start:probe' },
    next: '4 号界面与保存接入；5 号复核集成证据；G2 真机离线通过后由 1 冻结路线。',
  }, null, 2));
}
