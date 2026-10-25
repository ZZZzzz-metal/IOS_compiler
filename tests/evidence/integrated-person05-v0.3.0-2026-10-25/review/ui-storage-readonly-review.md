# UI/storage只读交叉复核

日期：2026-10-25（Asia/Shanghai）。受测来源为integration-v0.3.0 / fff15bee97ed47cf2485b83c4344a020e9e190f7。此子任务没有运行浏览器、没有执行会写证据的测试、没有修改产品或测试实现；以下是源码审阅与浏览器验收建议，不是实测通过结论。

已读AGENTS、README、OWNERSHIP、共享契约、STATUS、UI-INTEGRATION以及ui/src/main.mjs、session-controller.mjs、storage/src/autosave.mjs、draft-store.mjs及相应检查。

## 应由主任务实际操作的流程

1. 双窗口先读取同一main修订；A改为带唯一标记的源码并等待“草稿已保存”，B再改。B应出现“其他窗口已保存较新草稿…”，B编辑保留，重试不能覆盖A。重新打开main仍应是A。
2. B点击“将当前编辑存为恢复副本”；URL出现#draft=recovery-…，重开此URL恢复B，原main仍为A。恢复过程中编辑区应不可交互。对应代码main.mjs:273起。
3. 完整草稿导出并从实际文件导入，核对源码、driver、stdin和语言；坏JSON/未知格式的导入必须拒绝并保留原稿。仅源码复制/导出只能包含userText，不带driver。对应main.mjs:256、259、263；draft-store的parseImport/serializeDraft。
4. 暂停后修改源码，UI提示“源码已修改·请重新编译”。查看调试快照应是原只读源码，返回编辑稿保留新内容；当前执行行和栈帧导航不能标在已修改稿上。
5. Solution与可编辑driver：初始运行、改driver后重新编译的输出都必须实际变化；缺失符号诊断应跳到driver.cpp而非user.inc。仅sourceHash改变不足以通过。
6. 浏览器中的断点、三步、变量、调用者切换和停止重启必须与真实执行对应。Node UI控制器回归不能替代DOM、IndexedDB重开或iPad验收。

## 源码中已有保护

- DraftStore把读取当前修订、比较expectedRevision、写新稿放在同一个IndexedDB读写事务；冲突不提升版本或强行覆盖。
- Autosave序列化保存并只保留最新待写稿，失败保留pending；界面先restore再接收编辑。
- SessionController使用session/build/source/compatibility身份、eventSeq、pause/frame与queryEpoch隔离旧回复；ACK只做确认，不恢复旧暂停。
- 导入先解析校验，成功后才替换draft并安排保存；恢复副本使用新的草稿ID，保留原main。
- 编译结束会重新比较源快照，源码已改变时不启动旧成功产物；真实会话与编辑稿分离。

这些是实现观察，不代替主任务实测。

## 值得确认的未定风险

暂停后切换语言或导入会清空全局requested断点（main.mjs:250/261），旧活动调试会话的后端断点仍然存在。renderBreakpoints（main.mjs:78起）即使处于旧调试快照也只遍历requested，因此可能出现旧快照显示“尚未设置断点”，继续却仍命中旧断点的状态矛盾。

建议最小操作：同一源文件设断点并暂停→切换语言或导入新稿→查看调试快照→继续；核对请求/绑定列表和真实停点。此项只读审阅尚未复现，不能预填失败或通过。普通修改源码不清空requested，不会触发同一路径。

## 验收边界

真实iPad断网冷启动、系统强杀、物理键鼠/触控/中文输入、后台/配额驱逐和安装升级均未由本子任务验证。24项模块数量包含契约/异步时序的可控适配器检查，不能称为24项用户端端到端验收。
