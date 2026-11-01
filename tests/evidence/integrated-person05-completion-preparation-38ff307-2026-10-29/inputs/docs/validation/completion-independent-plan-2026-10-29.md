# CC-20261029-05：离线补全独立验收准备

2026-10-29，5号。当前结论为**准备完成，功能待验**。已核验1号聊天中的真实用户需求及REQ/ACK/DONE/ACCEPT通信授权，已发送ACK与API-ACK。复用原05工作区，保留新样例和旧scratch，从4f48884快进至冻结API及根前置38ff3075a4b47c3f72ae2f6552a04e58da07d6c0。该提交没有完整补全provider/UI，不能作为功能验收终点。

## 准备交付及证据

- `fixtures/completion-independent/`：32逻辑场景、33源码，清单在cases.json；含C11/C++17、成员/前缀/作用域/包含文件/标准库和负例。
- `tests/lib/completion-fixtures.mjs`：独立读取清单、移除唯一光标标记、保留虚拟项目、计算规范LF的UTF16偏移及1基UTF8字节列；不产生候选。
- `tests/completion-fixtures-checks.mjs`：7项基础设施自检，含字面坐标oracle、代理对边界、类型/重命名/作用域对照及翻译单元与目标文件分离。
- `tests/prepare-completion-evidence.mjs`：一次性运行器，拒绝覆盖同名目录，保存命令、stdout/stderr、退出码、输入副本及指纹。新证据目录为`tests/evidence/integrated-person05-completion-preparation-38ff307-2026-10-29/`，封存后只读。

子代理只读复查首批28例与自检，未发现阻塞准备交付的问题；已采纳两处修正：enum前缀从C++关键字or改为orc；重命名反事实显式连接baselineId=type-a。后按1号草稿审查建议追加case'a'/sizeof'a'后的成员及真实变量/函数名Pattern共4例，检查词法误抑制与CLI伪项混淆；不以合成复现登记已发布缺陷。该复查及7项自检只说明测试输入有效，不计入真实补全通过数。各case维持pending-provider，真实请求和浏览器观察均为0。

## 开始功能验收所需的固定交付

1号另发固定provider、UI和最终组合提交、新完整离线包及API身份。记录Git提交、锁文件/Clang/sysroot SHA、bundle/资源表/ZIP SHA及成员表；先核对工作区与提交一致，不以正在变化的其他工作树作签收目标。2/4号DONE和自测仅作为交接输入，5号独立重跑。准备DONE与功能ACCEPT分开。

冻结入口为`compiler/src/completion-adapter.mjs`导出的CompletionAdapter，构造参数含lock、可注入Worker、timeoutMs、onProgress，complete/cancel按`contracts/completion.d.ts`，dispose为具体扩展。真实provider路径使用实际Worker和Clang；受控乱序使用可注入Worker，但分别计数，不能互相替代。

## 真实语义与反事实

对每次真实请求保存完整SourceSnapshot、requestId/documentVersion/sourcePath/offset、原始响应、Clang原始输出/实际选项、耗时与退出码。独立核对响应身份、真实资源指纹、唯一item ID、范围边界、insertText和detail。offset使用规范快照UTF16；sourceHash按产品冻结快照协议生成并核验，独立fixtureHash仅用于输入对照，不冒充sourceHash。语法不完整而原生命令非0仍可能有合法候选，应检查实际结果，不能一律按退出码抛弃候选。

| 覆盖 | 独立观察与负对照 | 状态 |
|---|---|---|
| 类型与重命名 | 同名value从Pixel改Compass，scarlet/north互换；改字段为coral后旧名消失，两个类型声明仍在源码中 | 待验 |
| 作用域/顺序 | 内层innerOnly，出块outerOnly；光标后的beforeLater不出现 | 待验 |
| 成员/前缀 | `.`, `->`, `::`、嵌套成员、局部变量/函数、enum；前缀过滤与原生候选分别检查 | 待验 |
| 标准库/C | vector的size/push_back，string的size/append/c_str；C11结构体点/箭头和变量前缀 | 待验 |
| 未完成/包含文件 | 缺闭括号仍可获得已声明成员；driver.cpp包含user.inc并在后者完成；省略driver的反事实不得凭空返回fromDriver/serial | 待验 |
| 访问/const边界 | 保存public/private/protected及const对象调用的原始标记和实际可确认项；合法访问与被隐藏项分开 | 待验、单列边界 |

contains/excludes比较标识符，不要求固定总数/次序/签名空白。允许合法重载，另验不同签名不会被不当去重。候选截断须如实记录isIncomplete，不能把200项限制误写成完整语言服务。visibleExcludes只检查UI过滤。三个trigger=none场景（注释、字符串、数字1.）检查不发自动请求/不弹窗，不误断言手动provider一定返回空。

