# iPad 离线 C/C++ 编译调试工具

**编译器、修复后的调试器、最小操作界面、本地草稿与独立回归已统一合入桌面开发原型。** 可以编辑新 C/C++ 源码、提供输入、真实编译运行，使用断点、三种单步、变量和调用栈，并保存或导出草稿。真实 iPad 完全离线、安装及最终产品验收仍待完成，路线未冻结。

## 版本与交接

- 仓库：`C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger`
- 分支：`integration`；本轮离线实验交付：`integration-v0.4.0`。
- 旧标签 baseline-v0.1.0、integration-v0.2.0、integration-v0.2.1、integration-v0.3.0 保持原样；协议仍为 `0.1.0-draft.1`。
- [离线入口交付](docs/architecture/OFFLINE-INTEGRATION-2026-10-26.md)、[v0.3.0组合复验步骤](docs/architecture/UI-INTEGRATION-2026-10-25.md)、[统一状态](docs/architecture/STATUS.md)。

## 启动统一工作台

开发电脑需要 Node.js 22+，零第三方 npm 依赖：

```powershell
Set-Location -LiteralPath 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger'
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd start
```

当前电脑的 11 项工具链资源已准备。新 checkout 不包含四个 Git 忽略的大文件，缺少时可运行 `npm.cmd run prepare:toolchain` 首次联网获取固定资源，或复制已校验的本地副本。

`npm start` 自动按实际组件字节生成开发组合，再启动仅本机访问的静态服务。打开 [算法工作台](http://127.0.0.1:4184/ui/probe.html)，点击“校验本地资源”，随后编译运行或调试。编译和执行在浏览器 Worker 内完成，服务器不提供计算服务。

`npm.cmd run start:ui` 与 `npm start` 相同。状态报告改用 `npm.cmd run status`，也可直接运行 `node app/main.mjs`。只重建组合用 `npm.cmd run prepare:ui`；组件更新后重新准备并刷新页面。

若当前端口存在旧模块实验缓存，可在启动前设置 `$env:UI_PROBE_PORT='4186'`，再 `npm.cmd start`。不同端口是独立草稿库，原草稿仍在原地址，可导出再导入；不要清理旧数据。本机 localhost 不是 iPad 安装入口。

## 离线实验与平板操作

1号新增按版本隔离、逐项校验的完整 Web 缓存实验。电脑端运行 `npm.cmd run prepare:offline`，再 `npm.cmd run start:offline`，打开命令输出的本机地址，进入固定版本后点“准备离线资源”。该入口与上面的未缓存开发入口分开；平板需要另行提供可达且受信任的 HTTPS 地址。详见 [离线实验说明](app/offline/README.md)。

**你在 iPad 上的逐步操作见 [平板操作手册](docs/architecture/IPAD-USER-MANUAL.md)**：首次准备、添加主屏、断网关闭重开、新源码编译、调试、停止恢复及草稿备份都有具体步骤和预期。实际 HTTPS 地址和 G2 真机结果仍待补齐；没有原生安装包，不把完整缓存生成成功称为 iPad 已通过。

## 工作流与检查

- 带 main 的 C/C++ 直接粘贴到题站源码；仅函数/Solution 可在测试驱动中手写 main 并 include user.inc。
- 编译调试在用户入口暂停；行号设置断点，继续、进入、跳过、跳出均有按钮。变量和调用栈来自真实适配器。
- 编辑后提示重新编译，旧调试位置只对应原始只读快照。复制题站源码不夹带测试驱动；完整草稿导出保留驱动、语言和输入。
- 草稿自动保存采用版本比较，冲突或失败保留当前编辑并提供恢复副本/导出。浏览器强制关闭前最后一次异步保存、系统存储清理及iPad行为尚未验收。

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:modules
npm.cmd run test:ui
npm.cmd run test:integration
npm.cmd run test:acceptance
npm.cmd run test:regressions
npm.cmd run test:initializer
```

自动检查的范围与实际结果见本轮报告。`npm.cmd run demo:integration` 另输出真实全接口流水线的构建与事件。`verify:ui` 归档UI、契约及流水线检查；新证据另存并拒绝覆盖历史。重复归档请设置新的 `UI_EVIDENCE_DIR=ui/evidence/integrated-新名称`。

独立验收脚本默认创建唯一的 `tests/evidence/integrated-run-*` 目录。需要同一轮命令归档在同一目录时，显式设置新的 `VALIDATION_EVIDENCE_DIR=tests/evidence/integrated-新名称`。不得复用封存证据目录；5号原始失败、已签收版本与本轮集成结果分别保留。

## 当前边界

固定开发组合为 Clang/LLD 8.0.1、旧 wasi_unstable、wasm32、小端、O0 与嵌入 DWARF4，string/vector 针对已测 libc++ std::__2 布局。完整语言/标准库、C++异常/RTTI、线程、新Wasm提案和完整C++表达式未建立支持结论；bits/stdc++.h、交互stdin及运行中主动暂停不支持。工具链源码重建和完整依赖许可映射仍待补齐。

开发profile的30项清单只覆盖编译调试组件；UI、Node开发宿主和安装系统不在该集合内。正式兼容注册仍未选择，产品offline-bundle仍unprepared。资源校验通过不等于完整产品离线就绪。5号需独立复验本次新组合的界面和保存，再按G2在真实iPad断网关闭重开、关闭辅助电脑后编译全新源码并完成调试。

- [启动与工作区](docs/architecture/START-HERE.md)
- [范围与驱动](docs/architecture/SCOPE.md)
- [共享接口](contracts/README.md)
- [真机关卡](docs/architecture/GATES.md)
- [离线资源设计](docs/architecture/OFFLINE.md)
- [1号交接](docs/handoffs/01.md)
