# CC-20261030-05：补全两项语义修复独立复验

**结论：const-string 与 unavailable 在固定 `0f289cf0de5aafc80cafc7c06fd669f95b85d873` 的已测本机语义范围独立关闭。** 两条原失败的源码、sourceHash及原oracle未改，公开适配器与独立原生Worker均实过。根 `fb278778a7442443c5b8b066d6fd88a756a007ed` 的运行/API字节及新36资源组合已独立绑定，可复用此阶段语义证据。新完整离线包、实际浏览器收尾及真实iPad仍待验证，不签完整产品ACCEPT。

新证据独立保存于 `tests/evidence/integrated-person05-completion-fix-0f289cf-2026-10-31/`。旧exit1、首轮21项20通过1失败另VAL-002共两缺陷、原33各轮统计、旧限定ACCEPT、标签与发行包均保持原样。

## 固定目标与身份

| 项目 | 本轮核对结果 |
|---|---|
| 实际语义目标 | 2号固定0f289cf，前后HEAD及产品字节不变；不测试移动草稿 |
| 原完整编译Clang | 31,214,472字节，SHA256 `2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d` |
| 实际补全派生Clang | 31,214,494字节，SHA256 `b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901` |
| 补全toolchainId | `binji-wasm-clang-648c4a89997a+completion-semantics.1` |
| 根固定组合 | fb278778，`integration-prototype-c3e9a2fea60c51b3`；36资源60,647,102字节 |
| 独立manifest hash | `sha256:c3e9a2fea60c51b357384059523151619b4987ddfd2629e80f2bd870c3a8e81e` |

未借产品validator作为唯一依据：独立从锁定原blob按固定配方拼接22字节，自己解析ULEB section/import/code-body边界，确认body1400→1422、code25177807→25177829，改变的函数仅39589/40648，其余函数及非code节payload逐字相同。全SHA、Wasm.validate、原blob未变均核对，再与产品派生器逐字节交叉比较。

完整性阶段18项含实际独立派生、产品交叉核验及故障注入；其中5份受控adapter回复是身份正负对照，不能记为真实Clang查询。截断/同长污染原输入、错误header/beforeguard、错误派生全SHA及body长度配方均拒绝；公开adapter拒绝错误原锁身份、伪装原compilerHash/原ID和错误派生ID/hash，正确身份保留候选。原vendor、lock、sysroot及完整编译身份保持原字节。

## 实际结果

| 范围 | 本轮结果 | 证据含义 |
|---|---:|---|
| 原33中的后端场景 | 30/30 | 每例公开CompletionAdapter真实NodeWorker与独立engine Worker双路 |
| 原额外unavailable场景 | 1/1 | 原源码/原oracle不变，单列原33之外 |
| 随机扩展 | 11/11 | nonce=`a8ee505af129`；别名、具体模板、const重载、属性三位置及跨namespace同名 |
| 后加小对照 | 2/2 | const对象static成员模板保留；deleted(int)排除而同名double保留 |
| 双路响应 | 88/88 | 44逻辑例逐字段相等，44个native UTF8位置正确；两真实查询Worker均释放 |
| 完整调用控制 | 27/27 | 原11组的24程序及late的3程序分开；真正编译/链接/smoke或预期语义失败 |
| 补全生命周期 | 7场景/25检查 | 活动取消、暖Worker释放、重启、旧ID隔离、dispose、supersede、真实超时释放 |
| 既有独立回归 | 主21、最小2、初始化6全部通过 | 全新真实编译与解释执行；主shadow17→5、循环头后续i可读0/1/2 |
| 强制检查 | check及契约10/10通过 | 基线完整离线仍NOT READY；不是新包/真机通过 |
| 测试基础设施 | 31/31 | 含原输入/oracle及新签名、诊断链的合成自检，单列数量 |

原33中的3个UI自动触发负例继承上一固定UI证据；运行/API及UI关键输入字节相同，本轮不再触发浏览器测试。原33当前合并证据为30个新后端通过加3个先前UI通过，不能称本轮新跑了33次后端或全部UI。44/88、27及18项不得相加成用户端到端或iPad验收总数。

完整调用正例要求原完整编译资源身份、非空object/executable、产物hash/长度及实际smoke exit0。4个const负例定位具体用户调用行与成员，并检查该error及关联candidate note中的const接收对象原因；Clang的原因在note中也有效。unavailable/deleted须匹配其具体语义原因，任意compiler-exit、无关error、初始化/链接失败均不能通过。deprecated候选保留，实际编译成功且warning保留。新独立后审对27请求重新计算canonical sourceHash及精确源文件，核对34个二进制、27次compile-started/compile-evaluated与真实Worker退出，未重复编译。

## 两条原失败的关闭证据

- `const-string` sourceHash仍为 `sha256:e02280d128ef0a382ad528c05052f24565c086726c8bfe1ed12d502d7b39366c`。原生旧结果有4条append模板，本轮原生与最终候选均无append，size/c_str保留；两路原oracle passed。
- 原extra sourceHash仍为 `sha256:584275ddc1a37f9aaf75a0901658317b6bba802547a1ab32f438d800cc05dff9`。新原生输出保留 `personBlocked (Inaccessible)` 标记，最终候选只保留personAllowed/personDeprecated；两路原oracle passed。不是把原生文本中所有blocked字样删除后过关。

同名重载先执行原oracle，再逐候选严格签名检查；合法签名必须存在，非法/无法识别的同名签名不得确认。未按名字黑名单、改预期或整体关闭补全。

## 根组合绑定、版本与封存

binding只读审核按两个固定Git提交取字节，49份运行/API及配方输入一致；36后端资源分32份固定Git输入、4份原锁大型本地字节，逐项hash/长度及独立canonical manifest/profile计算通过。semantics.mjs确在新candidate，配方两文档在固定offline源映射。此处核对静态映射，尚无新完整包实测；旧35资源profile不改写为包含修复。既有回归harness明确使用外部02的模块候选，未冒称直接运行新36资源发行包。

一次测试源码时序差异另存review：调用运行器在通知可执行之后被追加仅源码hash/计数的加固，实际父/子归档版本同为SHA256 `291323cb93fe4a86e5ac1b73531f33e9803ef48bd74231fce04ae7b8fe7aa6f1`。最终可执行文件已恢复为实际受测原字节；未执行的F800…变体单独保存。语义oracle、编译参数、27控制和Worker流程未变；源码hash/计数由独立post-audit补核，未重跑或膨胀数量。

七个指定旧目录1031文件及清单再次verify --git通过，包括原452失败、150UI及84准备；未改旧证据。本轮封存清单、最终Git字节一致性以新目录SHA256SUMS.json及交接追加为准。

复现入口为 `node tests/run-completion-fix-stage.mjs <固定02根路径> 0f289cf0de5aafc80cafc7c06fd669f95b85d873 integrated-NEW`，须使用全新合法目录名；原始命令/退出码在commands/。绑定工具为tests/audit-completion-fix-binding.mjs，原始post-audit与脚本在review/。所有代码与证据仅在5号范围。

真实iPad离线、Safari/物理键触/中文IME、完整界面与草稿强可靠性、首次HTTPS准备/安装升级/驱逐/强杀/配额/后台/性能及G2/G3继续待验证。根须冻结新完整包后另交固定身份，5号再做实际浏览器/离线增量收尾。
