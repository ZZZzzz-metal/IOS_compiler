# 4 号：最小编辑与调试验证原型

基于 integration-v0.2.1，分支 module/04-ui。只消费现有 CompilerAdapter、WorkerDebuggerAdapter 与共享契约，没有另写编译/调试引擎或增加根依赖。当前为 G2 前开发原型；正式路线、产品离线资源和安装入口尚未冻结。

## 启动

在当前仓库工作区运行，使用 Node.js 22+：

```powershell
node compiler/scripts/prepare-toolchain.mjs --verify-only
node ui/scripts/prepare-probe.mjs
node ui/scripts/serve-probe.mjs
```

打开终端输出的 http://127.0.0.1:4184/ui/probe.html ，点击“校验本地资源”。服务器仅提供静态文件，编译和运行在浏览器独立 Worker 中完成。这是当前开发电脑的入口，不是 iPad 安装方式。缺少工具链字节时按 compiler/README.md 准备；新工作区不自动包含 Git 忽略的大二进制。

prepare-probe 读取 1 号的真实组合生成器，只写入被忽略的 ui/.local/candidate.json；没有修改共享协议、能力表和正式资源组合。组件源码变化后应重新准备并刷新页面。

本页面不安装自己的离线缓存。其他模块实验页的旧 Service Worker 可能覆盖组件 Worker；默认独立端口4184，检测到此类缓存会阻止启动并提示换端口，不删除旧草稿或缓存。可用 UI_PROBE_PORT 指定另一个未使用的端口。不同端口的草稿库不同，原稿仍在原地址，可导出再导入。正式产品应由 1 号统一资源校验与缓存激活。

## 操作

1. 粘贴带 main 的 C/C++ 源码，选择 C11/C++17，填写完整样例输入。“编译运行”直接执行；“编译调试”先在用户入口暂停。
2. 点击行号或“在当前行切换断点”，继续至断点，查看请求位置与实际绑定位置。暂停后进入/跳过/跳出、选择栈帧、展开数组/vector、查询基础监视。所有值和不可读取原因来自适配器。
3. 修改后提示重新编译，执行行只标记原始快照；“查看调试快照”打开只读旧稿。停止并重新编译后才执行新稿。
4. 仅函数/Solution 类时，在“测试驱动”手写 main，并 include user.inc；清空驱动恢复单文件。诊断分别指向源码和驱动。复制/仅源码导出不夹带驱动；完整草稿包含驱动、stdin和语言。

提供基本词法高亮、查找、Tab/Shift+Tab 和触控缩进。F5继续/启动，F10跳过，F11进入，Shift+F11跳出，均有按钮。宽窗并排、窄窗切换代码/调试面板。剪贴板受限时提供手动复制粘贴对话框，不读取其他 App 私有编辑器。

IndexedDB 自动保存使用事务内 revision 比较。失败保留当前内容，可重试、导出或存为恢复副本；恢复副本 ID 在地址 hash 中，重开该地址可恢复。浏览器强制关闭前的最后一次异步写入、系统存储清理并无可靠性结论，重要代码应导出。进入后台由现有调试适配器终止并报告原因。

## 验证与集成

```powershell
npm.cmd run check
npm.cmd test
node --test ui/checks/*.test.mjs storage/checks/*.test.mjs
npm.cmd run test:integration
node ui/scripts/verify-probe.mjs
```

联合复测证据默认另存 `ui/evidence/integrated-v0.3.0-2026-10-25/`，不覆盖首轮证据。目录已有运行结果时脚本拒绝覆盖；再次运行可设置 `UI_EVIDENCE_DIR` 为 `ui/evidence/integrated-*` 下的新目录。校验清单只收录本次目录中的普通文件，保留子目录中的独立历史记录。

模块共24项通过：22项本地时序/保存/编辑检查和2项实际新源码编译调试检查。已有3项集成检查也复跑通过。浏览器真实工作流、IndexedDB重开、双窗口冲突、复制与下载导入证据见 evidence/browser-2026-10-25.json。当前栈最多显示前100帧并提示总数，变量分页可继续读取；基本高亮不等于完整 IDE。

待验证：真实iPad物理键鼠/中文/触控/多任务、文件与剪贴板权限、强制退出/配额/驱逐、完整离线冷启动、辅助电脑关闭后的新源码编译、安装更新和五号独立签收。

1号可先合入有限原型；建议根脚本新增 prepare:ui（node ui/scripts/prepare-probe.mjs）、start:ui（node ui/scripts/serve-probe.mjs）、test:ui（上述模块检查命令）。根入口、能力表及完整产品缓存由1号实际整合，本分支未修改。G2/G3不能因界面出现而标记通过。交付详见 docs/handoffs/04.md。
