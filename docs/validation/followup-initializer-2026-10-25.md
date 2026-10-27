# 5号跨聊天跟进：循环初始化旧值的独立回归

日期：2026-10-25（Asia/Shanghai）。本轮先查看同目录“1号”“2号”“3号”“4号”的最新对话，再核对分支和交接文件。随后完成5号可独立推进的新回归，没有修改产品代码或在其他聊天派发任务。

## 进展核对

| 聊天 | 本轮读取时的状态 | 对5号的影响 |
|---|---|---|
| 1号 | 主集成仍为integration-v0.2.1，尚未合入3号新修复和5号后续提交 | 分别记录旧集成与新修复分支，不能把分支通过说成集成已交付 |
| 2号 | 首轮编译原型已合入，暂无新提交 | 继续使用固定工具链，来源/许可与真机性能仍待对应负责人补全 |
| 3号 | 已修复循环初始化旧值，干净分支HEAD为09a4a12378e69c5bef98e713fd51cedbf6525ca5 | 新增独立程序，复现旧代码并验证修复 |
| 4号 | 正在实现和验证最小UI/storage，尚有未提交实现，交接记录仍是模板 | 等固定提交后再独立签收，当前不能把控制器检查当作完整浏览器或iPad验收 |

1号较早的状态中该问题仍未修复；3号的最新完成记录已经更新为修复提交。本轮以实际09a4a12分支和运行证据为准。

## 新增独立测试

5号将此边界记为VAL-003：循环每轮通过函数初始化局部变量时，在新值尚未存储前，不得把上一轮栈槽中的值当作当前变量值。原VAL-001/002保持原编号。

- fixtures/regressions/initializer-cycle.cpp：两轮新值40/41，正确最终输出total=81。
- fixtures/regressions/initializer-same-line.cpp：同一行先完成vector={9,4}，再初始化current；最终输出total=89。检查已完成容器不能被误隐藏。
- tests/initializer-lifetime.mjs：两份程序均现场真实编译，分别通过DebuggerAdapter和隔离Node Worker查询；另加两个“第一轮完全不查询”的场景，共6个场景。原21项和旧最小复现脚本不改。

每轮实际检查：初始化函数内查询调用者、stepOut回调用行续接处但尚未存储、stepOver到下一行完成存储。前两处current须不可读且有原因，最后一处才可读40/41。重复查询不改变结果；同一行ready始终可读9/4；程序最终输出、退出码和事件顺序正常。

## 旧集成与修复分支对照

旧代码通过5号工作区8e9d6a1运行，其compiler/debugger/app/contracts与integration-v0.2.1相同；新代码通过3号09a4a12工作区只读导入。两个工作区均使用原固定Clang/LLD8工具链。

| 验证对象 | 实际结果 |
|---|---|
| 旧集成代码运行6个新场景 | 0通过、6失败，exit 1。每个场景第二轮在初始化函数内和返回未存储时，均错误暴露上一轮40，共12个失败断言；属于同一缺陷，不是6个不同问题 |
| 09a4a12运行相同6个场景 | 6/6通过，exit 0；完成新存储后才显示41 |
| 新旧程序源码与实际Wasm | 两份源码sourceHash、可执行文件SHA-256分别完全相同，不能归因为换了程序或编译输出 |
| 修复后原独立主套件 | 21/21通过 |
| 修复后VAL-001/002最小复现 | 2/2通过 |
| 3号工作区模块回归 | 94/94通过：编译27、调试67；包含故障注入，不能整体称为用户端验收 |
| 3号完整CompilerAdapter→Worker流水线 | 3/3通过 |
| 5号贡献分支check / test | 结构通过、契约10/10通过；完整离线资源仍NOT READY |

独立新增样例的修复分支候选为debugger-prototype-460d5a2cc2f4b66c；使用外部模块profile，不冒充当前集成标签。另核验同一09a4a12真实字节生成的30项组合为integration-prototype-cf02b4efe9477db1，完整流水线检查与独立包装路径分别记录。

环境Windows 10.0.26200、Node v24.19.0。实际执行均为新源码→固定Wasm编译器→真实运行/暂停/栈帧查询；无模拟事件、预录执行或手工注入变量值。本轮未操作浏览器或真实iPad。

## 新证据与复现

两个全新目录分别保留真实失败和修复通过：

- tests/evidence/integrated-2026-10-25-initializer-person05-v0.2.1/
- tests/evidence/integrated-2026-10-25-initializer-person05-09a4a12/

各自initializer-lifetime.json/.tap保存全部源码、产物hash、查询/事件和每项断言。修复目录另含21项结果、两个最小复现、模块/流水线/契约输出与命令退出码、summary.json、integration-profile.json、history-preservation.json、verify-comparison.mjs和新SHA256SUMS.json。

对照核验确认31份既有证据的长度与SHA-256不变，涵盖首轮原始失败、1号集成记录和5号上轮独立签收。旧历史结论不重写，也不把负向对照的失败改成成功。

复现时，在5号工作区设置VALIDATION_COMPILER_ROOT、VALIDATION_DEBUGGER_ROOT为待测工作区绝对路径，并将VALIDATION_EVIDENCE_DIR设为新的tests/evidence/integrated-*目录，再运行 `node tests/initializer-lifetime.mjs`。旧集成代码应保持失败；指向09a4a12工作区应通过。不要复用已封存的目录。

## 交接与仍待验证

1号先合入3号09a4a12及5号本次新增测试，再在新的集成基线上运行新6场景、原21项和两个旧最小复现。根配置可由1号增加 `"test:initializer": "node tests/initializer-lifetime.mjs"` 入口；5号不直接修改共享package.json。

本轮可确认09a4a12修复分支在已测范围内通过，不能声称integration-v0.2.1已经含此修复。原21/21历史只覆盖原样例，不扩张为所有初始化时刻正确。

4号固定提交后，5号再检查真实UI中的旧会话/旧帧响应过滤、编辑稿与活动快照、草稿恢复和导出。当前4号仍在开发，不对移动中的工作树签收。真实iPad完整离线、界面与草稿工作流仍待验证，G2/G3不提前通过。
