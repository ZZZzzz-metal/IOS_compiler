# 3 号：执行与源码级调试

已实现可运行的**真实 Wasm 源码调试原型**：浏览器解释 Clang/LLD 产物，解析嵌入 DWARF，并控制暂停中的实际机器状态。普通运行和调试使用同一执行器；不需要外部 LLDB 或远程计算。真实 iPad、安装包和完整产品仍待验收。

所有实现位于 debugger/，始于 baseline-v0.1.0，来源分支 module/03-debugger。已合入 integration；根入口、共享状态和实际 CompilerAdapter 联合验证见 docs/architecture/INTEGRATION-2026-10-25.md。

## 复现检查

Node.js 22+，没有新增 npm 包。在本工作区根执行：

```powershell
node --test debugger/checks/*.test.mjs
npm.cmd run check
npm.cmd test
```

真实样例保存在 fixtures/：每份包含 main.wasm、snapshot.json、evidence.json。测试验证实际指令、输出、最终内存与原生 Wasm 的对照，源码断点、三种单步、递归帧、容器、输入输出、旧引用失效和 Worker 隔离。故障注入与实际程序测试明确区分。原始输出见 evidence/desktop-node-2026-10-24.tap；独立适配器检查见 VALIDATION.md。

重建样例使用同仓库已准备的 2 号工具链：

```powershell
node debugger/scripts/prepare-fixtures.mjs
```

前三份复制2号已生成的真实产物，其余调用2号固定 Wasm 编译器。没有创建第二套编译器。

## 浏览器联合实验

需要同仓库 compiler/ 的已校验工具链资源。脚本通过 /debugger/compiler/ 提供静态别名，不再依赖兄弟工作区。

```powershell
node debugger/scripts/build-probe.mjs
node debugger/scripts/serve-probe.mjs
```

打开 http://127.0.0.1:4173/debugger/probe.html，先准备资源，再运行验证。约60.6 MB实验资源由仅作用于 /debugger/ 的 Service Worker 缓存、逐项SHA-256校验。每次验证给源码追加不同唯一注释，在浏览器内真正编译 C++、C 和死循环，执行断点、数组/指针/string/vector、三种单步、递归调用者帧、stdin/stdout/stderr、停止和重新启动。原始事件与源码快照在页面展示。

准备后关闭页面、停止服务器，再打开同一URL，修改代码中的唯一标记后重跑。计算不经过静态服务器。开发机localhost不能直接用于iPad；1号需提供真实设备可用的HTTPS或安装入口。缓存就绪不是完整产品离线就绪，也不保证浏览器存储不会被系统清理。缓存损坏显式失败；发行级修复和更新仍由集成层统一实现。

## API

- src/debugger-adapter.mjs：new DebuggerAdapter({profile, resources, readResource, sliceInstructions?, now?, schedule?})，提供协议 command/query/resync/subscribe。profile须预先信任，resources必须是该 profile.resourceManifestHash 绑定的完整资源表；联合候选同时传入编译与调试资源，不能从构建自报身份建立信任。
- src/worker-adapter.mjs：浏览器使用 new WorkerDebuggerAdapter({profile, resources, baseURL, createWorker?, stopTimeoutMs?})。baseURL指向虚拟项目根。新编译产物可通过 registerResource(path, Uint8Array) 交入隔离Worker，启动仍核验实际字节。Stop默认500ms看门狗会实际终止失去响应的Worker；这不是iPad实测时延。
- src/debugger-worker.mjs、worker-bridge.mjs：浏览器传输；node-worker.mjs仅供开发验证。Worker重建后宿主仍保留旧sessionId和ACK历史。
- src/wasm-runtime.mjs：真实Wasm指令、PC、局部值、操作数栈、递归帧和线性内存。指令块有界、让出事件循环；生产接入使用Worker包装层。
- src/dwarf.mjs、variables.mjs：DWARF4行表、类型、范围和位置表达式；读取实际标量、数组、指针、结构体，以及经DWARF成员布局检查的固定libc++ std::__2 string/vector。
- src/integrity.mjs：浏览器版共享身份与资源算法。snapshot/content/source hash、profile、ABI/feature、资源清单和实际字节不一致均拒绝启动。
- scripts/candidate.mjs：从真实组件和样例证据生成开发候选，不注册共享兼容组合，不证明完整应用资源包已验证。

先订阅再start。初始断点先于运行完成绑定；控制只接受当前pauseId，暂停创建新身份。stack得到本次暂停的frameId，再用于scopes/variables/evaluate。继续、单步、resync、终止撤销旧句柄。ACK不是状态快照；前端还需实现事件缺口检测和resync，不能恢复旧pauseId。

宿主将visibilitychange/pagehide接到background()/dispose()。后台通知终止计算，不假装自动恢复；系统未通知就杀页、Safari后台和内存压力仍需真机验证。

## 已知边界

- 固定 wasm32-unknown-wasi / wasi_unstable、小端32位地址、O0、嵌入DWARF4；int/long/pointer均4字节。支持候选声明的MVP和mutable-globals；线程、SIMD、Wasm异常及其他新提案明确不支持。
- 有界批量stdin、stdout/stderr及有限args/environ/clock/random；没有任意文件系统、网络或交互stdin，未知WASI能力返回不支持。
- 默认最大线性内存256MiB，可配置更低；最多4096个Wasm帧。这不是浏览器总内存/RSS保证。stdin最多1MiB，输出限额最多8MiB。单次WASI I/O最多1MiB、回调块最多64KiB，避免单条导入挤占控制。
- 单步依真实行表并跳过不可读参数的序言；不保证一行多表达式的列级体验。空白行或声明断点可移到后续真实行，requested/actual分开报告。
- 旧Clang存在缺失frame-base的位置模式，仅按固定producer及实际Wasm序言恢复每个递归帧保存的local基址，不猜当前SP。初始化记录不足、未知表达式或布局显式unavailable/unsupported。
- 内存变量的初始化记录绑定本次声明的实际执行，循环复用同一栈槽时不认可上一轮写入。子调用及WASI写入保留真实时序，数组/成员引用携带同一声明身份；观察记录不修改程序内存。最多注册16384个声明指令，每个相关帧最多保留2048个写入区间，记录不足时明确unavailable。无法确认声明位置或已开始执行后才安装观察记录，也不借用旧生命周期的数据。
- 变量每页最多100项，字符串显示最多1024字节，截断显式标记；空指针/越界受控失败，不承诺识别全部C/C++悬空指针。DWARF5/64、位域和复杂位置表达式不支持。
- 基础监视支持标识符、成员、索引、有效指针、括号及测试过的无副作用整数运算。逻辑短路不读取未求值分支；保留整数位宽、无符号环绕，有符号溢出显式拒绝。调用、赋值、自增、强制类型转换和完整C++表达式不支持。
- 输出增量UTF-8解码，限额切断多字节字符时丢弃不完整尾部，保留真实退出码/trap/停止原因。运行预算不计算人工暂停。

一手参考：[Wasm执行规范](https://webassembly.github.io/spec/core/exec/instructions.html)、[DWARF4](https://dwarfstd.org/doc/DWARF4.pdf)、[DWARF for WebAssembly](https://yurydelendik.github.io/webassembly-dwarf/)。本模块未复制第三方运行时；样例链接的libc/libc++仍承接2号记录的许可和二进制来源缺口，正式分发前需补齐。

接入与真机操作见 INTEGRATION.md；交付见 docs/handoffs/03.md。路线须经5号独立复测及G2真机关卡后由1号冻结。