访问控制结论须来自固定交付的真实Clang输出。1号转述2号PROGRESS称Hidden/Inaccessible可过滤、合法InBase需保留，kind可能统一unknown，deprecated/unavailable可能没有原始标志；这些转述均不替代独立证据。冻结Item没有禁用状态，不凭空假定UI会禁用。若const或不可用声明无法可靠区分，记录实测限制并请1/2/4给明确产品范围，不宣称完整VS可用性或完整C++访问控制。

## 坐标与插入

中文标识符及光标同一行之前的中文/emoji分别验证UTF16与UTF8字节列，不能只测前一行非ASCII。从真实编辑器分别输入LF、CRLF、开头BOM及组合变体，检查原始caret到规范快照的映射；provider收到规范LF无BOM，确认回写到正确原始编辑范围。user.inc必须以driver.cpp为translationUnit，以user.inc为sourcePath。

检查范围0<=start<=end<=目标长度且不切开代理对；中间插入/标识符后缀、文件末尾、换行前后均覆盖。确认只改绑定标识符，保留其他文件、中文、行尾、stdin及断点状态。插入为普通标识符纯文本，不残留Clang占位符。实际浏览器验证一次确认产生一次正常编辑/保存，撤销/重做能完整还原，不能以受控输入事件代替原生撤销证据。

## 并发、Worker生命周期与UI

受控用例需运行实际接线和控制器，记录请求时序、编辑版本及错误；伪Worker仅控制返回顺序。结果身份任一字段错误、重复ID、非法范围、非成功携带items、空成功、异常、超时均单列。A迟到成功/失败不得覆盖B或关闭B新弹窗；requestId在适配器生命周期内唯一。取消无目标/重复调用保持幂等，cancel返回时匹配请求已结束且Worker释放，后续新请求仍可用。

输入、移动caret、语言/标签变化、导入、恢复副本、新文档、进入只读调试快照使旧候选失效；迟到结果和迟到选择事件不得写入新稿或保存。IME组合期间不请求或确认，组合结束后再按新内容判断。先写确定性时序测试，再在真实浏览器检查实际可观察路径；模拟事件不当作物理键盘/中文输入法验收。

编译前先禁止新补全，再等待活动ID取消，**同时释放无活动请求的暖Worker**；编译期间不重新创建补全Worker。编译成功/失败/取消后恢复编辑服务。记录真实terminate/release及编译启动先后，防止只取消活动ID却留下大Wasm内存。重复补全应使用新Wasm实例，不能因同一实例第二次执行崩溃而把故障吞为“无候选”。

实际弹窗验证↑↓选择、Enter/Tab确认、Esc关闭、鼠标/触控入口及焦点；关闭时保留Tab缩进。特别检查Tab在capture确认后，旧main bubble缩进尊重defaultPrevented，不能重复缩进或触发其它快捷键。候选快捷键不吞stdin编辑或现有F键/Control数字调试动作；只读快照无可写补全。键盘/触控真实iPad结论留给设备实测。

## 新包离线与既有回归

1号将所有补全运行模块、Worker及动态URL加入可信组合和资源表。独立核对ZIP全成员、磁盘/Git字节、锁定资源、静态import及Worker URL，不只检查普通import。受控信任门禁检查补全Worker受其它scope控制时拒绝。不能重打或覆盖旧v0.4.5-r3包。

真实桌面浏览器准备新包全部资源后停静态服务，核实监听为0，关闭版本页并冷重开；输入未预录的新源码，真实完成成员和前缀补全，再完成新源码编译调试。保存新请求/响应、DOM/截图、资源身份、服务停止证据和实际输出。此环境准确称“桌面停服”，不声称系统断网或iPad离线。

在最终固定组合执行check、test及相关模块/离线/独立回归，重点保持原主样例内层shadow=17、出块恢复5、已初始化循环头可读；旧最小复现2项、初始化生命周期、浮点/NaN监视及剪贴板迟到写入的既有覆盖按最终改动影响复验。原首轮21项20通过1失败、另VAL-002共两条缺陷及全部后续失败证据保持原样。

## 出口与交接

真实语义、受控并发、实际桌面浏览器、停服新源码及真机各自报告。失败立即以请求ID、固定目标、最小源码/步骤、预期/实际及新证据路径通知对应2/4号并同步1号；不改产品实现或借自测签收。新一轮另建integrated-*，封存SHA并核对提交字节。

仅准备材料完成时发送DONE-PREP及固定独立提交，列实际自检和未执行项。收到最终组合/新包后再出独立功能结论，由1号按握手规则决定ACCEPT；范围或缺陷未解决就如实待验/失败。真实iPad/Safari、物理输入/触控/中文、安装升级/缓存驱逐、草稿强杀/配额/持久性、后台与性能及G2/G3继续待验证。
