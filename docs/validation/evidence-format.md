# 验收证据规范

每轮记录环境、基线、实际步骤、预期、实际、状态、最小复现与依赖。Node、桌面浏览器、真实iPad分别记录。文件名日期按Asia/Shanghai；JSON时间用ISO UTC。

最小关联链：源码全文与snapshotId/sourceHash → 编译requestId/版本/参数 → buildId/产物hash → sessionId/compatibilityId → eventSeq/pauseId/frameId → 原始query/reply。截图仅旁证，必须能追溯具体源码与真实事件。

本轮independent-2026-10-25.json保存环境、2/3号精确提交、候选资源表、各检查状态、真实源码/编译结果、所有控制/查询/事件和测量值。候选resourceManifestHash只覆盖3号模块资源，不证明全应用离线包。

regression-shadow.json与regression-loop-header.json保存最小失败程序、产物hash、暂停/局部值/表达式结果。修复复测另存新轮次，保留原失败。主套件TAP是状态摘要；module-02.tap、module-03.tap及module-regressions.json记录原模块命令、退出码与TAP。

大产物位于忽略目录artifacts/validation-05/，由固定源码与工具链可重建；证据保留SHA-256核对。未执行的阶段不得填通过，未知环境字段保留缺失原因。

调用耗时包含本轮Worker/加载开销；模块compile/link/total是不同区间。阶段线性内存不是峰值、RSS或设备总内存。Node计时器响应不代表iPad UI响应。真实暂停计时与注入时钟测试分开记录。

归档时计算各证据文件SHA-256。只保存验证需要的源码与日志，不包含无关账号或草稿。真实事件不能替代安装、完整离线、系统后台或草稿的实测。
