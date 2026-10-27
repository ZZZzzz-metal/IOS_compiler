# 3/4/5 号联合工作台集成与复验交接

日期：2026-10-25（Asia/Shanghai）。负责人：1号。用户授权合并后由用户通知5号，本轮没有给其他聊天发送消息。交付标签为 `integration-v0.3.0`，完整提交号用 `git rev-parse integration-v0.3.0` 查询。旧标签保持固定。

## 合并来源

| 来源 | 接收提交 | 集成合并提交 | 内容 |
|---|---|---|---|
| module/03-debugger | 09a4a12 | 496c52e | 声明生命周期写入跟踪、初始化旧值修复、67项调试检查及复核证据 |
| module/04-ui | 49eda46 | fc72445 | 最小真实界面、会话消费者、编辑驱动、IndexedDB草稿与保存冲突保护 |
| module/05-validation | d20b485 | 94ba2a7 | 独立签收、VAL-003新6场景、新旧实现对照及历史证据 |

依次以非快进合并接收，无冲突；各模块原工作区未修改。1号在合并后接通根启动/检查命令、更新模块状态与能力范围、重新生成当前组件组合，并进行本轮复测。

## 当前可运行入口

Node.js 22+，零第三方npm依赖。固定工具链本地11项已校验，大二进制仍按原规则忽略，不随Git标签自动出现。新工作区先按compiler/README准备相同字节。

```powershell
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd start
```

`npm start` 和 `npm run start:ui` 均先生成开发候选，再启动只提供静态文件的本机服务。默认 http://127.0.0.1:4184/ui/probe.html；页面点击“校验本地资源”后操作。状态报告改为 `npm run status`；`node app/main.mjs`仍可用。需要避开旧实验缓存时，可先设置 `$env:UI_PROBE_PORT='4186'`。不同端口草稿库独立，原稿保留在原地址。

编译、运行和调试都在浏览器Worker内完成，没有服务器计算API。这个localhost入口仅供开发电脑，未形成iPad安装方式或完整产品离线缓存。

## 合并后检查

环境：Windows开发电脑、Node.js v24.19.0。以下是当前组合的实际检查；不是把各分支旧结果相加。

| 检查 | 本轮结果 |
|---|---|
| 编译器与调试器模块 | 94/94（27编译、67调试），零失败 |
| 共享契约 | 10/10 |
| 完整CompilerAdapter→持久化→WorkerDebuggerAdapter | 3/3 |
| 5号原独立套件 | 21/21 |
| VAL-001/002最小复现 | 2/2 |
| VAL-003独立初始化场景 | 6/6 |
| UI/storage模块 | 24/24，含真实新编译与调试查询 |
| 本地资源 | 固定工具链11/11通过；当前开发组件30项 |
| 共同结构和状态 | 29项能力记录通过；完整离线资源保持NOT READY |

按不重复套件计数，自动检查共 **160项通过**。UI归档脚本另重跑的契约10项与流水线3项，以及定稿验收脚本重跑的21+2+6，不重复计入总数。模块数量包含故障注入与边界检查，不能称为160项用户端或真机验收。

本轮还补强了4号的驱动检查：初始驱动真正编译运行输出42，修改驱动重新编译后通过同一UI会话消费者及Worker实际输出44。未以sourceHash变化代替运行成功。

测试输出路径修订后，依赖harness的21+2+6重新运行并全部通过。引擎证据明确保留初始与最终脚本两阶段，记录同期能力声明元数据变化；受测编译器、调试器和技术profile未在复测期间改变。

- [引擎及验收汇总](../../tests/evidence/integrated-v0.3.0-2026-10-25/summary.json)
- [定稿验收脚本复测](../../tests/evidence/integrated-v0.3.0-2026-10-25/final-acceptance/summary.json)
- [UI/storage证据与源码身份](../../ui/evidence/integrated-v0.3.0-2026-10-25/provenance.json)
- [本轮浏览器观察](../../ui/evidence/integrated-v0.3.0-browser-2026-10-25/observations.json)

## 浏览器实际工作流

