# 候选路线与选型证据

日期：2026-10-24。负责人：上下文 1；本文件属于架构基线。

**路线未冻结。当前没有真实 iPad 离线编译与源码调试证据，也没有已安装产品。** 本文记录一手资料与待验证组合，不把第三方项目的功能说明视为本项目验收结果。能力声明以 `contracts/capabilities.json` 为唯一来源；只有 `GATES.md` 的 G2 真机关卡通过后，才确定产品形态与兼容组合。

## 判断依据与共同要求

- **已知**：下文链接的一手文档或项目明确说明的能力及限制。
- **推论**：根据这些组件提出的组合与工程方案，尚未证明组件连用可行。
- **未测**：本项目尚未执行的验证，尤其是真实 iPad、离线冷启动、编译性能与调试正确性。

每条候选必须在同一台 iPad 内完成：新源码 → 真实编译链接 → 可运行产物 → 可暂停的真实运行时 → 调试信息解释 → 当前会话的断点、三种单步、变量与调用栈。外部电脑上的 LLDB、桌面浏览器开发者工具、远程编译服务器不属于此闭环。

首轮以单文件、带 `main` 的 C11/C++17 为待验证目标，调试构建先采用 O0 并保留完整类型和位置调试信息。普通 C 库、C++ 标准库、string/vector、输入输出及基础监视表达式分别验收。Wasm 路线以 WASI 目标为候选；最终目标名称、ABI、Wasm 特性、异常模型、DWARF 版本和编译参数必须由 2/3 号一起固定，不凭文件扩展名判断兼容。

## 三条完整候选

| 路线 | 候选完整组合 | 已有依据 | 首要未知与取舍 |
| --- | --- | --- | --- |
| A：Web/PWA | 浏览器版 Clang/LLD + 固定 WASI sysroot/标准库 → Wasm/DWARF → 可控制执行的解释器，或真实 Wasm 调试插桩 → 本地 DWARF/变量/栈解析 → 应用界面 | 浏览器编译工具链已有演示；浏览器内真实交互调试已有研究原型 | 仍需可嵌入的完整调试后端；iPad 上暂停恢复、三种单步、STL、离线资源与内存均未测 |
| B：原生 iPad App | 内置编译器与链接器 + WASI 库 → Wasm/DWARF → WAMR 或 WasmKit → 同机嵌入调试客户端/符号引擎 → 原生界面 | WAMR 提供解释器调试及嵌入接口；WasmKit 提供运行时与 GDB 协议模块 | 编译器、运行时和调试客户端必须全部在 App 内；iPad 移植、资源、签名与分发条件未确认 |
| C：完整 Linux 模拟环境 | v86 浏览器模拟器，或 UTM SE 原生模拟器 → 本地 Linux 镜像 → GCC/G++ + GDB/MI + 匹配的 STL 格式化器 → 终端验证/后续界面桥接 | 完整系统模拟、Linux、GDB/MI 和 STL 格式化分别有现成依据 | 组合运行、客户机调试机制、控制桥、镜像大小、启动/编译速度及 iPad 内存未测；可用作独立对照 |

这三条是待验证的组合，不是三个已经可用的产品。A/B 内部的具体组件仍可替换；C 的两种安装形态也不能互相代替验收。

## A：Web/PWA 的证据和缺口

