# 2 号：离线编译工具链

所有权：compiler/ 及其工具链资源。当前尚未实现；请勿把此说明当作可工作的编译器。

共同标签 baseline-v0.1.0，接口为 contracts/protocol.d.ts 中 CompilerAdapter。独立状态入口：`node app/main.mjs compiler`，只报告状态，无须联网。

第一轮交接必须包括：iPad 本机能执行的编译器/链接器/sysroot/标准库的固定组合；O0 调试构建；真实 BuildManifest、资源与 SHA-256、许可；C/C++ 与 STL 样例的实际结果；取消、失败后重编译。与 3 号共同确认 debugInfo 与 ABI，不能只提供开发电脑预编译的 Wasm。

资源建议放 compiler/resources/，大产物放忽略的 artifacts/，提交可重现的获取说明与固定版本清单。共享配置、锁文件和兼容表修改交由 1 号集成。交付记录写 docs/handoffs/02.md。
