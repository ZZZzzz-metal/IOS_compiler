# IOS_compiler · iPad 离线 C/C++ 编译调试工作台

**当前：先修复已知问题，再进行真机验证。** 用户要求关闭const-string非法成员模板候选、unavailable仍可选择两项已确认问题。2号已接修复、5号负责独立复验；[PR #4](https://github.com/ZZZzzz-metal/IOS_compiler/pull/4)已恢复草稿，暂缓合并和真机推进。进度见[本轮修复计划](docs/architecture/COMPLETION-FIX-PLAN-2026-10-30.md)。下方0.4.6为重开修复前的历史交付记录。

2026-10-30当前版本0.4.6：真实离线成员、变量和函数提示已集成，5号最终UI/完整包交付cbc92b2已合入6ba18d2并在已测桌面范围签收。原33场景32通过、const-string一项边界失败；另有unavailable属性边界失败，两项均未修复。62资源新包及停服后全新源码补全、编译调试、撤销与草稿重开已有独立证据；真实iPad仍待验证。[PR #4](https://github.com/ZZZzzz-metal/IOS_compiler/pull/4)由你手动合并；精确身份、结果与限制见[本轮报告](docs/architecture/COMPLETION-INTEGRATION-v0.4.6-2026-10-30.md)。旧包、标签和原始失败保留。

2026-10-28最终追加：5号e4ce507已合入。固定40a079b/r3最终组合和完整包在已测桌面范围独立通过；常规258、另列离线22、监视25加1范围、剪贴板8场景25断言及69条真实浏览器观察通过。REV-001仅入口缺失/当前完成缓存trust损坏两类实际桌面恢复独立关闭；真实iPad、草稿强可靠性和G2/G3仍待。旧标签/包/失败保留，旧版最终结论见 [最终桌面验收追加](docs/architecture/FINAL-DESKTOP-ACCEPTANCE-v0.4.5-2026-10-28.md)。下方各轮发布时记录按当时时点保留。

在浏览器设备内编译、运行和调试 C/C++，用于刷题与算法练习。项目已将真实 Wasm 编译器、源码调试器、编辑界面、本地草稿和独立回归整合为可运行的桌面原型；正在验证完整缓存与 iPad 使用流程。

**目前还没有通过 iPad 真机验收，也没有原生 IPA 安装包。** 当前进度、固定版本和待验证项以 [集成状态](docs/architecture/STATUS.md) 为准。`integration` 是集成分支，合并请求由仓库维护者手动合并。

## 可以做什么

- 编辑或导入 C/C++ 源码，运行前提供完整输入，编译后查看输出和诊断。
- 编辑时输入对象成员或名称前缀可请求本机代码候选；支持按钮、Ctrl+J/Ctrl+Space及Tab/Enter确认，完整范围见[使用说明](ui/COMPLETION.md)。
- 在用户代码处暂停，使用断点、进入、跳过、跳出，查看变量、调用栈和基础监视表达式。
- 为仅有函数或 `Solution` 的题目补写测试驱动；复制题站源码时保持驱动分离。
- 自动保存本地草稿、导入导出完整草稿；编辑后的内容与活动调试快照分开显示。
- 首次联网准备按版本隔离的完整 Web 缓存，再测试断网关闭重开和新源码编译调试。服务器只提供静态文件，编译和调试在浏览器 Worker 内完成。

这些是已测桌面原型的工作流程。正式支持声明仍以 [能力表](contracts/capabilities.json) 为唯一来源；接口存在、按钮可见或缓存校验成功都不能代替设备验收。

## 在电脑上启动

需要 **Node.js 22 或更新版本**与 Git。项目没有第三方 npm 依赖，无需先运行 `npm install`。

```powershell
git clone --branch integration https://github.com/ZZZzzz-metal/IOS_compiler.git
cd IOS_compiler
npm.cmd run prepare:toolchain
npm.cmd start
```

首次准备工具链需要联网，脚本按 [锁定清单](compiler/resources/toolchain.lock.json) 下载并校验固定资源。新的 checkout 不包含四个被 Git 忽略的大型二进制文件。已有本地副本时可先运行 `npm.cmd run prepare:toolchain -- --verify-only` 检查。

启动后用电脑浏览器打开 [算法工作台](http://127.0.0.1:4184/ui/probe.html)，点击“校验本地资源”，再选择“编译运行”或“编译调试”。停止本地服务可在启动窗口按 `Ctrl+C`。

`npm.cmd run status` 查看集成状态；`npm.cmd run prepare:ui` 只重建开发组合。组件更新后需要重新准备并刷新页面。若默认端口已有旧实验，可先设置 `$env:UI_PROBE_PORT='4186'` 再启动；不同端口使用不同草稿库，切换前请导出重要草稿。

上述命令使用 Windows PowerShell 的 `npm.cmd`；其他环境可使用 `npm`。电脑的 `127.0.0.1` 不能作为平板访问地址。

## 完整离线实验与 iPad 操作

准备好工具链后，在电脑运行：

```powershell
npm.cmd run prepare:offline
npm.cmd run start:offline
```

打开命令输出的地址，进入**固定版本准备页**，点击“准备离线资源”。完整校验通过后打开工作台，再点击“校验本地资源”。关闭页面、停止服务器，重新打开记录下来的固定版本完整地址，才能验证缓存冷启动；外层版本选择首页不在离线缓存中。

平板首次准备需要可访问且受信任的 **HTTPS** 地址，普通局域网 HTTP 不满足缓存安装条件。维护者需按 [离线入口说明](app/offline/README.md) 与 [本地 HTTPS 配置](app/offline/LOCAL-HTTPS.md) 准备服务，再提供实际地址。生成目录和精确资源身份记录在 `app/offline/.local/`，不随 Git 上传。

本轮固定身份与更新核对见[0.4.6更新步骤](docs/architecture/IPAD-UPDATE-v0.4.6.md)。

**平板上的逐步操作见 [iPad 操作手册](docs/architecture/IPAD-USER-MANUAL.md)**：首次准备、添加主屏、断网关闭重开、关闭辅助电脑、编译全新源码、断点与单步、草稿备份和问题反馈都有步骤。平板无需安装 Node.js。固定版本更新说明从 [集成状态](docs/architecture/STATUS.md) 进入；历史说明里的局域网地址和证书有效期仅属于当时的本地实验。

## 平板键盘快捷键

v0.4.5集成了两种方案。默认“无F键：Control＋数字行”适用于没有独立F1–F12的键盘；标准F键始终保留。先校验资源，再点击源码使用快捷键；Ctrl指 **Control**，不是Command（⌘）。

| 操作 | 默认Control数字行 | 标准F键 |
|---|---|---|
| 开始 / 继续 | Ctrl+5 | F5 |
| 编译运行 | Ctrl+6 | Ctrl+F5 |
| 停止 / 取消编译 | Ctrl+Shift+5 | Shift+F5 |
| 当前行断点 | Ctrl+9 | F9 |
| 跳过 | Ctrl+0 | F10 |
| 进入 | Ctrl+- | F11 |
| 跳出 | Ctrl+Shift+- | Shift+F11 |

数字取字母上方数字行，减号在0右侧，无需Fn或Option。展开工作台“键盘快捷键”可以切换到“仅标准F键”。输入框、弹窗、中文组合输入和长按重复受到保护；动作仍受真实会话状态和能力限制。详细操作、焦点规则及实机小操作单见 [快捷键速查](ui/SHORTCUTS.md)。桌面验证不能证明iPad实体键盘能向Safari发送这些事件；没有响应时使用按钮并记录设备表现。

## 验证与当前限制

日常检查：

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:modules
npm.cmd run test:ui
npm.cmd run test:integration
npm.cmd run test:offline
npm.cmd run test:acceptance
npm.cmd run test:regressions
npm.cmd run test:initializer
```

自动检查、实际桌面浏览器、独立验收与 iPad 真机结果分别记录，不能相互替代。验收脚本会创建新的证据目录；不要复用或覆盖封存目录。设置输出位置、模块复验和证据规则见 [测试说明](tests/README.md) 及各模块交接。

2026-10-27历史修复已合入5号对REV-004/005 的独立复验，在其已测桌面范围关闭资源准备门禁和导入次序缺陷，详见 [独立报告](docs/validation/rev004005-person05-66db2bb-2026-10-27.md)。3号监视求值修复已合入：八进制 `010` 按8求值，拒绝指针相加，指针相减明确不支持，浮点一元运算保留原类型；旧v0.4.5最终组合已通过5号限定桌面独立复验，准确范围见[最终报告](docs/architecture/FINAL-DESKTOP-ACCEPTANCE-v0.4.5-2026-10-28.md)。

REV-006/007监视浮点/NaN错误和REV-008迟到粘贴覆盖已分别修复，在旧v0.4.5/r3最终组合的已测桌面范围由5号独立通过。原始失败和旧候选保留；新代码提示功能另按固定0.4.6组合/新完整包验收，不能借用旧版结果。重要草稿继续定期导出，真实iPad尚待验证。

代码提示使用固定Clang8的真实候选，只插入名称并显示签名；部分const字符串模板和unavailable属性仍可能出现实际不可调用的候选。这两项原始边界失败保留，不声明完整VS语义或全部模板可用性；是否能调用以编译诊断为准。

当前固定开发工具链为 Clang/LLD 8.0.1、旧 `wasi_unstable`、wasm32、小端、O0 与嵌入 DWARF4。`string` / `vector` 只覆盖已测 libc++ `std::__2` 布局。完整语言与标准库、C++ 异常/RTTI、线程、新 Wasm 提案和完整 C++ 表达式未建立支持结论；`bits/stdc++.h`、交互式 stdin、运行中主动暂停不支持。

正式兼容组合仍未选择，产品 `offline-bundle` 仍为 `unprepared`。G2 真机离线与 G3 完整流程验收尚未通过；耗时、内存、后台切换、键鼠与中文输入、系统清理后恢复等需要实际 iPad 证据。完整支持边界见 [验收关卡](docs/architecture/GATES.md)。

## 项目记录与协作经验

| 内容 | 入口 |
|---|---|
| 当前进度、下一步与版本 | [STATUS](docs/architecture/STATUS.md) |
| 最初六份任务分工 | [原始计划归档](docs/architecture/original-plan/) |
| 集成过程、缺陷与经验 | [项目复盘](docs/architecture/PROJECT-RETROSPECTIVE-2026-10-27.md) |
| 共享协议与支持声明 | [接口说明](contracts/README.md)、[能力表](contracts/capabilities.json) |
| 工作区与目录所有权 | [启动说明](docs/architecture/START-HERE.md)、[分工](docs/architecture/OWNERSHIP.md) |
| 1—5 号交接 | [总架构](docs/handoffs/01.md)、[编译](docs/handoffs/02.md)、[调试](docs/handoffs/03.md)、[界面与保存](docs/handoffs/04.md)、[独立验收](docs/handoffs/05.md) |

各模块通过独立分支交付，再在 `integration` 合并、检查实际组件身份、复验并交独立验收。原始失败、修复证据、版本标签和旧缓存入口保留，避免用后来的成功改写历史结果。

仓库公开保存源码、资源锁定清单、任务与交接文档，以及已纳入 Git 的小型样例和验证证据。完整工具链二进制、生成的运行包、临时文件和本地 TLS 材料由忽略规则排除；私钥不得上传。第三方二进制到源码及依赖的完整映射、许可与通知仍有缺口，详见 [资源许可记录](compiler/resources/LICENSES.md)。本仓库尚未指定统一项目许可证，不应将上游组件许可证当作整个项目的授权声明。

2026-10-28阶段记录（早于e4ce507最终验收，历史保留）：5号c32cbf8已合入（222e30a），REV-006/007在309cb45已测桌面范围、REV-008在33c1639受控并发语义范围独立关闭；最终组合/r3完整包、REV-001实际浏览器恢复及真实iPad仍另验。root251项、最终r3停服重开全新源码编译调试/草稿与设置恢复、严格HTTPS均通过；精确证据以SHORTCUTS-INTEGRATION-2026-10-28.md当前结论为准。此追加不覆盖各轮历史。
