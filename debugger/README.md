# 3 号：执行与源码级调试

所有权：debugger/ 及执行资源。当前尚未实现。

共同标签 baseline-v0.1.0，接口为 contracts/protocol.d.ts 中 DebuggerAdapter。独立状态入口：`node app/main.mjs debugger`，不产生编造的会话事件。

与 2 号验证同一真实产物：断点绑定、继续、stepInto/stepOver/stepOut、栈帧、局部变量、数组/指针/string/vector、停止与重启。必须有 iPad 内可运行的完整调试客户端；外部 LLDB/桌面 DevTools 不符合日常离线条件。

严格遵守 session/build/source/pause/frame 的身份与失效规则，先按 contracts/README.md 约定通信。资源和变量求值边界单列，普通运行与调试引擎若不同需核对同一程序。共享改动建议交 1 号。交付记录写 docs/handoffs/03.md。
