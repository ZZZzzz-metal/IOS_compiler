# 补全后端阶段独立复验

2026-10-30，CC-20261029-05。固定公共提交**bddae57653bede9a38a3510006d761e2a9d19a04**，含2号afada754交付/96d328a实现。准备提交0b062df已由1号合入并ACCEPT-PREP；本轮依祖先关系快进，保留自己的运行器改动和旧scratch，未修改产品。候选组合为`integration-prototype-80135c59f01b26fc`、35资源，五个补全运行模块均在资源表中。

**后端已测主流程通过；完整候选可调用性仍有实际边界失败，最终功能ACCEPT待UI/新包。** 4号随后交付e2efc077，5号已确认收到，未在本轮受测中途切换目标或借其自测签收。原生CLI/真实Node Worker结果与受控单元检查分列，不代表浏览器或iPad。

## 实际结果

| 范围 | 结果 | 证据/含义 |
|---|---|---|
| 原33个逻辑场景 | 29通过、const-string 1边界失败、3项UI待验 | 30个provider场景各走公共Adapter真实Worker及独立原生engine Worker，共60响应；双路结果30/30逐字段相同 |
| 必需后端场景 | 26/26通过 | 类型更换/重命名/遮蔽恢复、声明顺序、C11/C++17、点/箭头/命名空间、嵌套成员、前缀/函数签名、标准库、未完成源码、中文/emoji、driver/user.inc及字符常量/Pattern |
| 原33中的边界 | 3通过、const-string 1失败 | 外部访问、普通const方法及缺driver反事实通过；不是完整访问控制保证 |
| Worker生命周期 | 7/7场景、25检查通过 | 活动double cancel、同adapter重启、最近完成ID释放暖Worker、旧ID隔离、dispose、活动supersede、真实Worker超时释放 |
| 补充属性场景 | 1逻辑边界失败，双路各失败 | unavailable函数仍为可确认候选；不增加或改写原33结果 |
| const调用对照 | 两源码对照成立，另原生复核exit1 | const调用编译失败；去const编译链接/实际运行输出person05、exit0 |
| 属性调用对照 | unavailable失败，deprecated可调用 | 原始错误/警告保留；deprecated实际Wasm退出0 |
| 既有常规回归 | 276/276通过 | 契约10、编译/调试模块128、集成3、UI/storage106、主21、最小2、初始化6 |
| 根离线门禁 | 23/23通过 | 受控Worker信任/恢复检查，不等于新包离线实测 |
| 独立测试基础设施 | 16/16通过 | 7项fixture与9项oracle自检，不能计作产品能力 |

check、工具链verify-only 11项及上述回归命令均exit0。后端33例运行器和补充属性运行器均因保留边界失败而**exit1**；基础设施异常0，不能用其它全绿套件掩盖。重复检查及双路观察均不累加为独立功能数量。

主套件新原始查询实际读取shadow=17→5；循环头最小复现的后续已初始化i保持available，循环体为0/1/2。两个旧最小复现、6初始化生命周期均通过。主记录中baseline字段保留原始样例基线，实际validation/compiler/debuggerRevision均为bddae576，不误取旧baseline作本轮产品身份。

## 失败原因与边界

`const-string`的规范快照sourceHash为`sha256:e02280d128ef0a382ad528c05052f24565c086726c8bfe1ed12d502d7b39366c`。const std::string对象的完整成员补全两路都返回4条append模板候选，native exit0；原始CLI没有Inaccessible/可用性标志。冻结Item没有禁用状态，因此这些返回项实际可被确认，原oracle记boundary-failed。

另写完整程序真实调用`const std::string text; text.append("person05");`，CompilerProbe实际failed/compiler-exit，诊断明确方法未标记const；独立原生前端复核exit1。去const的正例编译链接并真实输出person05，Wasm248415字节，SHA256=`7a46669bc5e1845c1335f31f57722f711a32c21f69bb6dd2e8d473bc6eec7369`。调用对照与未完成补全源码的hash不同是预期，原补全请求/结果没有替换。

