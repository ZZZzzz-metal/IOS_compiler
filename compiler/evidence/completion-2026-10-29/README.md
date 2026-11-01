# CC-20261029-02 真实证据索引

所有目录保留，包括未通过预期的中间运行。Node v24.19.0 / Windows x64；固定 toolchainId=`binji-wasm-clang-648c4a89997a`。本轮不含浏览器、全离线包、iPad 验收。

| 目录 | 内容与结论 |
| --- | --- |
| `native-probe/2026-10-29T04-58-45-871Z-b8c27caa/` | 首批24例 raw探针；保留当时资源/脚本hash、源码、argv、stdout/stderr、真实版本/help/退出码 |
| `native-probe/2026-10-29T04-59-32-112Z-3a4eb7f6/` | 扩展32例，含private/protected/Hidden、重载、constructor、unavailable/deprecated和fixits开关反例；不是生产adapter结论 |
| `performance/run-2026-10-29T04-59-07-717Z/` | 3个独立进程30次native补全，只有memfs/sysroot/clang；同实例二次_start实际崩溃的对照单列保留 |
| `provider/2026-10-29T15-32-30-129Z-a523ea40/` | 首批24例生产engine+Node Worker，未包含const string扩展，不表示该边界通过 |
| `provider/2026-10-29T15-34-08-493Z-b6127f7d/` | 扩展const string预期失败的中间目录；当时断言在写出该case前抛出，运行不完整 |
| `provider/2026-10-29T15-34-51-804Z-b42df765/` | **保留失败**：const-string.json先保存完整请求/原生stdout/返回，再因absent append断言抛出；目录无summary是失败，不能计为完成 |
| `provider/2026-10-29T15-37-00-009Z-b4f72747/` | 修复case/sizeof字符literal和Pattern误删，30例；const string改为明确记录native缺口，非const完整验收 |
| `provider/2026-10-29T15-41-02-178Z-eafe6d4a/` | 最终5运行模块hash对应的30例production验证；4个实际Worker最终全部释放，执行中取消后重启成功 |
| `verification/2026-10-29-final/` | 最终原文check/npm test/编译测试日志与exit-codes.json：0/0/0，契约10、编译45，无跳过 |

每份production case含 request/snapshot、回显身份、纯文本items、原生argv/stdout/stderr/exit、源文件位置和阶段内存。`const-string-native-gap`明确记录不支持的availability，不对append作名称黑名单；详见 [后端说明](../../COMPLETION.md)。初次失败原文提要另见 `known-failure.txt`。

最终actual-cancel在completion-started进度后5ms安排取消，cancel耗时7.556ms、调用方事件循环15+次tick，terminate之后threadId=-1；进度发于FS/前端初始化前，不能据此精确判断被中断的Clang指令位置。它证明活动Worker实际终止及重新请求可用，不是iPad暂停/后台或硬峰值内存证明。

性能样本不含生产Worker/UI调度，不是冷OS文件缓存或设备内存试验。普通小成员编译器阶段后线性内存7,012,352B；vector17,563,648B、string17,301,504B，memfs9,437,184B。各阶段不能简单相加当作RSS/峰值。原始JSON包含CPU/V8/资源hash和全部独立样本，结论仅覆盖该桌面环境。
