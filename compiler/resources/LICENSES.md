# 许可资源与已知缺口

本记录对应 `toolchain.lock.json` 的固定字节。它记录实际读到的一手声明以及缺少的证据，不把根仓库许可证推断成所有二进制和库的单一许可证。11 个资源均已固定完整 commit、URL、byteLength、SHA-256。

两份上游原始许可证随参考源码保留：

| 文件 | 来源范围与内容 | SHA-256 |
|---|---|---|
| `vendor/wasm-clang/LICENSE` | 上游 Apache-2.0 文本；四份 JS 文件各自文件头明确采用该许可 | `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` |
| `vendor/wasm-clang/LICENSE.llvm` | Apache-2.0 with LLVM exception、legacy University of Illinois/NCSA，以及第三方组件可能另有许可的说明 | `ebcd9bbf783a73d05c53ba4d586b8d5813dcdf3bbec50265860ccc885e606f47` |

它们分别来自同一 [固定提交的 LICENSE](https://github.com/binji/wasm-clang/blob/648c4a89997a351eef75cdaec3ef5b89d4937dec/LICENSE) 和 [LICENSE.llvm](https://github.com/binji/wasm-clang/blob/648c4a89997a351eef75cdaec3ef5b89d4937dec/LICENSE.llvm)。许可证与下载文件没有经过内容修改。

逐组件核查结果：

| 组件 | 当前证据 | 尚未解决 |
|---|---|---|
| `shared.js`、`shared_web.js`、`worker.js`、`d8.js` | 文件头均声明 Copyright 2020 WebAssembly Community Group participants / Apache-2.0；原始声明保留 | 项目派生宿主应继续保留归属并标明修改 |
| `clang` / `lld` | 仓库提供 LLVM 许可证及已固定二进制 | 二进制到源码/依赖的完整映射未提供；不可声明已完成所有嵌入第三方组件审计 |
| `memfs` | 仓库 README 指向 LLVM fork 中的实现 | 没有证明发布二进制对应哪个源码 commit，也未建立其中依赖的完整清单 |
| libc++ headers / `libc++.a` / `libc++abi.a` | sysroot 的 `include/c++/v1/vector` 文件头明确说明 MIT 与 University of Illinois 双许可 | tar 没有该头引用的 `LICENSE.TXT`；头文件声明不能自动确定静态库字节的完整来源/许可 |
| `include/ctre.hpp` | 文件开头内嵌 Apache-2.0 许可文本，原始头随 sysroot 保留 | 上游组件版本未锁定到源码发布记录 |
| libc / WASI libs、crt、compiler-rt builtins | tar 实际包含 `libc.a`、`crt1.o`、`libwasi-emulated-mman.a`、`libclang_rt.builtins-wasm32.a` 等 | 尚未建立准确 wasi-libc/musl、compiler-rt 源码版本、对应完整许可和额外通知 |
| canvas header / library | tar 包含 `include/canvas.h` 与 `libcanvas.a`；header 开头未见许可声明 | 不能仅据根 LICENSE 推断二进制完整许可范围，需要作者来源记录 |

对固定 `sysroot.tar` 执行 `tar -tf` 得到 445 条目录/文件记录；没有名为 LICENSE、COPYING 或 NOTICE（含常见扩展名）的条目。文件内部可能含许可文字，因此“没有独立许可证文件”不等于“所有组件无许可”。抽查原始归档成员的 SHA-256：

| 归档成员 | 字节数 | SHA-256 |
|---|---:|---|
| `include/c++/v1/vector` | 112555 | `478cae6126d9390c876610f8084a0679224a5f157c8fdea2a9e32b55c7ff0857` |
| `include/ctre.hpp` | 193676 | `9acc33e9636e78ec7d2144016979fb6c0a7cc833e7142f02eb48ae5374aab766` |
| `include/canvas.h` | 8869 | `149e2ec372f3fd830b97c5b7b0895b8e510bfdfc41cbe01731eb31a47e5d9127` |
| `lib/clang/8.0.1/lib/wasi/libclang_rt.builtins-wasm32.a` | 306420 | `2ba99e3ba78b512c1283dd2e5e3e3296e57a9427b047d16d5022ddd98f99abf9` |

本次没有获取 `vasm6502_oldstyle` 或其 `LICENSE.vasm`；本项目编译资源不依赖 6502 汇编器。没有将该仓库中另一个组件的许可当作本 C/C++ 工具链的许可。

**发布状态：许可审查未完成。** 要关闭这个缺口，需要建立实际二进制与每个 sysroot 组件的确切源码/版本对应，保留适用的许可与通知，或从已锁定且许可清楚的源码重建并替换资源。不能通过附上一份来自其他版本的 MIT/musl/LLVM 许可证宣称当前二进制已获完整覆盖。