补充同前缀personAllowed、personBlocked(unavailable)、personDeprecated(deprecated)三函数，双路均返回3项，三条原生CLI记录都无availability标记。调用personBlocked真实编译失败且包含自定person05-unavailable诊断；deprecated调用编译成功，保留person05-deprecated警告并实际退出0。deprecated仍可调用，不以候选出现本身判失败；失败是unavailable仍可确认及缺失元数据。

这些是固定Clang8补全模式的可用性信息缺口。正常前端编译能拒绝非法调用，补全CLI未充分标记，provider只过滤实际Hidden/Inaccessible，不能从返回内容可靠补齐完整语义。5号已立即通知2号并同步1号；2号确认与其已封存限制一致。未采用名称黑名单、未放松合法性断言、未改为“已知所以通过”，也未伪称新修复。该范围不扩张为完整VS语义、模板/属性/const可调用性或精确kind已支持。

## 独立性与证据

新目录为`tests/evidence/integrated-person05-completion-runtime-bddae576-2026-10-30/`，完整原始请求/快照、双路实际响应、CLI stdout/stderr/argv/exit、资源读取/长度/SHA、独立UTF8位置、产品前后指纹与各命令退出码分别保存。30个原生位置全部正确，包括同一行中文/emoji及driver.cpp解析user.inc；原生补全只读取memfs/sysroot.tar/clang三项，不读取LLD。完整编译调用对照另存，不能混作补全资源加载。

`lifecycle-run-01/`记录7次公共complete、6个真实Worker及父进程事件序列，全部exit/threadId=-1，未用伪Worker。首个Worker exit/terminate结算在complete(cancelled)和两个cancel返回之前；supersede旧释放在新Worker创建之前。短超时只证明真实Worker创建/释放，不声称一定在某条Wasm指令中中断。未测UI编译门禁接线。

`callability-run-01/`和`availability-run-01/`保存新源码、调用/诊断/真实Wasm与资源清理；属性脚本9检查通过、2个同一逻辑问题的双路边界检查失败，不重复登记为两条产品缺陷。`post-audit/`核对双路逐字段相同、规范源码hash、30个UTF8位置、35资源组合和真实回归数，审计通过不改变产品失败。

原32/33例准备封存66/67文件及上轮最终179文件均重新verify --git通过。首轮“21项20通过1失败，另VAL-002，共两条缺陷”、全部后续失败、旧标签/包和旧证据原样保留。仅新增5号tests/fixtures/docs/本人交接；所有产品字节和本轮受测HEAD在执行前后保持不变。

## 封存后Git核对追加

主证据封存452文件后，提交5d3734da79e31d6a743a42369c09a50692356693。工作树SHA核验通过，但旧核验器把452路径一次传给Git，Windows报ENAMETOOLONG，首次Git字节核对未完成；这是5号核验工具的命令行长度问题，不是新增产品失败。原脚本及实际错误另存`tests/evidence/integrated-person05-completion-gitverify-2026-10-30/`。

仅将tests/seal-integrated-round.mjs两次只读Git查询改为保序小批次，未放松大小/SHA/文件集合/提交字节比较。452文件及清单随后verify --git通过；旧66/67/179文件再验。主452文件证据和原失败没有重写，修复与其验证另外固定提交，集成时需保留主阶段提交及核验器修复。

## 下一阶段

等待1号固定含4号UI的最终组合与新不可变完整包。若五个后端模块、公共依赖、锁定资源及API字节相同，按1号要求复用本轮真实语义证据，仍核对新组合/包的实际身份；UI接线、受控竞态和真实浏览器/停服新源码流程另验。重点包括Tab确认后bubble不缩进、composition本地状态/229、原生撤销、失效门禁、延迟/重入dispose及失败封闭、footer尺寸。

当前3个注释/字符串/数字自动触发例仍UI待验；新包停服冷开、新源码补全与编译调试、真实iPad/Safari、物理键触/中文/性能、完整界面及草稿强可靠性、安装升级/驱逐/强杀/配额/后台和G2/G3继续待验证。
