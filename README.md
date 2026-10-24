# iPad 离线 C/C++ 编译调试工具

**本次交付是 1 号的共同架构基线，不是已可用的编译调试产品。** Web/PWA 与原生 App 均未选定。真实 iPad 离线关卡尚未开始，编译器和调试器尚未接入。

## 项目与共同基线

- 仓库绝对位置：`C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger`
- 集成分支：`integration`
- 共同标签：`baseline-v0.1.0`（用 `git rev-parse baseline-v0.1.0` 取得完整提交号）
- 契约版本：`0.1.0-draft.1`，最终应用形态待 G2 后决定。
- 原任务书在另一个计划目录；该目录不是产品仓库。

## 现在可以运行什么

开发电脑有 Node.js 22 或以上即可；零第三方依赖，无须安装包或联网：

```powershell
Set-Location -LiteralPath 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger'
node app/main.mjs
node scripts/check-baseline.mjs
node --test contracts/checks/*.test.mjs
```

也可使用 `npm start`、`npm run check`、`npm test`。若 PowerShell 禁止 npm.ps1，使用 `npm.cmd`。入口仅报告基线、模块接入和能力状态，**不会编译或调试代码**。这里使用 Node 是为了跨平台验证契约，不代表 iPad 需要 Node，也不锁定应用技术栈。

模块可单独检查：`node app/main.mjs compiler`（可替换为 debugger、ui、storage、validation）。这些是状态入口，适配器只有接口约定；尚未产生任何编译成功或暂停事件。

## 下一步交接

2、3、5 号从同一标签创建各自分支/工作区；2 与 3 联合验证真实工具链，5 提供独立样例与验收。4 号在真机关卡通过前只做有限交互原型。1 号在各模块交付后集成。

- [启动与工作区说明](docs/architecture/START-HERE.md)
- [范围与测试驱动](docs/architecture/SCOPE.md)
- [目录所有权](docs/architecture/OWNERSHIP.md)
- [共享接口与时序](contracts/README.md)
- [候选路线证据](docs/architecture/ROUTES.md)
- [第一轮真机操作单](docs/architecture/GATES.md)
- [离线资源与更新设计](docs/architecture/OFFLINE.md)
- [统一状态表](docs/architecture/STATUS.md)
- [1 号交付记录](docs/handoffs/01.md)
