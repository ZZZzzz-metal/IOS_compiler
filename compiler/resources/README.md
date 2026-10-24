# 固定资源获取与来源

本目录固定的是上游已经发布的字节，不是从源码重新构建的工具链。资源获取与 SHA-256 校验已在开发电脑完成；这不代表完整产品离线包、真实 iPad 运行或调试能力通过。

唯一版本来源为 `toolchain.lock.json`。上游为 [binji/wasm-clang 的固定提交](https://github.com/binji/wasm-clang/tree/648c4a89997a351eef75cdaec3ef5b89d4937dec)。11 项共 **60,412,435 字节**，其中四个二进制资源共 **60,347,928 字节**。`clang`、`lld`、`memfs` 是没有 `.wasm` 后缀的 Wasm 二进制；`sysroot.tar` 包含头文件和静态库。

在仓库根执行，要求 Node.js 22 或以上：

```powershell
# 仅下载缺少的固定版本资源；已有资源必须匹配锁定的大小和 SHA-256。
node compiler/scripts/prepare-toolchain.mjs

# 纯本地检查，不联网、不写入文件。
node compiler/scripts/prepare-toolchain.mjs --verify-only --json

# 显式重新获取损坏的资源。
node compiler/scripts/prepare-toolchain.mjs --repair
```

脚本从 `raw.githubusercontent.com` 的完整提交 URL 取资源，不跟随重定向；下载中限制大小，校验后才原子安装。网络失败或任何 hash 不符都会非零退出。下载权限由执行环境提供。离线设备需要事先随安装包或经宿主存储导入这些已校验资源；此脚本本身不是 iPad 的安装或缓存方案。

`vendor/wasm-clang/` 内 JS、README 与两份许可证原样保留。四个二进制由本目录 `.gitignore` 排除，版本记录不包含它们；新 checkout 必须先运行获取脚本。获取脚本不会改变锁文件，不会自动升级到上游 master。

主适配器可使用 `clang`、`lld`、`memfs`、`sysroot.tar`。`shared.js` 是上游宿主实现参考；它以普通脚本定义 `const API = (...)()`，并包含 MemFS、WASI App 与 tar 装载器。`worker.js`、`shared_web.js` 和 `d8.js` 是相关参考实现。直接使用上游 `API.compile` 会硬编码 `-O2`，不适合作为本项目的调试编译默认值；项目适配器负责自己的 `-O0` 和 DWARF 参数、UTF-8 与错误处理。

**来源重建仍未证明。** [上游 README](https://github.com/binji/wasm-clang/blob/648c4a89997a351eef75cdaec3ef5b89d4937dec/README.md) 指向 LLVM fork 和稀疏构建笔记。检查的笔记固定为 [gist revision c23ab21d67abad090e60533f1528eda34b99ef63](https://gist.github.com/binji/b7541f9740c21d7c6dac95cbc9ea6fca/c23ab21d67abad090e60533f1528eda34b99ef63)，命令引用 `wasi-sdk-5.0`、作者本地路径及若干手工修改；它没有绑定这四份二进制到完整源码提交、依赖、补丁与构建环境。

另检查了 [binji/llvm-project 的固定参考提交](https://github.com/binji/llvm-project/tree/5dc09c94393510bc8d042a9f07382b53e845c0f2/binji)，其中列出 `memfs.c`、`stb_sprintf.h`、Makefile 等。该引用只定位可研究的源码，**不能证明它就是当前 memfs 二进制的源码提交**。同理，sysroot 中路径 `lib/clang/8.0.1/` 只证明归档路径使用该版本名称，不能代替 clang 二进制的真实版本查询或所有库的来源证明。

许可覆盖缺口见 `LICENSES.md`。当前 `sourceRebuildVerified` 与 `distributionLicenseReviewComplete` 均为 `false`。只有固定 blob 的可重现获取与本地完整性检查已经成立。

开发电脑验证记录（2026-10-24，Windows / Node.js v24.19.0）：11 项大小与 SHA-256 全部通过；将 `d8.js` 暂时移开后，获取脚本成功从固定 URL 重获并与原始文件校验一致；将该文件改动一个字节且保持大小不变时，`--verify-only` 和默认获取模式均非零退出并报告 SHA-256 不符，随后恢复了原字节。网络首次请求出现过瞬时失败，脚本现仅对传输错误/超时做最多三次尝试；HTTP 失败、重定向、大小或 hash 不符不会被忽略。
