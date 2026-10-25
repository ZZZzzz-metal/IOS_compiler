# 5号独立复测签收：integration-v0.2.1

日期：2026-10-25（Asia/Shanghai）。5号独立确认主套件21/21、两个最小复现2/2通过。VAL-001和VAL-002在本轮受测桌面候选和样例范围内确认修复。首轮20通过/1失败及另发现VAL-002、共两条缺陷的历史保持原样。

## 标签、来源和环境

指定标签integration-v0.2.1，精确提交7e92d2330b8e0fef1c75021d7e93522d8e6c6293。复用5号原工作区ipad-debugger-05和module/05-validation，从aa6c9de快进到标签；原tests/scratch临时文件保留。受测compiler/debugger、脚本和fixture均来自该标签下的同一工作区，运行前没有受测源码修改。

环境Windows 10.0.26200 x64、Node v24.19.0。4个不进Git的大工具链文件从本地集成副本复制并按锁定大小/SHA-256校验；verify-only确认全部11项、60,412,435字节。未下载新工具链。

开发候选integration-prototype-c992f82a5f1bad99，30项编译调试资源；resourceManifestHash为sha256:c992f82a5f1bad99865f5254cbbd7eb57bb53e0807f48e7562db196fa625222d。它仍是开发candidate，不代表完整产品离线包。

## 实际运行结果

| 实际命令 | 结果 |
|---|---|
| npm.cmd run test:acceptance | 21/21，exit 0 |
| npm.cmd run test:regressions | shadow与loop-header共2/2，exit 0 |
| npm.cmd run test:modules | 78/78，exit 0 |
| npm.cmd test | 10/10，exit 0 |
| npm.cmd run test:integration | 3/3，exit 0 |
| npm.cmd run check | 结构/29项能力记录通过，完整离线资源仍NOT READY |

本轮VALIDATION_EVIDENCE_DIR指向tests/evidence/integrated-2026-10-25-person05-v0.2.1；VALIDATION_COMPILER_ROOT与VALIDATION_DEBUGGER_ROOT均指向本工作区。各命令起止时间、退出码和原始日志，以及源码快照、构建hash、控制/查询/事件、组件身份与脚本/样例hash均在新证据中。

## 两个缺陷的实际值

| 位置 | 实际结果 | 结论 |
|---|---|---|
| cpp-core.cpp:44 | shadow可读17，innerSeen=36，loopTotal=19 | 内层遮蔽正确 |
| cpp-core.cpp:46 | 同一真实会话出块后shadow恢复5，innerSeen不可用 | 外层恢复正确 |
| lexical-shadow.cpp:6及:8 | value从内层19恢复外层7，继续退出0 | VAL-001最小复现通过 |
| loop-header.cpp:3首次暂停 | i为outOfScope，说明声明尚未执行 | 不伪造未初始化值 |
| loop-header.cpp:4三次循环体 | i分别为0、1、2 | 已初始化值正确 |
| loop-header.cpp:3后续三次暂停 | i均available，本轮绑定位置读到0、1、2；正常退出0 | VAL-002最小复现通过 |

本轮循环头实际绑定位置在递增前，后续读到0/1/2；不据此推断所有列位置都应取这些值。verify-run.mjs从原始JSON核对主样例17/5、循环头可见性、最小复现通过状态、指定标签和历史完整性。

主套件以CompilerProbe真实编译、将实际产物交给DebuggerAdapter/WorkerDebuggerAdapter；完整CompilerAdapter接入另由3项test:integration检查。模块78项包含故障注入，不能整体称作用户端验收。

## 证据和历史保留

新证据：[本轮summary.json](../../tests/evidence/integrated-2026-10-25-person05-v0.2.1/summary.json)。目录另有independent.json/.tap、regression-shadow.json、regression-loop-header.json、命令日志/退出码、history-preservation.json和新SHA256SUMS.json。

7份原始运行证据逐字节符合首轮SHA-256和长度；历史校验清单Git blob从aa6c9de到本标签未变。1号既有integrated-2026-10-25目录也未修改。本轮19份记录由独立校验清单封存；目录内的Git属性保留日志原始字节，避免换行转换破坏校验，不覆盖任何旧证据。

原始desktop-2026-10-25.md、failures-2026-10-25.md不重写；交接记录只追加本轮结论，首轮失败及当时未修复状态继续作为历史保留。

## 签收边界

5号确认G1桌面核心自动验收在本标签与已测样例范围内通过，确认上述两个修复。该结论不代表manifest全部人工checkpoint已经执行，也不扩展语言/STL/表达式支持范围。

真实iPad完整离线、正式界面、键鼠/窗口/中文输入/刷题App切换、草稿保存恢复/导出、安装与完整资源升级继续待验证。G2待验证，G3等待真机、界面和草稿；不得据此冻结路线或宣布整个产品完成。
