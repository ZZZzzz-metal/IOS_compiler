# 协作约定

这是 iPad 离线 C/C++ 编译调试工具的唯一应用仓库。编译器、调试器、最小界面/草稿和独立回归已合入桌面原型；路线未冻结，尚无 iPad 安装包或真机验收。

- 开始先读 README.md、docs/architecture/OWNERSHIP.md、contracts/README.md、docs/architecture/STATUS.md。
- 上下文 1 管理根配置、锁文件、app/、scripts/、contracts/、docs/architecture/。
- 上下文 2 只改 compiler/；3 只改 debugger/；4 只改 ui/ 和 storage/；5 只改 tests/、fixtures/、docs/validation/。各自可改 docs/handoffs/自己的编号.md。
- 共享变更以具体补丁建议交给 1，不各自创建第二个应用、根依赖或接口版本。
- 已有标签固定不动；统一界面交付为 integration-v0.3.0，1号追加离线Web实验与平板手册为 integration-v0.4.0。5号正在复验v0.3.0时保持其测试目标，完成后另验离线增量。先检查自己的工作区并保留改动，按 docs/architecture/START-HERE.md 迁移，不能重建已有工作区。
- 上一轮修复打包为 integration-v0.4.1，含4号87973fa的VAL-004修复，当时等待5号独立复验。平板使用新固定版本入口，不强制替换旧会话或清理旧草稿；该轮包/标签保留。
- 2026-10-27上一轮integration-v0.4.2修复REV-001启动恢复并合入5号23b8794，VAL-004限定桌面范围独立关闭；该轮复查与历史失败保留。
- 上一轮integration-v0.4.3合入4号66db2bb的REV-004/005修复及浅色工作台；当时两项待5号独立复验、3号REV-002/003尚未修。历史见docs/architecture/UI-RACE-INTEGRATION-2026-10-27.md；旧包、标签、草稿和证据不覆盖。
- 上一轮integration-v0.4.4已合入5号d12aad0及3号21f2135：REV-004/005限定已测桌面范围独立关闭；八进制、指针误算与浮点一元类型修复已集成，指针相减明确不支持。196项合并检查及另列21/2/6/14项脚本通过，新3号修复、REV-001和新完整缓存包仍待5号独立复验；浏览器/ZIP/本轮HTTPS结果以docs/architecture/WATCH-PUBLICATION-INTEGRATION-2026-10-27.md实际追加为准。新键盘需求由现有4号聊天另行交付，未提交改动不纳入本轮；用户要求推分支/固定标签并建立PR，main由用户手动合并。
- 本轮目标integration-v0.4.5已合入4号309d29d快捷键、3号309cb45（7f49bb6）修REV-006/007和4号33c1639（c14478a）修REV-008，三项已由5号在各固定修复分支的已测范围独立关闭，最终组合/包另验。root组合后251/251通过（10契约27编译83调试106UI/保存3集成22离线），npm-test原文10通过，旧统计器只识别TAP导致ℹ格式断言错误须单独保留、不算产品失败；最后强制check/test由root汇总。最终r3为eb5236b6ed8f9aab4a9d9ced、51项60874273字节，新后端60eb6729284e2729，归档全成员/控制面及12旧ZIP不变已核验。浏览器/HTTPS/新PR实际结果见docs/architecture/SHORTCUTS-INTEGRATION-2026-10-28.md；d62/r2历史候选保留。PR1已merge，后续新PR仍用户手动合并，G2/G3未过。
- 完成情况必须区分：契约测试、桌面真实运行、真实 iPad 离线验证。模拟事件和状态骨架不能算产品能力。
- 路线冻结必须有 docs/architecture/GATES.md 中 G2 的真机证据；缺少设备时保留待验证，交付可运行原型及操作单。
- 能力唯一来源为 contracts/capabilities.json。不得因按钮、接口或 DWARF 文件存在就标记通过。
- 提交前运行 npm run check 和 npm test，并执行所属模块的真实检查；写入交付记录。
- 不擅自改为远程编译/调试，不移除断点、三种单步、变量或调用栈需求。

2026-10-28最终追加：5号c32cbf8已合入（222e30a），REV-006/007在309cb45已测桌面范围、REV-008在33c1639受控并发语义范围独立关闭；最终组合/r3完整包、REV-001实际浏览器恢复及真实iPad仍另验。root251项、最终r3停服重开全新源码编译调试/草稿与设置恢复、严格HTTPS均通过；精确证据以SHORTCUTS-INTEGRATION-2026-10-28.md当前结论为准。此追加不覆盖各轮历史。
