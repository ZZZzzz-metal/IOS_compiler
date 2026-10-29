# 离线补全后端交接（CC-20261029-02）

2026-10-29，基于冻结契约提交 `38ff3075a4b47c3f72ae2f6552a04e58da07d6c0`。本模块提供真实 Clang 8 Wasm 前端补全；界面、可信 Worker URL、完整离线包与独立验收由 1/4/5 号接入。本轮没有浏览器或 iPad 补全验收。

```js
import { CompletionAdapter } from './src/completion-adapter.mjs';
const completion = new CompletionAdapter({
  lock, // 集成层已校验、可信的 toolchain.lock.json 对象
  createWorker: () => new Worker(trustedCompletionWorkerURL, { type: 'module' }),
  timeoutMs: 15000,
});
const result = await completion.complete({
  requestId: crypto.randomUUID(), documentVersion, snapshot,
  language: 'cpp', standard: 'c++17', sourcePath: 'user.inc', offset,
  trigger: '.',
});
```

`snapshot` 使用现有 `createSnapshot`。`offset` 是该快照中 sourcePath 的 **正规化 UTF16** 插入点，不能切分代理对；不能直接把带 BOM/CRLF 的编辑器光标传入。UI 应在创建快照时保存 raw→normalized 映射，并在确认时将半开 replaceRange 映回同一版 raw 文本。后端不修改编辑器、快照、构建产物或调试会话。

`sourcePath` 可以是由 `driver.cpp` 包含的 `user.inc`。后端始终解析 snapshot.translationUnit，并把目标文件插入点转成 `/project/<sourcePath>:1-based-line:1-based-UTF8-byte-column`。光标在标识符中间时只用前缀过滤，replaceRange 覆盖当前完整标识符。声明查找/作用域/类型来自 Clang；小型 lexer 仅识别注释、字符/普通/原始字符串和替换范围。

新增运行文件是 `compiler/src/completion-{adapter,worker,engine,source,output}.mjs`。递归依赖复用现有 `source.mjs`、`diagnostics.mjs`、`wasm-host.mjs`、`toolchain-engine.mjs`、`wasm-inspect.mjs`。新增 Worker 必须由集成层纳入 candidate、可信 scope 覆盖和完整离线缓存；动态 Worker URL 不能只靠静态 import 扫描。此模块不更改根配置或资源组合，不添加依赖。

## 资源与取消

Worker 按可信 lock 逐项验证 `memfs`、`sysroot.tar`、`clang` 的长度和 SHA-256，共 **40,857,834 B**；不读取、编译或运行 LLD。命令为真实 `-cc1 -fsyntax-only -code-completion-at=...`，不生成 `.o/.wasm/BuildManifest`。暖 Worker 仅缓存两个 WebAssembly.Module 和 sysroot 字节；每请求创建新 memfs/Clang 实例。同一 Clang 实例二次 `_start` 的实际实验崩溃，禁止复用。

一次只保留一个活动请求；新合法请求取消旧活动任务。调用入口复制请求，校验唯一 requestId、版本、快照 hash、语言、路径、边界和 1 MiB 源码限额。返回前逐项校验 requestId/documentVersion/snapshotId/sourceHash/sourcePath/offset、资源身份、唯一 item ID 和当前 token 的替换范围。迟到、重复、过时结果不能产生新编辑。

- `await cancel(activeRequestId)`：终止独立 Worker，等待实际释放和原 complete Promise 结算。Node 等待 terminate Promise；浏览器调用原生 terminate。Wasm 同步执行不能靠向 Worker 发普通 cancel 消息中断。
- `await cancel(lastCompletedRequestId)`：如果该 ID 仍属于当前空闲暖 Worker，也释放它。旧 ID 不会终止更新的活动或空闲请求。**开始全编译前，不能只清除弹窗，必须释放活动或空闲暖 Worker。**
- `await dispose()`：释放所有本实例资源并结束 adapter；后续补全须重新构造。UI 不确定最近 ID 时可使用这一方式。注释/字符串压制请求也释放旧闲置 Worker。
- terminate 失败时返回 `worker-release-failed`，cancel/dispose 拒绝且 adapter 封闭；调用方不能忽略失败后启动全编译。
- 默认 15 秒超时会终止 Worker。UI 仍需防抖、IME/光标/草稿/标签/只读快照门禁，并再次核对全部结果身份；建议先试 250–350ms，设备实测后调整。

## 已测范围与明确限制

真实样例覆盖 C11/C++17 变量/函数、`.`/`->`/`::`、class/struct、vector/string、内部/外部 private/protected、遮蔽、重载、普通 const 方法、未完成/错误前缀、Unicode、driver/user.inc、注释/字符串压制、光标在 token 中间、合法 `Pattern` 名称和字符字面量后的成员。错误前缀可能 native exit 1 仍给真实候选，候选和诊断一起返回；无候选且 native 非零返回 failed。

只过滤原生 `(Hidden)` / `(Inaccessible)`；合法 `(InBase)` 保留。CLI 没有 AST cursor kind、排序优先级或完整可用性信息，所以所有 item.kind 为 `unknown`，保留原生顺序与每条重载签名。insertText 只有真实名称，detail 展示原生 chunk 的可读签名，不插入 `<#...#>`、多行模式或自动参数模板。最多 200 项，截断时 isIncomplete=true；原生输出总量限 1 MiB，超限受控失败。

**完整 const/模板/属性可调用性不支持。** 普通 const Node 不含 mutate，const vector 不含 push_back/clear；但固定 Clang8 对 const std::string 仍输出 append/assign/insert/replace 等部分非 const 成员函数模板，无 Inaccessible/availability 标记；unavailable/deprecated 属性也可无标记返回。最小反例：

```cpp
#include <string>
void f() { const std::string s; s.ap/*光标*/; }
```

初次“必须无 append”的实际测试失败和原始 stdout 保留；后续测试专门断言这一已知缺口仍可重现，不将它算作 const 过滤通过。不按名字黑名单伪修，不承诺候选均可调用或 VS 完整语言服务。类型别名/函数模板、更复杂 receiver、宏补全、模板参数片段、全语言库覆盖不建立完整支持结论；CLI 模式和 OVERLOAD 提示不作为声明候选。1 号已接受按这个真实边界收口，并交 5 号独立确认反例。

## 复现与证据

```powershell
node --test compiler/checks/*.test.mjs
node compiler/experiments/completion-2026-10-29/probe-native.mjs
node compiler/experiments/completion-2026-10-29/measure.mjs
node compiler/experiments/completion-2026-10-29/verify-provider.mjs
```

后三个脚本每次生成新目录，旧失败不覆盖。索引见 [证据说明](evidence/completion-2026-10-29/README.md)。最终 `check`、契约10项、编译模块45项均通过；其中已知原生缺口的断言是范围记录，不是修复成功。30例 production engine + Node Worker 请求/原始参数/返回/取消证据和独立3进程30次性能样本均已保存。

性能实验小成员暖中位15.935ms，vector162.890ms，string148.883ms；冷资源读取/校验/Module编译中位76.083ms，首次小成员加加载中位138.748ms。该实验不含 UI/Worker调度、首次下载、冷OS缓存；不是 iPad 性能保证。线性内存仅阶段结束值，不是 RSS/峰值。新完整包停服重开补全、真实浏览器交互和 iPad 键触/性能仍待1/4/5与用户验收。
