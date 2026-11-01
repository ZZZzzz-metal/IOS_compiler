# 5号独立补全样例

请求CC-20261029-05，准备基线从4f48884快进到冻结API提交38ff3075a4b47c3f72ae2f6552a04e58da07d6c0。32个逻辑场景、33份源码；当前全部待真实provider及UI执行，不代表功能通过。源码刻意保留不完整表达式，不能以常规编译成功作为补全的前提。

`cases.json`将磁盘文件映射到虚拟项目。只移除目标文件中唯一的`/*<cc>*/`；其原位置是规范LF源码的0基UTF16插入点。其他文件完整保留。`included-source`以driver.cpp为翻译单元、user.inc为补全目标；不能把user.inc独立编译来替代。

`contains`和`excludes`针对语义候选的标识符，允许额外合法候选和重载；不要对候选顺序、平台相关签名空白、总数量作脆弱断言。`visibleExcludes`只约束UI前缀过滤，不误要求provider一定预过滤。检查真实签名、插入文本和范围时同时保存原始结果，不能只对渲染后的字符串断言。

三组反事实用于识别词袋/硬编码：同名value改变静态类型时scarlet和north互换；字段重命名为coral时旧名消失；离开内层作用域后innerOnly恢复为outerOnly。另有driver包含与缺失声明对照。另查私有/受保护或const不可调用项是否成为可确认候选；冻结Item无禁用标志，须核对2号实际过滤及明确限制。这两项标记boundary，不能据此宣称完整C++访问控制。

comment、string-literal、decimal是UI自动触发负例。它们的“无自动请求”与编译器手动请求结果分别记录。中文标识符、同一行中文/emoji在光标前的样例用于独立核对UTF16到UTF8字节列；BOM/CRLF属于后续真实编辑器到规范快照映射测试，不往规范源码中插入BOM/CRLF冒充通过。

首批28例后按1号草稿审查建议追加4例：合法case'a'/sizeof'a'后的成员补全，以及真实变量/函数名Pattern。用于后续检查启发式词法和CLI伪项识别，不把草稿合成复现当已发布缺陷。enum使用orc前缀，避免or关键字混入普通标识符验收。

运行`node --test tests/completion-fixtures-checks.mjs`仅校验样例及坐标基础设施。真实补全、并发UI、完整离线包和真机验收另列；方案见[独立验收计划](../../docs/validation/completion-independent-plan-2026-10-29.md)。历史首轮20通过1失败、另VAL-002共两缺陷及全部旧证据保持不变。
