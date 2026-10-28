import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
export const moduleDefinitions = {
  compiler: { owner: 2, directory: 'compiler/', contract: 'CompilerAdapter', status: 'desktop-prototype-integrated', command: 'npm run demo:integration' },
  debugger: { owner: 3, directory: 'debugger/', contract: 'DebuggerAdapter', status: 'desktop-prototype-integrated', command: 'npm run demo:integration' },
  ui: { owner: 4, directory: 'ui/', contract: '真实会话消费者', status: 'desktop-prototype-integrated', command: 'npm start' },
  storage: { owner: 4, directory: 'storage/', contract: 'StorageAdapter', status: 'desktop-prototype-integrated', command: 'npm run test:ui' },
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
    delivery: '已集成VS风格及Control数字行快捷键、混合浮点/NaN监视和迟到粘贴修复；待独立与真机验收', baseline: 'integration-v0.4.5',
    protocolVersion: capabilities.protocolVersion, selectedRoute: profiles.selectedCompatibilityId,
    offlineReady: false, deviceValidation: '待验证',
    verifiedCapabilities: capabilities.capabilities.filter(item => item.status === 'verified').length,
    implementedUnverifiedCapabilities: capabilities.capabilities.filter(item => item.status === 'implemented-unverified').length,
    modules: moduleDefinitions,
    commands: { workbench: 'npm start', prepareOffline: 'npm run prepare:offline', offlineEntry: 'npm run start:offline', offlineChecks: 'npm run test:offline', status: 'npm run status', demo: 'npm run demo:integration', tests: 'npm run test:integration', ui: 'npm run test:ui', acceptance: 'npm run test:acceptance', regressions: 'npm run test:regressions', initializer: 'npm run test:initializer' },
    next: '5号复验快捷键、新监视语义、REV-001恢复及v0.4.5完整缓存包。真实iPad按手册执行G2和实体键盘检查；GitHub合并由用户手动完成。',
  }, null, 2));
}
