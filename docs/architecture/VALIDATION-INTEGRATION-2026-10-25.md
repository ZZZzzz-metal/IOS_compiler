# 5 号独立验收材料接入与缺陷复测

日期：2026-10-25，Asia/Shanghai。负责人：1 号集成。交付标签 `integration-v0.2.1`；完整提交号用 `git rev-parse integration-v0.2.1` 查询。`baseline-v0.1.0` 与 `integration-v0.2.0` 固定不动。

## 接收内容

检查同项目其他聊天与本地分支后，2 号仍为 `34e46b9`，3 号仍为 `4138dcd`，均已在上一轮合入；本轮新增 5 号 `module/05-validation` 的 `aa6c9de`，其实现提交为 `a7077b5759ee7503c2acecdaacbc696c276998d9`。以合并提交 `0b0ded09a2b7db88f7fe9bc7f3588327c79c3680` 合入，保留历史。未找到 4 号的交付分支；没有创建新聊天或给其他聊天发送消息，也没有修改它们的工作区。

5 号交付包括 8 份独立 C/C++ 样例、带行号与预期值的清单、21 组真实编译调试检查、两份缺陷最小复现、原始机器可读证据及真机操作单。用户提供的 `ipad-debugger-05/docs/handoffs/05.md` 与所接收分支交接一致，原始记录已合入本仓库的 `docs/handoffs/05.md`。

## 接入修改

- 验收脚本默认读取本仓库的 compiler/debugger，显式外部目录可通过环境变量指定，不再隐式依赖兄弟工作区。
- 同仓库复测使用当前 30 项资源的 `integration-prototype-c992f82a5f1bad99` 开发组合；实际源码、产物及资源身份交叉核验。
- 新证据写入 `tests/evidence/integrated-2026-10-25/`，历史 5 号失败 JSON/TAP 和校验清单保持原样。7 项原始证据的大小与 SHA-256 在合入后全部核验一致。
- 每份新证据记录 Git 修订、未提交状态、关键验证脚本、样例及 Node 宿主的 SHA-256；不能仅凭运行时 HEAD 推断未提交脚本的字节身份。
- 增加根命令 `test:acceptance`、`test:regressions`。最小遮蔽复现补充出块后外层值与退出结果检查；输出洪泛补充非空与精确 UTF-8 安全截断前缀检查，避免空输出也被判通过。

5 号脚本使用真实 `CompilerProbe` 编译、独立包装实际产物的开发 BuildManifest，并执行真实 DebuggerAdapter/WorkerDebuggerAdapter；它测试独立样例和预期。上一轮 `test:integration` 验证完整 CompilerAdapter → 产物持久化 → WorkerDebuggerAdapter 接口，二者证据范围分别保留，不能把手工包装路径描述为本次验证了 CompilerAdapter。

## 实际结果

环境：Windows 开发电脑、Node.js v24.19.0；未关闭系统网络，没有本轮浏览器或真实 iPad 操作。工具链、运行时与调试实现未在本轮修改；沿用上一轮已测的 Clang/LLD 8、旧 WASI、wasm32/O0/DWARF4 组合。

| 命令 / 核验 | 本轮结果 |
|---|---|
| `npm.cmd run test:acceptance` 对应脚本 | 21/21 通过，0 失败；保留 5 号原有断言，并增强输出截断值检查 |
| `npm.cmd run test:regressions` 对应两个最小复现 | shadow、loop-header 均 exit 0 |
| `npm.cmd run check` | 29 项能力记录及共同结构通过；完整产品离线状态仍为 NOT READY |
| `npm.cmd test` | 10/10 契约检查通过 |
| 原始 5 号证据 SHA-256 | 7/7 与原清单一致 |

本轮新增验收 **23 个场景通过**（21 组及两个最小复现），并重跑 10 项共同契约检查。编译器/调试器实现未变，上一轮 78 项模块与 3 项全接口流水线证据保留，没有把它们虚报为本轮重新执行。

实际覆盖：独立新源码编译与 C/C++/STL 输出对照、真实断点与三种单步、递归参数和帧、数组/指针、string/vector 读取及分页、基础整数监视与拒绝副作用、旧暂停/帧拒绝、源改后重编译、Worker 终止死循环后新会话恢复、暂停预算、trap/EOF/输出限额。64 字节输出预算的样例保留三行共 63 字节的正确 UTF-8 前缀，尾部不完整字符被丢弃。

## 两条缺陷的结论

| 缺陷 | 5 号首次证据 | 当前集成复测 |
|---|---|---|
| VAL-001 同名遮蔽求值 | 内层 `value=19` 返回 ambiguous，主例 `shadow=17` 亦失败 | 最小样例内层 19、出块外层 7；主例内层 17、外层 5，均通过 |
| VAL-002 循环头已初始化变量不可见 | 后续循环头始终隐藏 `i` | 循环体 `i=0/1/2`，后三次循环头的已初始化值可读，均通过 |

产品修复已在上一轮提交 `cc2fa6a2e05153a676c570e325caf9f1baceb5df`，本轮用 5 号独立样例确认修复。原始失败记录继续保留；以上是 1 号对集成版本的实际复测，不代替 5 号对修复提交的人工签收。

- [21 组完整证据](../../tests/evidence/integrated-2026-10-25/independent.json)
- [21 组检查输出](../../tests/evidence/integrated-2026-10-25/independent.tap)
- [遮蔽缺陷复测](../../tests/evidence/integrated-2026-10-25/regression-shadow.json)
- [循环头缺陷复测](../../tests/evidence/integrated-2026-10-25/regression-loop-header.json)
- [5 号原始失败说明](../validation/failures-2026-10-25.md)

## 仍待完成

这 21 组不执行整个 `fixtures/manifest.json` 的全部人工预期。Solution 样例目前只验证编译与输出，没有执行驱动编辑、类方法断点/单步；若干循环 visits 和递归返回 checkpoint 也未覆盖。`editable-driver` 保持 planned。

停止后的“五轮”是复用已编译 C 样例的五个新会话，不是五轮重新编译或反复停止。源码修改重编译由另一项单独覆盖。宿主计时器可响应只证明 Node 主线程，不代表 iPad 界面性能。

G1 已具备限定桌面范围的独立样例与集成自动复测通过证据；5 号对新标签的复核签收仍可继续。G2 真机完全离线、G3 安装及完整工作流仍待验证，不冻结产品路线；20 项能力仍为 implemented-unverified，产品 verified 数仍为 0。4 号的界面、保存恢复、驱动编辑与前端旧数据过滤尚未交付，完整离线包、升级、许可来源及分发条件仍须后续工作。
