# 5 号独立验收

开发电脑 Node.js 22+，无需npm安装。首轮使用同仓库2/3号工作区内已准备的真实工具链和调试原型；所有独立源码来自本模块fixtures。执行与查询不注入预录事件。

```powershell
node tests/run-module-regressions.mjs
node tests/run-validation.mjs
node tests/reproduce.mjs shadow
node tests/reproduce.mjs loop-header
npm.cmd run check
npm.cmd test
```

默认来源是同级ipad-debugger-02与ipad-debugger-03。可设置 `VALIDATION_COMPILER_ROOT`、`VALIDATION_DEBUGGER_ROOT` 为各自仓库根的绝对路径；合并后可均指向集成工作区。固定工具链资源及3号candidate基准产物若缺失，按2/3号说明准备；测试不自动联网更新。

主套件21组检查保留源码快照、产物hash、所有控制/查询/事件及环境。当前20通过、1失败；两条最小复现均失败。已知缺陷保留真实非零退出码，不将失败改成预期成功。

模块回归包含故障注入，不能把其总数量称为产品端到端测试。实际编译产物在忽略目录artifacts/validation-05/，机器可读证据在tests/evidence/。报告见docs/validation/desktop-2026-10-25.md。

真实iPad离线、键鼠、草稿和客户端迟到响应过滤仍需真机/集成验收。当前Node结果未覆盖浏览器UI，也未断开开发电脑系统网络。
