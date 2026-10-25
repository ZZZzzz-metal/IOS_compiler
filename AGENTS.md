# 协作约定

这是 iPad 离线 C/C++ 编译调试工具的唯一应用仓库。2/3 号真实编译器与调试器已合入桌面集成原型；路线未冻结，尚无 iPad 安装包或真机验收。

- 开始先读 README.md、docs/architecture/OWNERSHIP.md、contracts/README.md、docs/architecture/STATUS.md。
- 上下文 1 管理根配置、锁文件、app/、scripts/、contracts/、docs/architecture/。
- 上下文 2 只改 compiler/；3 只改 debugger/；4 只改 ui/ 和 storage/；5 只改 tests/、fixtures/、docs/validation/。各自可改 docs/handoffs/自己的编号.md。
- 共享变更以具体补丁建议交给 1，不各自创建第二个应用、根依赖或接口版本。
- 首次基线 baseline-v0.1.0 与 integration-v0.2.0 固定不动；本轮共同交付为 integration-v0.2.1（加入5号独立验收）。先检查自己的工作区并保留改动，按 docs/architecture/START-HERE.md 迁移，不能重建已有工作区。
- 完成情况必须区分：契约测试、桌面真实运行、真实 iPad 离线验证。模拟事件和状态骨架不能算产品能力。
- 路线冻结必须有 docs/architecture/GATES.md 中 G2 的真机证据；缺少设备时保留待验证，交付可运行原型及操作单。
- 能力唯一来源为 contracts/capabilities.json。不得因按钮、接口或 DWARF 文件存在就标记通过。
- 提交前运行 npm run check 和 npm test，并执行所属模块的真实检查；写入交付记录。
- 不擅自改为远程编译/调试，不移除断点、三种单步、变量或调用栈需求。