**已知：** [wasm-clang](https://github.com/binji/wasm-clang) 包含编译成 Wasm 的 Clang、LLD、C++ 头文件/库、Worker 与 Service Worker。作者将其定位为实验性演示；仓库存在不代表其工具链版本、完整 C++17 或 iPad 性能满足本项目。

**已知：** [Emscripten 调试文档](https://emscripten.org/docs/porting/Debugging.html) 区分 DWARF 与 source map。文档所述 DWARF 浏览器调试使用 Chrome 扩展；source map 主要映射位置，不能轻易据此检查变量。因此，“能输出 DWARF”“桌面 Chrome 能断点”都没有回答我们的 iPad 应用如何控制执行和读取实际状态。

**推论：** A 有两种值得验证的调试后端形态：

1. 把可控制执行的 Wasm 解释器与符号解释器放进应用，解释器公开真实指令位置、调用栈、局部值和内存，并执行暂停/继续/单步控制。将 WAMR 等移入浏览器仍需移植与验证，不能直接照搬其原生 TCP 调试示例。
2. 对真实编译出的 Wasm 进行调试插桩，在可执行源码位置设置可暂停探针并保存实际机器状态，用 DWARF 重建变量和调用栈。它只有在真正暂停当前计算、保留正确执行语义并能继续时，才可算调试；执行日志或事后动画不满足要求。

**已知但范围有限：** [2026 年 Stanford 项目论文](https://www.scs.stanford.edu/26wi-cs244c/proj/wasm_dbg.pdf) 报告了浏览器编译、Wasm 插桩和 DWARF 变量重建的原型。实验是 MacBook M4 Pro、Chrome 145 上的四个 C benchmark；论文承认旧 wasm-clang 的变量定位问题，报告调试态约 17–43 倍执行开销。它不证明 iPad、C++17、string/vector 或全部单步能力通过；也不应照搬论文对其他路线不可行的概括。

**未测：** 当前真实 Safari/主屏幕 Web App 对选定后端的兼容性、Worker 控制和死循环终止、可能使用的共享内存/隔离头、后台恢复、首次资源准备与离线冷启动。若选用共享内存或特殊响应头，应逐项确认，不能依赖开发服务器偶然提供的配置。

离线资源与草稿要区别管理。[WebKit 存储政策](https://webkit.org/blog/14403/updates-to-storage-policy/) 说明默认存储属于 best-effort，可能因存储压力等原因被清理；可申请持久存储，但是否授予取决于启发式规则。工程方案是完整资源清单、哈希校验、版本原子切换、存储失败反馈和草稿导出；不能将浏览器缓存当永久保存保证。详见 `OFFLINE.md`。

## B：原生 iPad 的证据和缺口

**已知：** [LLDB 官方 Wasm 文档](https://lldb.llvm.org/resources/wasm-testing.html) 描述的链路是：独立 Wasm runtime 执行产物并提供 GDB remote stub，LLDB 客户端连接它。文档示范 WAMR 与 WasmKit；没有证明这个 LLDB 客户端已作为 iPad App 组件工作。

**已知：** [WAMR 解释器调试文档](https://github.com/wasm-micro-runtime/wasm-micro-runtime/blob/main/doc/source_debugging_interpreter.md) 提供 `WAMR_BUILD_DEBUG_INTERP` 和嵌入调试实例接口，示例仍由 LLDB 连接；Wasm 多线程模块调试不受支持。该文档还包含定制 LLVM 13 LLDB 补丁流程，与最新 LLDB 文档不能未经验证混配。

**已知：** [WasmKit 项目](https://github.com/swiftwasm/WasmKit) 列出 iOS 18+ 为应可工作的目标平台，并提供 GDB 协议模块；其持续测试平台列表未包含 iOS。运行时可移植性与调试协议存在是研究起点，不是目标设备的完整调试证据。

**推论：** 编译器可探索内嵌原生组件或运行 Wasm 版工具链，用户产物在解释器中执行。调试客户端可探索同进程嵌入或同设备内部通信；必须证明能解析 DWARF、求变量地址并控制运行时。若仍需要外部 LLDB 才能调试，该原型只通过桌面机制检查，不通过本机闭环。

**约束：** 不以“把新编译的 ARM64 文件作为普通 iPad 进程直接启动”或未确认的 JIT 权限作为基线前提。Apple 的[运行时安全说明](https://support.apple.com/guide/security/security-of-runtime-process-sec15bfe098e/web) 描述沙箱、entitlement 和可写可执行内存限制。解释执行用户 Wasm 是候选工程选择，不表示免除 App 的签名或分发要求，也不表示所有解释器方案已获批准。

**未测：** iPad 端编译器与 LLDB/等价符号客户端的构建、链接、体积、内存及功能；解释器调试状态访问；libc++ 布局与格式化；C++ 异常及标准库兼容；App 后台恢复与停止执行。首版候选优先单线程，能力范围仍以统一能力表为准。

### 原生构建、签名、安装与更新条件

- 需确认可用的 Apple 构建与签名环境、相应 SDK、开发者账户、设备与分发方式。常见实现路径为 macOS/Xcode 环境；本项目没有确认这些条件已经具备。构建阶段可用电脑或构建服务，但日常编译调试不得依赖它们运行。
- [Apple 开发者账户说明](https://developer.apple.com/help/account/basics/about-your-developer-account) 指出免费 Personal Team 的设备安装配置文件七天到期，需要重新构建安装。它可用于短期验证，不能承诺永久离线可用。
- [TestFlight 官方说明](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/) 规定构建最多测试九十天；它是阶段验证渠道，需要后续构建更新。
- [Apple 配置文件更新说明](https://developer.apple.com/help/account/provisioning-profiles/provisioning-profile-updates/) 指出部分开发/Ad Hoc 签名应用首次启动需要联网进行 PPQ 校验，并列出离线配置文件与长期离线的额外条件。须按实际账户及分发方式确认，不能统一承诺“签一次即可无限期离线”。首次安装联网符合当前工作假设，日常离线仍须实际验证。
- [App Review 2.5.2](https://developer.apple.com/app-store/review/guidelines/#software-requirements) 对教育类可执行代码设有有限例外，并要求相应源码可见、可编辑。该条款不能被解读为全面禁止本项目，也不是上架通过保证。
- 更新时应交付互相兼容的 App、工具链、库、调试器与格式化资源，记录版本及许可证，保护草稿和可导出内容。若使用会到期的测试渠道，必须记录有效期与更新操作；不能把本地构建或预览称为已安装交付。

## C：完整 Linux 模拟环境的证据和缺口

**已知：** [v86 官方仓库](https://github.com/copy/v86) 支持浏览器内 x86 模拟及包括 Alpine 在内的 32 位 Linux，提供串口 API 与保存/恢复状态示例。它不支持 64 位 Linux 内核。文档中的镜像网络加载方式不自动满足离线要求。

**推论：** 将 GCC/G++、GDB、Python、标准库及对应 pretty-printers 预装进本地客户机镜像，先通过终端运行，再探索串口上的 GDB/MI 控制桥。必须把镜像所需的全部块和运行资源下载完成；按需取远程镜像块的演示不能当作离线成品。Linux 支持不等于目标 iPad 上客户机 GDB、断点和性能已通过。

**已知：** [UTM 官方 iOS 安装文档](https://docs.getutm.app/installation/ios/) 说明 UTM SE 使用无 JIT 的解释式模拟，可从 App Store 安装，可运行 Alpine 等精简 Linux。它适合建立全部计算在 iPad 内完成的终端级对照；不是本项目已集成的安装包。普通 UTM 与 UTM SE 的运行、安装条件不同，记录中必须明确版本与形态。

**已知：** [GDB/MI 执行协议](https://sourceware.org/gdb/current/onlinedocs/gdb.html/GDB_002fMI-Program-Execution.html) 定义继续、step、next、finish、interrupt 等控制。[libstdc++ 调试文档](https://gcc.gnu.org/onlinedocs/libstdc++/manual/debug.html) 说明容器 pretty-printers 随 GCC 提供，依赖 Python 支持、正确安装及允许自动加载。不能省略这些资源后只凭 GDB 名称宣称 string/vector 可读。

**未测：** 选定客户机内 GCC/GDB 的实际运行、客户机进程调试机制、STL 展开、输入与调试命令隔离、死循环终止后重用、镜像持久化、编译速度与 iPad 内存压力。客户机位宽、C 库和性能可能与在线判题平台不同，必须明确记录。若终端原型通过而产品界面桥未完成，应分别记录，不合并成产品完成状态。

## 2/3 号联合验证建议顺序

1. **先确定一套可复现组合。** 2 号列出编译器/链接器、sysroot、标准库、参数、目标及 DWARF；3 号列出运行时、调试客户端、格式化器与通信方式。共同提交兼容组合和资源清单，标明各组件真正运行的位置。先排除仍依赖外部调试器的“闭环”。
2. **桌面检查真实机制。** 使用同一产物执行断点、三种单步、局部值、栈切换与停止死循环，保留原始调试事件和来源版本。此阶段只证明组合机制，不更新为 iPad 通过。
3. **尽早在真实 iPad 检查最难部分。** A 优先验证应用内暂停/恢复与变量读取；B 优先验证同机调试客户端及实际安装；C 优先验证客户机编译/GDB 与资源开销。若 A/B 的调试客户端短期无法闭环，C 可作为独立技术对照，不能自动降低产品要求。
4. **执行离线冷启动关卡。** 准备资源后关闭应用、断网、重新打开，粘贴此前未编译过的 C++ 程序；再以独立 C 程序重复核心流程。所有编译和调试计算均在 iPad 上，记录具体设备、iPadOS、安装形态和版本。
5. **验证真实数据与控制边界。** 包含标量、数组、指针、递归栈、短/长 string、空/非空 vector、元素修改与扩容；明确基础监视表达式范围。不支持或读不到的值须给原因。改源码重编译后，旧会话和暂停引用不得覆盖新结果。
6. **验证恢复与成本。** 停止死循环后立即再编译调试；调试暂停不消耗普通运行时间预算；记录冷启动、编译与单步耗时、存储大小及内存可观测情况。重启恢复草稿，复制/导出可用。没有测得的数据标为未测，不估算成事实。
7. **再决定路线。** 5 号独立复测 G2，1 号审核证据后冻结形态和兼容组合。缺少真实设备时交付可运行原型和操作单，状态保持待验证；不得以桌面结果、接口测试、按钮或 DWARF 文件代替真机关卡。

本文件只建立比较框架和研究依据，不提前指定胜出路线，不授权删除真正调试能力，也不改变各模块的目录所有权。
