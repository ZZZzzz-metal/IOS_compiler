# 5 号：独立真实验收

本目录归 5 号，等待提交真实工具链/运行器的自动或半自动验收。独立状态入口：`node app/main.mjs validation`。

contracts/checks/ 是 1 号的协议不变量检查，不是产品端到端测试，也没有 iPad 验收效力。请在 fixtures/ 放真实 C/C++ 程序，在 docs/validation/ 放预期、环境、结果及证据。

第一轮关卡约定在 docs/architecture/GATES.md；5 号可以细化测试，但核心调试和完全离线条件不得删减。交付记录写 docs/handoffs/05.md。
