# 2 号：离线编译工具链

已交付可运行的编译器实验：**Wasm 版 Clang/LLD 在本机将新 C11/C++17 源码编译链接为 Wasm，保留 O0 / DWARF 4**。已合入 1 号集成分支并与 3 号真实调试器对接，联合入口为根目录的 `npm.cmd run demo:integration`。iPad 与完整产品离线包仍待验收，详见 docs/architecture/INTEGRATION-2026-10-25.md。

这份交付从 `baseline-v0.1.0` 开始，所有实现位于 `compiler/`。编译 Worker 不使用开发电脑原生 clang，不调用服务器编译 API；本地服务器只负责首次提供静态资源。

## 获取与运行

要求开发电脑 Node.js 22+。没有第三方 npm 依赖。在本工作区根执行：

```powershell
node compiler/scripts/prepare-toolchain.mjs
node compiler/scripts/prepare-toolchain.mjs --verify-only
node --test compiler/checks/*.test.mjs
npm.cmd run check
npm.cmd test
```

只有首次获取缺少的资源需要网络。固定 URL、SHA-256、大小和来源在 `resources/toolchain.lock.json`；获取说明与许可缺口在 `resources/README.md`、`resources/LICENSES.md`。11 项上游资源合计 60,412,435 字节。四个大二进制不进 Git，新 checkout 先执行获取脚本。

编译自己的单文件，输出目录必须尚不存在：

```powershell
node compiler/scripts/compile.mjs compiler/samples/debug-handoff.cpp artifacts/my-new-build
# 可选第三参数为 stdin 文件；此时额外执行一次有界的输入输出检查。
node compiler/scripts/compile.mjs compiler/samples/c-stdio.c artifacts/my-c-build input.txt
```

输出为 `snapshot.json`、`evidence.json`，成功另含真实 `main.o`、`main.wasm`。失败不生成可启动构建；CLI 拒绝复用目录以防把旧产物误认为新结果。测试生成的实物放在 `artifacts/compiler-02/`，可随时重现。

## 浏览器离线编译实验

```powershell
node compiler/scripts/build-probe.mjs
node compiler/scripts/serve-probe.mjs
```

打开 `http://127.0.0.1:4172/compiler/probe.html`，点击准备资源。需要 HTTPS 或 localhost 的安全上下文，不能通过 `file://` 使用。`COMPILER_PROBE_PORT` 可更改开发端口。

生成器用实际字节生成 `service-worker.js` 和 `probe-package.json`。修改源码或新 checkout 后需重新生成。首次缓存完成前不显示就绪；缓存读取和再次准备均验证完整性，缺失/损坏时拒绝，联网明确重新准备可修复。Service Worker 仅覆盖 `/compiler/`，不接管应用根入口。浏览器默认缓存可能被清理，就绪状态只代表当前编译资源校验结果。

准备后关闭页、停止服务器，再重开同一 URL。修改唯一标记和计算数字，编译新源码并核对输出。桌面测试已按此执行；不能把它计为 iPad G2。真实 iPad 操作见 `INTEGRATION.md`。

`probe.html` 是编译模块测试入口，包含最少的编辑、取消和导出按钮。输入输出检查使用 `wasm-host.mjs` 的测试辅助宿主；它不提供断点、单步、变量、栈或生产运行时能力。该宿主缺少时钟/poll 等功能，不能接替 `debugger/`。

## 模块 API 与身份

- `src/source.mjs`：规范化快照、源码与文件 SHA-256，匹配共享固定向量。BOM/CRLF 规范化；所有 driver/generated 文件均入 hash。
- `src/compiler-probe.mjs`：`CompilerProbe.compile(request, {smokeStdin?})` / `cancel(requestId)`。成功为 **`status: compiled`** 的 `CompilerArtifactEvidence`，没有 buildId/profile；失败或取消为明确终态。每次新建可终止 Worker，最多一个活动请求，默认编译总期限 120 秒，源码总量上限 1 MiB。
- `src/node-probe.mjs`：`createNodeProbe()`；浏览器直接 `new CompilerProbe()`。
- `src/compiler-adapter.mjs`：`CompilerAdapter({profile, lock, writeResource, createWorker?})`。由宿主注入可信兼容组合，持久化并生成契约 `CompileResult.succeeded/BuildManifest`。1 号 `app/integration/` 已用实际资源生成开发候选，直接将真实构建交给 WorkerDebuggerAdapter 验证；正式产品组合仍待 G2。

请求快照在入口复制。晚到、不同 request/source/snapshot/mode/language/target 的结果不可覆盖当前构建；产物大小/hash/路径和工具链身份在落盘前核验。取消实际终止 Worker；持久化期间取消只可能留下不可见的内容寻址孤立资源，不发布成功结果。上层仍需按最新 requestId 接收结果，并在生产启动前验证完整资源组合。

编译诊断保留成功警告、真实编译/链接错误；只有快照内路径可映射到源码。Clang UTF-8 字节列转换为协议要求的 1 起始 UTF-16 列，未知系统路径保留消息但不虚构源码位置。

## 当前固定候选与实测范围

- 工具链资源：`binji/wasm-clang` 固定提交 `648c4a89997a351eef75cdaec3ef5b89d4937dec`；真实版本查询为 Clang 8.0.1 / LLD 8.0.1。sysroot 含 libc++ 的 `std::__2` 布局。
- 编译器本身与用户产物都使用旧 `wasi_unstable`，目标 `wasm32-unknown-wasi`、小端、32 位地址。它不是现代 `wasi_snapshot_preview1` 组合，不能只改导入名即当作 ABI 已兼容。
- debug 使用 `-O0 -debug-info-kind=standalone -dwarf-version=4`，设置主文件名和绝对 `/project/...` 路径；保留类型、位置和行表。STL O0 另链 sysroot 自带 `libclang_rt.builtins-wasm32.a`。实际全部参数在 evidence 中。
- 栈 1 MiB、产物声明最大线性内存 256 MiB；这不是进程 RSS 或总内存上限。编译进程自身只有 Worker 隔离/超时，没有浏览器级硬内存配额。
- 实测 C11 scanf/printf、数组、有效指针、递归；C++17 结构化绑定、vector/string/sort/map/unordered_map/queue/priority_queue、空容器、长短字符串、signed/unsigned 64-bit 整数及 UTF-8 输出。
- 实测 `sizeof(int/long/void*) = 4`，与某些题站不同。`bits/stdc++.h` **不支持**，请分别包含 `<vector> <string> <algorithm> <map> <unordered_map> <queue> <iostream>` 等标准头。
- C++ 异常、RTTI、线程、完整标准库覆盖、STL 调试展开、监视表达式和 Safari/iPad 性能仍未验证。当前参数未启用 C++ 异常功能；普通编译运行通过不等于源码调试通过。

固定 blob 可以重复获取；上游二进制与完整源码/补丁/依赖的映射、sysroot 全部组件许可证尚未补齐，因此从源码可重现构建和正式分发许可完整性均未证明。路线不在本模块冻结。

交接细节见 `INTEGRATION.md`，本轮结果见 `docs/handoffs/02.md`。
