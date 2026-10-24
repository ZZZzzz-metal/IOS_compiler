# 2 号实际验证证据

`desktop-2026-10-24.json` 来自 `compiler/checks/real-toolchain.test.mjs` 实际运行输出，包含 C11、STL、最小调试交接样例、编译/链接错误、bits 兼容失败和取消结果，以及真正执行的版本查询。原始完整快照、`.o/.wasm` 与 evidence 位于工作区 `artifacts/compiler-02/`，通过相同测试可重新生成。取消用的大数组源码不进入 Git。

`browser-offline-2026-10-24.json` / `.jpg` 来自 Windows 的 Codex 内置浏览器。先缓存全部固定资源，停止本轮 `127.0.0.1:4176` 服务器，curl 确认连接失败，关闭页面、重开后重新校验缓存，再输入此前未编译过的 C++ 源码与 stdin，真实 Worker 编译并执行输出。未关闭整个浏览器进程，也未切断系统网络；本地资源服务器不可访问以及缓存只读供给是本次离线资源验证的边界。

此浏览器记录不是 Safari/iPad 结果。首次资源准备耗时、完整浏览器进程冷启动、设备内存峰值均未测。`loadMs` 是 Worker 内读资源/校验/编译 Wasm 工具模块耗时；`compileMs/linkMs` 是对应工具的实例化与执行耗时；`totalMs` 从初始化本次虚拟文件系统起，包含编译、链接与产物检查，**不包含 loadMs、Worker 启动或 UI 等待**。观测内存只记录各阶段完成后的线性内存大小，不能相加当作 RSS 或峰值。

`adapter-lifecycle`、`service-worker-cache`、`worker-startup` 等测试使用故障注入，仅验证身份/状态与缓存约束。它们不会产生已工作的生产调试组合，也不能算真机验收证据。