使用本仓库通过 `npm start` 启动的4186端口及Codex内置桌面浏览器。精确浏览器引擎版本未采集；没有关闭系统网络，没有真实iPad。

本轮从界面输入带唯一注释的新C++源码，stdin为7。程序在main入口与第16行断点真实暂停，显示n=7、vector元素1/2/3、string为sum；尚未初始化的total给出不可读取原因。进入add后参数为7/1，切换main调用者仍读取n=7；跳出回到调用行时total尚不可读，跳过后第17行total及监视均为8。继续到输出 `sum=23`，正常退出0。

页面重开恢复了本轮源码唯一注释、语言及stdin；后续C草稿也恢复为保存版本4。C11输入21得到 `merged-c=42`。运行真实死循环时编辑器仍可操作，停止后显示stop终态，随后对编辑中的新程序重新编译运行，输出 `merged-restart=43`、正常退出0，保存为版本6。逐项观测、截图及尚未执行项以浏览器记录为准。

页面重开不代表整个浏览器进程重启或iPad应用强制退出。新组合的跨窗口IndexedDB事务、实际文件选择器导入导出、剪贴板权限和完整布局仍应由5号独立重验；4号旧基线的浏览器证据保留原归属，不能冒充这轮重测。

## 资源身份与历史保护

新开发组合为 `integration-prototype-cf02b4efe9477db1`，resourceManifestHash为 `sha256:cf02b4efe9477db1eeda5a0d36a1066dbf67aaf6f3785c31666980ee303911ec`。运行时hash为 `sha256:17261ad99674572f0b2ab03d0ce52e700ec9c72349eacaa76ac7afeb19728c9f`。3号新修复不再使用旧c992资源身份。

这30项只覆盖所供编译调试组件，UI、存储和Node开发宿主作为本标签内可信开发代码，另外记录其实际源码指纹。它不是包含安装、离线激活和升级回退的全应用资源表。正式兼容注册仍selected=null，产品offline-bundle仍unprepared；新增驱动/草稿能力为implemented-unverified，产品verified仍为0。

UI资源准备和编译/调试实验清单均已按当前字节重建。旧模块Service Worker可能覆盖组件Worker，工作台会检测并拒绝混用；本轮使用新端口，不删除旧缓存或草稿。统一发行缓存和升级仍待实现。

历史原始证据不覆盖。测试harness和模块回归默认创建唯一integrated-run-*目录；指定VALIDATION_EVIDENCE_DIR时也必须选择新目录。UI归档脚本支持UI_EVIDENCE_DIR，只接受ui/evidence/integrated-*且拒绝覆盖历史根及已有运行文件，枚举校验时不再将子目录当文件。旧UI11项证据大小/hash核验一致。

## 给5号的下一轮复验

1. 保留自身未提交改动，在已有工作区同步 `integration-v0.3.0`，记录完整提交号；补齐并verify-only校验固定工具链，不重建或清理原工作区。
2. 使用新的 `VALIDATION_EVIDENCE_DIR=tests/evidence/integrated-person05-v0.3.0-日期标记`，执行check、契约、模块、test:integration、test:ui、test:acceptance、test:regressions、test:initializer。不要覆盖任何已封存目录。
3. 用 `npm start` 启动界面。以独立新源码检查断点、三种单步、切换帧、数组/指针/string/vector和初始化期间不可读；编辑稿与调试快照隔离，旧会话/旧帧不覆盖新显示，停止死循环后可重编译。
4. 独立检查Solution+可编辑driver的新旧输出、诊断跳转到正确用户/驱动文件、仅源码复制不夹带driver。检查草稿重开、两窗口保存冲突、恢复副本、实际导出再导入；记录真实字节和失败反馈。
5. 保存新组合的源码、产物、会话、UI操作和保存结果证据，更新5号交接。发现缺陷按所属模块反馈，由1号集成修复；本轮1号自测不代替5号签收。

G2真实iPad断网冷启动、辅助电脑关闭后的新源码编译调试，以及G3完整安装/草稿/升级仍待验证。键鼠、中文、触控、多任务、后台、强杀、配额驱逐和性能均不得用桌面结果代填。工具链源码重建与完整许可映射缺口继续保留，正式路线不冻结。
