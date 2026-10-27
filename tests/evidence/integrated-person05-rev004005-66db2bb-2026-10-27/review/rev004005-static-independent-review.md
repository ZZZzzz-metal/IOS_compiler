# 5 号独立复核：REV-004 / REV-005

## 固定目标与结论

- 受测修复：`66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9`，基于 `integration-v0.4.2` 并包含 `b9ed5d1` 浅色样式。
- 负对照：`b9ed5d1faade2eedd7e9d840fb8e2ffa8504bebf`。
- 已阅读：`AGENTS.md`、归属约定、共享契约、`docs/architecture/DEEP-REVIEW-2026-10-27.md`、`REVIEW-UI-2026-10-27.md`、4 号交接及修复/测试差异。
- 本审查没有修改产品、4 号测试或历史证据，没有向其他聊天发送消息。

修复方向符合 1 号复查要求，在本轮独立受控时序范围未发现阻断两项原缺陷修复的结果。最终独立测试为 **14/14 通过**；同一组正确行为断言在旧版本为 **1 通过、13 失败**，13 项均为 `AssertionError / ERR_ASSERTION`，基础设施失败 0，没有用 `ReferenceError`、`SyntaxError` 或缺失变量造成的异常充当负对照。

本文不使用 4 号自测数量作为独立通过，也不声称获得真实浏览器、IndexedDB、编译、离线或 iPad 证据。主任务的真实浏览器结果另行记录并决定对应范围的签收；此分支修复不会自动改变主集成或旧离线包。

## 独立方法

新增可维护脚本 `tests/ui-concurrency-independent.mjs`。它从给定固定提交读取完整 `ui/src/main.mjs`，仅移除九条 import 声明，在 VM 中运行其余完整模块，包括真实声明、事件接线、render、源码/输入/语言处理器及顶层草稿恢复。测试桥接只提供观察和直接调用入口，没有替换产品函数，没有为旧源码补入新状态变量。这与 4 号抽取函数前缀/处理器并替换部分绘制的测试方法不同。

真实使用 `parseImport`、草稿创建/校验、`createAutosave`、源码快照及 editor 模块。测试运行前核对这些真实依赖与所选提交逐字节一致；输入 SHA-256 写入结果。DOM、File.text、网络响应、离线信任边界、编译/调试适配器及会话控制器使用可控替身；store 是记录真实 autosave 调用的内存实现，核对传入 CAS revision，但不替代 IndexedDB 事务或持久化证据。

一次编译的 candidate 一致性检查额外通过 VM 专用桥接强制更换全局 prepared，以验证本次捕获的 candidate 贯穿各阶段。这是对捕获防御的定向检查，不声称正常页面能绕过已测门禁并造成这种更换。

## 最终正负对照

| 用例 | 正确行为断言 | 修复 | 旧版本 |
| --- | --- | --- | --- |
| REV005-01 | B 先完成、A 迟到后，编辑稿及真实 autosave 写入只保留 B | 通过 | 断言失败 |
| REV005-02 | 待读取期间输入源码，迟到文件不覆盖，显示保留/重新选择提示 | 通过 | 断言失败 |
| REV005-03-stdin | 等待期间修改输入，完整编辑稿保持 | 通过 | 断言失败 |
| REV005-03-language | 等待期间修改语言，完整编辑稿保持 | 通过 | 断言失败 |
| REV005-03-driver | 实际切换驱动页并修改驱动，完整编辑稿保持 | 通过 | 断言失败 |
| REV005-04 | 新 B 的真实解析错误不被旧 A 的读取错误覆盖 | 通过 | 断言失败 |
| REV005-05 | A 的旧 finally 不清理仍在读取的 B 文件输入；A 不改稿 | 通过 | 断言失败 |
| REV005-06 | 当前无效完整草稿不改变原稿、不触发保存 | 通过 | 通过 |
| REV004-01 | 已 ready 后重验，首个 await 前三入口锁定，实际编辑/render 仍锁定 | 通过 | 断言失败 |
| REV004-02 | 直接重复 prepare 只产生一次候选请求 | 通过 | 断言失败 |
| REV004-03 | 即使 DOM 显示可用，prepare 期间直接 run/debug 不进入适配器构造 | 通过 | 断言失败 |
| REV004-04 | 重验失败清除旧候选、禁用编译，显式重试成功才恢复 | 通过 | 断言失败 |
| REV004-05 | 本次 candidate 贯穿两适配器、资源交接、编译请求与会话 start | 通过 | 断言失败 |
| REV004-06 | 编译中即使 DOM 显示可用，直接第二次 compile 不另建适配器 | 通过 | 断言失败 |

