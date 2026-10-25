# 5 号独立验收

开发电脑 Node.js 22+，无需安装 npm 依赖。默认测试当前集成仓库中的 compiler/ 和 debugger/，独立源码及预期来自 fixtures/，执行与查询不注入预录事件。

```powershell
node tests/run-validation.mjs
node tests/reproduce.mjs shadow
node tests/reproduce.mjs loop-header
```

主套件包含21组独立检查。两条最小回归保留原本失败断言；shadow额外检查退出内层作用域后恢复外层value=7并正常退出，输出洪泛额外检查64字节上限下恰好保留3行、63个完整UTF-8字节，不能以空输出误通过。

2026-10-25 当前集成版本复测：主套件21/21通过，两条最小回归2/2通过，结果和历史证据保留情况见新目录的 summary.json。

本次集成复测使用30项实际编译调试资源构成的开发候选。测试自行调用 CompilerProbe 真正编译各独立样例，再将实际结果包装为开发 BuildManifest 交给 DebuggerAdapter/WorkerDebuggerAdapter。此路径与 `npm.cmd run test:integration` 的完整 CompilerAdapter 接口检查分别记录，不能互相替代。历史5号的模块候选、20/21主套件和两条失败证据均保留原样。

新证据默认写入 `tests/evidence/integrated-2026-10-25/`，文件为 independent.json、independent.tap、regression-shadow.json、regression-loop-header.json；不会覆盖上层历史文件或历史SHA256SUMS.json。JSON包含源码快照、构建hash、控制/查询/事件、受测组件profile、Git版本和未提交状态，以及验证脚本、fixture清单、样例与Node入口的SHA-256。复测后的汇总与校验清单也放在该目录。

可设置 `VALIDATION_EVIDENCE_DIR` 指向 `tests/evidence/integrated-*` 下的另一个目录（相对于仓库根，或该范围内的绝对路径），为不同复测保留独立记录。输出路径不允许使用历史证据根目录。

如需测试其他已准备的工作区，可显式设置 `VALIDATION_COMPILER_ROOT`、`VALIDATION_DEBUGGER_ROOT` 为各自仓库根的绝对路径。此时使用外部调试模块的开发candidate，证据会注明 debugger-module-profile；默认当前同仓库使用 integration-resource-profile。固定工具链若缺失，按 compiler/README.md 准备；验收脚本不自动联网获取资源。

模块所有者回归套件另用：

```powershell
node tests/run-module-regressions.mjs
npm.cmd run check
npm.cmd test
```

模块回归也默认当前仓库，并将输出存入新集成证据目录；它包含故障注入，不能把其数量称为产品端到端验收数量。5轮重启检查使用同一已编译c-core产物开启5个新会话，只有单独的源码修改测试会重新编译。

实际编译产物在忽略目录 `artifacts/validation-integrated/`，可重新生成。清单中尚未由自动运行器执行的其他checkpoint不能据此宣布通过。真实iPad离线、键鼠、草稿和客户端迟到响应过滤仍需真机/界面验收；当前Node结果未覆盖浏览器UI，也未断开开发电脑系统网络。
