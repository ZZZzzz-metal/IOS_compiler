# 2/3 号联合原型集成交付

日期：2026-10-25。负责人：1 号。交付标签 `integration-v0.2.0`；首次标签 `baseline-v0.1.0` 保持不动。完整提交号可用 `git rev-parse integration-v0.2.0` 取得。本记录属于桌面研发交付，G2 真机尚未执行。

## 接收与合入

| 模块 | 接收分支 / 完整提交 | integration 合并提交 |
|---|---|---|
| 2 编译工具链 | module/02-compiler / 34e46b92249e9b8f8870dcf8cc09c5037fdc318e | 3dba55b |
| 3 运行与源码调试 | module/03-debugger / 4138dcd436d3b7e2963ecca7abfbeb08be77f904 | e4e1ceb |

两个分支保留原始历史，以 merge 合入。1 号另外增加统一宿主、集成检查与资源组合，修复合入时发现的变量问题，并更新入口、能力记录与交接。没有改变其他编号的工作区或给其他聊天发送消息。

## 实际接通的任务点

- 新源码由 `CompilerAdapter` 在本地 Wasm 编译 Worker 中编译，宿主持久化真实字节，再把原样 `BuildManifest`、快照和该字节交给 `WorkerDebuggerAdapter`。没有用样例产物代替本次编译，没有手工伪造构建成功。
- `app/integration/candidate.mjs` 校验固定上游资源，根据实际组件生成开发兼容组合。编译器和调试器接收同一 profile；启动核验全量所供资源表及实际产物 hash。该候选没有注册为正式产品路线。
- 实际断点在运行前绑定；进入、跳过、跳出控制真实执行，查询真实内存、局部值和递归帧；旧暂停查询被拒绝。
- C11 批量输入、输出与 64 位值；C++ 数组、有效指针、string/vector、扩容及递归；停止真实死循环后新源码重新编译运行。
- 每次调试使用新的 Worker 适配器，关闭时回收 Worker，避免跨构建积累有界内存资源。失败清理、重复关闭及已终态等待已处理。
- 浏览器实验、样例生成器、DWARF 检查与运行时对照检查改为读取同仓库资源。根状态入口准确报告桌面原型已接入。

## 本轮修复

独立复核发现，原调试器仅按源码声明行判定初始化，会在循环回到头部时把已初始化的 `i` 错报为不可读；监视表达式也会把外层和内层同名 `x` 一起判作歧义。

修复依据 DWARF 中声明在词法作用域内的首个语句位置及实际帧存储记录判断初始化，并按最内层活动声明解析名字。真实 `shadow-loop` 样例验证：声明边界不展示旧栈字节，循环增量处 `i=0/1`，循环内 `x=2`，退出块后 `x=1`，程序退出码为 `6`。源快照、Wasm 与编译证据在 `debugger/fixtures/shadow-loop/`；新增两项回归。覆盖仍限于已支持的 Clang 8/O0/DWARF4 位置模式，不表示任意编译器或控制流均已验证。

## 运行与本轮证据

环境：Windows 开发电脑，Node.js v24.19.0。零第三方 npm 依赖。11 项工具链资源共 60,412,435 字节；四个大文件从已有 2 号副本复制前核验 hash，随后在主仓库再次全量核验。本轮没有下载或替换上游工具链。

```powershell
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd run check
npm.cmd test
npm.cmd run test:modules
npm.cmd run test:integration
npm.cmd run demo:integration
```

| 检查 | 实际结果 / 范围 |
|---|---|
| 固定工具链资源 | 11/11 大小与 SHA-256 通过 |
| 共同结构与能力表 | 29 项记录合法；完整产品离线状态正确保持 NOT READY |
| 契约测试 | 10/10 通过 |
| 编译器与调试器检查 | 78/78 通过，零跳过：编译器 27、调试器 51（含新增 2 项） |
| 全接口流水线检查 | 3/3 通过，每轮编译带唯一标记的新源码并使用实际 Worker |
| 独立演示 | 完整通过；快照、构建身份、调用帧、事件和输出已保存 |
| JS/Python 源码 hash | 两组跨语言固定向量通过 |
| 浏览器实验资源生成及文件映射 | 34 项、60,625,944 字节，路径映射与 hash 逐项通过 |
| 本轮浏览器 UI / HTTP | 未通过复测条件：内置浏览器访问超时；本机浏览器自动化因无法可靠判断地址而停止。受管网络下 localhost 请求被拒绝，显式只读重试超时。本轮未计为浏览器执行通过 |

合计 **91 项自动检查通过**（10 + 78 + 3）。这是开发电脑的结果，不是 5 号独立验收或真实 iPad 验收。修改过程中的新增回归曾有 `null/undefined` 断言错误，已修正；表中为定稿后重新运行的结果。

实际演示关键值：C++ `total=15 changed=23 vector=23`；递归帧参数分别为 `[0]`、`[1,0]`、`[2,1,0]`。C 输入 `2 4 6 8` 得到 `sum=20 first=2 int64=9223372036854775806`。本次死循环停止约 3ms，随后新编译程序输出 `recompiled=47`；该时延仅代表本次开发电脑，不能用于 iPad 指标。

本次开发 profile 为 `integration-prototype-c992f82a5f1bad99`，绑定 30 项所供组件资源、共 60,606,917 字节。新增或修改组件字节会生成不同身份。Node 宿主、实验页和完整应用资源集合不同，不能混用各自的 resourceManifestHash。

这 30 项不包含 `app/integration/` 开发宿主和 `debugger/src/node-worker.mjs` 的 Node 传输入口；它们作为本标签中的可信开发代码运行。该资源表不覆盖整个 Node 程序，也不是完整安装包资源清单。

- [完整联合演示证据](evidence/integration-node-2026-10-25.json)
- [开发 profile 与资源表](evidence/integration-resources-2026-10-25.json)
- [78 项模块检查原始输出](evidence/modules-2026-10-25.tap)
- [3 项流水线检查原始输出](evidence/pipeline-2026-10-25.tap)
- [静态资源文件映射与浏览器复测限制](evidence/integration-static-2026-10-25.json)

原有 compiler/debugger 模块证据仍属于各自首次交付版本；不能拿旧证据的资源身份覆盖本次候选。

## 边界与后续接入

固定组合：Wasm Clang/LLD 8.0.1、旧 `wasi_unstable`、wasm32-unknown-wasi、小端 32 位地址、O0、嵌入 DWARF4；项目 JavaScript 指令解释器和 DWARF 调试器；libc++ `std::__2` 的 string/vector 布局。线程、SIMD、新 Wasm 提案、DWARF5、完整 C++ 表达式求值不支持。`bits/stdc++.h`、交互 stdin、运行中主动暂停不开放；异常、RTTI、完整语言和库覆盖未建立支持结论。

能力表已有 20 项 `implemented-unverified`，每项注明桌面实现边界；没有新增产品 `verified`。正式 profile 注册表仍未选定，产品 offline bundle 仍未准备。开发候选缺完整 UI、存储、安装和升级激活系统，不能显示全产品离线可用。固定二进制的源码重建及全部依赖许可映射仍不完整，正式分发前需补齐。

4 号可从本轮标签读取 `app/integration/` 作为真实适配器连接参考，并实现快照/会话接收、旧数据失效、事件缺口恢复和编辑驱动工作流；Node 宿主不是浏览器 UI 组件。5 号以本轮集成标签和独立源码复测精确断点、变量及恢复行为。G1 桌面证据已具备，独立验收待；G2 真机离线与 G3 安装交付待，路线保持未冻结。
