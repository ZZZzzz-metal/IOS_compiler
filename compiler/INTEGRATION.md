# 给 1 / 3 / 5 号的编译产物交接

本模块基于共同标签 `baseline-v0.1.0`（`59c7080ae44b27c45cb0f94639752b3adbb28649`），分支 `module/02-compiler`，工作区 `C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-debugger-02`。不需要第二个应用仓库或根依赖。共享文件修改建议在本文提出，由 1 号整合。

## 3 号可以立即读取的实物

运行 `node --test compiler/checks/real-toolchain.test.mjs`。生成：

| 目录（工作区根起） | 内容 |
| --- | --- |
| `artifacts/compiler-02/debug-handoff/` | 最小递归、函数调用、数组、指针、vector、短/长 string 的真实 `.o/.wasm`、快照与证据 |
| `artifacts/compiler-02/c-stdio/` | C11 输入输出/递归/指针/数组样例及实物 |
| `artifacts/compiler-02/stl/` | 要求内 STL 的真实编译与运行输出；不是变量展示验证 |
| `artifacts/compiler-02/compile-error/` | 中文路径、中文/emoji 源码后的真实错误及 UTF-16 定位 |
| `artifacts/compiler-02/versions.json` | 真正执行 clang/lld Wasm `--version` 的输出 |

每份成功 evidence 指向相同的源码快照、SHA-256、compiler/linker 参数、目标 ABI、导入列表和实际调试段。调试段嵌入 `main.wasm`，无需另找 source map。没有源码改写，因此 `sourceMappings=[]`；DWARF 用户源位于 `/project/<snapshot.path>`。主 CU 使用明确主文件名，避免 cc1 产生 `<stdin>` 或重复 `project/project` 路径。

该编译候选的导入名是 **`wasi_unstable`**。生产 runtime/debugger 若只支持新的 WASI 或不同 Wasm DWARF 地址模型，需要真实适配/换编译候选并重新跑样例；不能只凭 `.wasm`、DWARF 4 或 hash 一致认定可调试。

`samples/debug-handoff.cpp` 建议逐项验证：第 5 行 `result`，第 11 行递归 `current/index`，第 21 行 main 的 `array/pointer/values/shortText/longText`。断点实际绑定与三种单步由 3/5 用真实引擎给出；本文没有预填通过结果。STL ABI 是旧 libc++ `std::__2`，格式化器应以实际布局为准。

## 完整 CompileResult 的接入条件

当前 `CompilerProbe` 交付 `status: compiled`，明确属于编译证据。`CompilerAdapter` 构造时要求完整可信 `CompatibilityProfile`，缺任意 runtime/debugger 组件即拒绝。通过构造并不证明组合可运行，仍须走共享启动门禁与真实调试验收。

由 1/3 提供并确认：真实 runtime/debugger 资源、精确版本及 buildHash、支持的 ABI/特性、DWARF 解释/变量格式化方式、完整资源清单的 `resourceManifestHash`。compiler/linker 的 buildHash 分别取锁文件对应 blob 的 SHA-256（加 `sha256:`）；sysroot/standardLibrary 都取包含头文件及静态库的 sysroot.tar blob hash。`version` 需写明 Clang/LLD 8.0.1 与锁定 blob 标识，不能只用 latest。

适配器的 `writeResource(relativePath, Uint8Array)` 由集成层提供，按内容寻址持久化；启动层按同一个 relativePath 读取真实字节。持久化失败编译返回 failed。取消与新请求的界面接收仍需最新 requestId 防护。调试构建 `debugInfo=[executable]`，运行构建 `debugInfo=[]`。

## 建议给 1 号的具体共享修订

1. 先将本分支的 compiler/ 与 docs/handoffs/02.md 集成。根依赖与锁文件无新增包；根检查入口暂不连接本模块，避免未完成的完整产品显示就绪。
2. 3 号用同一真实产物完成启动、断点、三种单步、局部值/递归栈与停止，5 号独立复测后，再发布真实 `compatibility-profiles.json` 条目与资源组合。保持 `contracts/offline-bundle.json` 未就绪直至全角色资源完成。
3. 只在 `contracts/capabilities.json` 记录精确证据范围。当前证据不能用于 iPad、调试变量、调用栈或产品安装通过声明。根 app compiler 状态入口仍显示基线 not-implemented 属于等待 1 号集成，非编译实验不能运行。
4. 对编译器来源和 sysroot 组件进行许可补全；如难以补全，以可准确源码构建的新版候选替换。相关记录见 resources/LICENSES.md。本轮没有任何发布/上传。

## iPad 逐步操作（待实测）

前提：1 号提供可信 HTTPS 安装入口或合适宿主，装入本模块全部文件及 3 号的真实调试器。开发电脑的 `127.0.0.1` 是本机验证地址，不能直接在 iPad 访问；不能要求用户保持电脑服务器运行来满足日常离线。

1. 首次联网准备完整编译资源，记录设备/iPadOS、入口形态、资源版本和 hash。只有编译资源准备完成不算全产品离线就绪。
2. 关闭应用/页面，断开 Wi-Fi/蜂窝网络并关闭辅助电脑，再从已准备的入口重开。确认资源逐项校验成功。
3. 粘贴 C++17 样例，修改函数内数字和唯一注释，使之成为此前未编译的新源码。执行编译，导出快照、evidence 和 main.wasm，核对 sourceHash 与输出。
4. 3 号在同一 iPad 内加载实际产物，绑定用户函数断点并查看真实变量。单步进入/跳过/跳出、切换递归调用者帧，检查数组、指针、空/非空 vector、短/长 string。结果未知时记录待验证，不用输入输出检查代替。
5. 修改代码再编译，确认旧会话不可继续作为新源码调试；运行错误源码后再编译正常源码；取消编译后再次编译。停止死循环及调试暂停预算由 3 号验证。
6. 用 C11 样例重复。记录首次资源字节、资源准备/冷启动/后续编译耗时、可观测内存以及 Safari 存储清理/后台行为。

设备未接入；以上步骤尚未执行。G1 的源码调试联调、G2 真机和 G3 产品集成均不在本轮标记通过。

## 后续替换候选备忘

只读调研发现 [wasm-llvm producer](https://github.com/seo-rii/wasm-llvm/tree/main/producer/clang-browser)、[wasm-idle llvm-core](https://github.com/hatemhosny/wasm-idle/tree/main/packages/llvm-core) 和 [live-codes/clang-wasm](https://github.com/live-codes/clang-wasm/tree/main/packages/clang-wasm)。它们值得在旧 ABI/DWARF 或来源补全受阻时最小验证；本轮没有下载执行，也没有据此保证 iPad 支持。先让 3 号验证当前真实产物，再决定替换组合。
