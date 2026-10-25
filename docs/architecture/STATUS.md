# 集成状态表

更新：2026-10-25。产品能力唯一来源为 contracts/capabilities.json；下表只记录各模块交付与集成进度。当前是桌面开发原型，路线尚未冻结。

| 编号 | 模块 | 本轮交付 | 实际运行证据 | 尚未完成 / 依赖 |
|---|---|---|---|---|
| 1 | 总架构与集成 | 已合入 2/3/5；统一原型和独立验收入口；本轮标签 integration-v0.2.1 | [编译调试集成](INTEGRATION-2026-10-25.md) 及 [5号样例集成复测](VALIDATION-INTEGRATION-2026-10-25.md) | 5号对新标签复核签收、G2真机、4号界面与保存 |
| 2 | 编译工具链 | module/02-compiler 的 34e46b9 已合入；真实 Wasm Clang/LLD 8.0.1、固定库与调试构建产物、CompilerAdapter | 模块实测及复现入口见 docs/handoffs/02.md；集成资源在当前仓库校验，不再依赖 2 号工作区路径 | 真机耗时/内存、完整目标能力、源构建可复现性与分发许可审查 |
| 3 | 运行与调试 | module/03-debugger 的 4138dcd 已合入；本地 Wasm 执行器、DWARF4 调试及 WorkerDebuggerAdapter | 模块真实断点、单步、变量、调用栈与停止检查见 docs/handoffs/03.md；联合结果见本轮集成报告 | 更广泛 DWARF/源码覆盖、iPad 执行与后台行为；支持边界以能力表为准 |
| 4 | 界面与保存 | 尚未收到 | 无 | G2 前只做小规模原型；之后正式实现 |
| 5 | 独立验收 | module/05-validation 的 aa6c9de 已合入；8份样例、21组检查、2份最小复现及真机操作单 | 首轮20/21及2条失败保留；集成版本21/21和两个最小复现全部通过，见验收接入报告 | 新标签签收、未执行的manifest预期、真机/界面/草稿验收 |

G1 已有桌面核心链路的独立样例与集成自动复测通过证据；5号对新标签的复核签收仍待。G2待验证，G3等待G2及完整工作流。当前仓库可以运行开发电脑上的编译调试原型，尚无经验证的iPad安装包或完整产品离线资源包。

协议仍为 0.1.0-draft.1。app/integration/candidate.mjs 按当前真实字节建立两模块开发组合；它没有把 contracts/compatibility-profiles.json 的 selectedCompatibilityId 从 null 改为正式路线，也没有把 contracts/offline-bundle.json 从 unprepared 改为可用。模块缓存准备成功不等于产品离线就绪。

后续 1 号每次整合填写：模块分支/提交、共享契约版本、真实组合、运行命令/环境、失败项、5 号独立复测记录。未收到的模块不能用说明文档替代功能交付。