最终证据为 `independent/fixed-run-02/results.json`、`checks.tap` 与 `independent/baseline-run-02/results.json`、`checks.tap`。`run-01` 保留最初 13 项结果；补充重复编译用例后形成最终 14 项版本，旧记录未覆盖，也不把两轮合并成 27 项。

最终脚本原始 22,270 字节另存为 `independent/harness-final.mjs`，SHA-256 为 `3c7c3b2c228ce95651db3bcc69851279b74b445dcf9abc20165a0d4fe233ea4b`，与两个 `run-02` 的脚本输入 hash/长度及当前执行入口完全一致。只移除已知最后补丁中的两行使用注释和 REV004-06 用例，可无损还原最初 21,445 字节；还原结果同时匹配两个 `run-01` 的脚本输入 hash `026f396b9768433ef19e5c8c12a66ac12009c33322eeff9d191e3befc8f2da2b`，因此归档为 `independent/harness-run01.mjs`。核对细节见 `independent/harness-archive-verification.json`。两份归档用于保留源码字节，执行入口仍为 `tests/ui-concurrency-independent.mjs`。

可重跑命令（必须把 NEW_RUN 替换成尚不存在的新目录）：

```powershell
node tests/ui-concurrency-independent.mjs --ref 66db2bb470cea0bd0bbc8e278e17e5fc5d84a0c9 --out tests/evidence/integrated-person05-rev004005-66db2bb-2026-10-27/independent/NEW_RUN
node tests/ui-concurrency-independent.mjs --ref b9ed5d1faade2eedd7e9d840fb8e2ffa8504bebf --out tests/evidence/integrated-person05-rev004005-66db2bb-2026-10-27/independent/ANOTHER_NEW_RUN
```

旧版退出码 1 表示正确行为断言在旧版失败；不得将其报告为修复后失败或旧复现脚本故障。基础设施错误的独立退出码为 2。

## 源码判断

行号以 `66db2bb` 为准：

- `ui/src/main.mjs:155-156` 把准备中、候选缺失、恢复中、编译中和活动会话纳入渲染门禁。
- `:179-182` 拒绝不合法 prepare，进入后同步清空旧候选并 render，再开始异步读取。由于 preparing 期间重复入口直接返回，本修复无需容许多个准备任务再比较提交次序。
- `:196` 在准备失败时同时清理 ready/prepared，finally 释放 preparing 并 render。
- `:200-201` 以真实状态守卫 compile，并捕获 candidate；`:207-222` 后续适配器、编译请求及会话 key 使用本次 candidate。
- `:41` 在真实 scheduleSave 中递增编辑代次；`:279-286` 导入捕获请求序号、草稿对象、代次，并在解析/提交前逐一核对。
- `:287-290` 只有当前且未变化的结果进入解析和保存；旧错误不更换提示，旧 finally 不清理新文件输入。
- `:303` 恢复副本开始时递增代次、render；`:311` 结束恢复后再 render。此恢复路径仅静态核对，本独立套件没有操作真实恢复副本。

源文件 SHA-256：修复 `1b00e1821a0b3bf1e37d4d7109fa0a684dce13b1af29f1f322b8d1eb5674ea6f`；旧版 `dad33658c34e67daaa4d2c887a94def02b041bf57844a6b221aa9c3a7c3ff133`。

## 未覆盖与后续风险

- 独立 14 项没有故障注入每一层 trust/digest/资源下载、初始恢复失败、活动会话/恢复副本与准备的全部组合；不得将未测分支计作通过。
- 完整 VM 模块使用 DOM 替身，不能验收浅色样式、布局、可访问性、真实键盘/File 选择器、剪贴板权限或浏览器事件次序。真实 IndexedDB 冲突、强退、配额、驱逐、离线缓存和 G2/G3仍需各自证据。
- `main.mjs:275` 的异步剪贴板读取没有本次文件导入的序号/编辑代次保护。静态上存在“较早粘贴请求迟到覆盖较新操作”的同类候选风险，但本轮未独立复现，不新增缺陷编号，也不把它混入 REV-005 文件导入原缺陷的签收。
- `retry-save` 的异步恢复和实际恢复副本失败路径仍适合后续单独检查；此次新增测试没有据此声明存储工作流全部可靠。
- 本轮没有改写原 21 项首轮失败历史、VAL-004 历史或其他已封存证据。窄屏及真实 iPad 不能由此报告签收。

测试脚本在最终 `run-02` 后冻结，后续若需增加用例，应另建新证据轮次并重新记录输入 hash。
