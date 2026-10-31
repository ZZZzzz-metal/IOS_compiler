# CC-20261030-05：v0.4.7 最终离线包独立复验

**结论：固定 `912a23bf14cd6e48a0adb7ec119f4ce86bc58f93` 与下列 v0.4.7 包，在本轮已测桌面范围通过，交 PACKAGE-DONE。** 两项补全语义修复在新包停服冷开后保持可见；真实补全确认、一次原生撤销/重做、新源码运行与断点值、草稿和快捷键方案恢复均有独立记录。没有新增确认产品缺陷。1号合入固定交付后另记限定桌面 ACCEPT；真实 iPad 和完整产品仍未签收。

证据另存 [本轮 integrated 目录](../../tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/)，没有覆盖旧包、标签、失败或草稿。首轮“21项中20通过、1失败，另发现VAL-002，共两条缺陷”及后续原始 exit1 历史原样保留。

## 固定包与来源

| 项目 | 独立核对结果 |
|---|---|
| 完整 ZIP | 19,337,572 B；74成员；73条归档校验；SHA256 `6cc808248baaca8e1107de49d71458fd2140f8c83cd3bbb8810598351abc330d` |
| bundle | `ipad-web-probe-4b6a8377cadd31e675701549`；65资源，60,976,781 B |
| 后端组合 | `integration-prototype-c3e9a2fea60c51b3`；36资源，60,647,102 B |
| manifest hash | `sha256:c3e9a2fea60c51b357384059523151619b4987ddfd2629e80f2bd870c3a8e81e` |
| Service Worker SHA256 | `6900d0dd90e0ef6cdff3d891316251cc3e2c70924d3d26c870e8bc51e3271ac5` |
| descriptor SHA256 | `e9791ceb17df941d32f31e4dfc7216c75b5aba877f4492a404a8bb4e38c2870d` |
| 来源 | 58项固定 Git 原字节、4项锁定大资源、3项生成内容；本轮手册也与 Git 原字节一致 |
| 模块与 Worker | 33模块，50静态边及1条浏览器动态导入；另4条动态导入仅用于 Node。3个隔离 Worker 均打包并受信任，无缺失浏览器依赖 |
| 首次连接小 ZIP | 18,056 B；6成员/5条校验；SHA256 `0958fef87a5871c8c9a4edfc23f10a9b929888f2898da370dfbfdd981351d18f` |

[包审计原文](../../tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/package/report.json)记录实际 ZIP、安全路径、逐项内容与来源核对。补全 semantics 模块及两份配方文档均在包内；小包与完整包的手册、公开证书对应，未安装或信任证书，包内无私钥。50静态边加1浏览器动态边共51条相对模块引用，不把动态引用写成静态边。

运行/API与已验 `0f289cf`、UI/storage运行输入与已验 `b14aeba` 逐字相同，因此复用[先前语义修复报告](completion-fix-person05-0f289cf-2026-10-31.md)的44逻辑例/88真实双路响应、27完整调用、生命周期7场景25检查及主21/最小2/初始化6；主样例内层 shadow=17、出块恢复5，已初始化循环头 i 可读0/1/2保持其原证据。本轮没有再次执行这些昂贵语义套件。未变 UI 的受控竞态26场景105断言、编辑23场景339断言沿用[原固定 UI 证据](completion-ui-person05-b14aeba-2026-10-30.md)，不计作新增运行。

`contracts/capabilities.json` 不是整文件原字节不变：日期、补全 evidence 与 implementationScope 描述更新；状态仍为 `implemented-unverified`，协议、有效能力字段及其余能力不变。package/lock只改0.4.6→0.4.7版本元数据。上述复用不代替新包实际浏览器检查。

## 本轮实际检查

| 范围 | 结果与证据边界 |
|---|---|
| check、npm test | exit0；契约10/10 |
| UI/storage | 200/200；其中包含既有真实编译/调试集成，调用总数未单独计量 |
| 根离线检查 | 23/23；受控 Worker 检查 |
| 原3个自动触发负例 | 3场景/12断言通过，provider调用0；仅此组可使用该零调用统计 |
| 旧证据复核 | 修复831、准备84、UI150、原失败452，共1517文件及各清单的 SHA/长度/Git 原字节验证通过 |
| 本轮真实桌面浏览器 | 43份编号原始观察，含准备、停服冷开、候选、编辑、运行、调试和保存恢复；含探索与加载中记录，不等于43项通过 |

自动阶段9条命令全部exit0，原始命令/输出及[更正后的汇总](../../tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/automatic/corrected-summary.json)独立保存。原负例运行器没有CLI，归档副本只改固定目标、输出和导入路径，原fixture、预期与等待时长未改。

5号只在独立 `127.0.0.1:4265` 服务自己的 ZIP 解包原字节，准备65项后停止服务并记录监听0，关闭页面后从缓存冷开；未操作1号4187服务或缓存。停服后新输入源码，实际候选为：const string保留size/c_str而无append，mutable string仍有10个append；const模板对象仅保留Inspect/合法static Relay，mutable模板还保留Mutate；普通、deprecated及合法double重载保留，unavailable与deleted int重载排除。原始候选见009—014，排除结论取弹出候选，不取包含声明的源码文本。

019候选明确ready后，020确认一次插入 `v047Inspect`，021一次原生undo恢复 `v047In`，022一次redo恢复完整名称。024保存完整[749 B新程序](../../tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/browser/final-program.cpp)；026真实编译运行输出 `person05-v047=41`、返回41。工具恢复后重新启动真实调试，033入口14处未执行声明拒读；035实际停在 `main.cpp:18:1`，局部变量 `stable=29`、`outcome=41`，036继续后同样输出/返回41。暂停值由035原始DOM证明，暂停截图仅提供工作台位置上下文。

037保存“仅标准 F 键”方案并显示已记住，随后关闭工作台重开启动页；039再次完整核验65资源，041实际恢复完整749 B源码、C++语言、草稿版本11和standard方案。043冷开工作台重新校验资源完成，编译按钮可用，源码和方案仍一致。[最终冷开截图](../../tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/browser/final-cold-ready.png)及三份工作台warn/error日志（均为空）另存。本人临时产品页已关闭，没有设置临时viewport。

## 保留的探索、工具问题与待验证项

017/018发生在候选仍loading时，Enter只新增换行、undo撤销该换行；文件名沿用当时记录，不能作为补全确认/撤销通过。第023条记录输入工具达到时限后只输入部分文本的状态；随后按实际剩余内容补齐并核对024，未拿部分稿编译。040也只是草稿读取中，恢复通过依据041/043。

会话中断后原浏览器标签已不可访问，028只证明此前调试开始。工具恢复后在停服的同一来源新建标签，029实际恢复版本11，031重新校验缓存，032—036重新启动一次真实浏览器调试，才获得暂停值；没有将未观察到的旧调试终态补写为通过。最初服务启动涉及沙盒权限处理；连接与工具恢复均没有产品改动。

包检查首轮Python stdout默认编码仅使JSON中的中文路径显示损坏；原 `zip-members.json` 保留，显式UTF-8重采结果另存 `zip-members-run02.json`，解包资源字节和校验未受影响。自动阶段初始summary误写整阶段编译调用0，原输出未改，另存corrected-summary明确UI200含真实集成且调用总数未知。两项均为取证元数据纠正，不计为产品缺陷或额外语义通过。

真实 iPad/Safari、物理IME/触控/键盘、系统完全断网、主屏安装/升级/存储驱逐/强杀/配额/后台/性能、完整界面与草稿强可靠性及G2/G3继续待验证。本轮只证明桌面停服和浏览器缓存路径，不宣称系统网络已关闭，也不代替实体键盘或真机验收。

43条原始浏览器观察的22项独立一致性检查通过，见 [run02](../../tests/evidence/integrated-person05-completion-package-v047-912a23b-2026-10-31/browser-verification-run02.json)。首版审计器过严要求021撤销后光标折叠而exit1；实际原生undo正确恢复旧前缀并选中`v047In`（595..601）。首版脚本与原输出另存run01，修正为旧源码和实际选区后复核通过，没有改浏览器证据或重跑产品。该问题属于审计假设错误。

最终强制`npm run check`、`npm test`通过，契约10/10；原始命令与六份本轮执行/支持脚本原字节归档于`final/`。新目录132文件及SHA清单已独立封存，工作树逐项SHA/长度校验通过。固定PACKAGE-DONE为包含本报告和交接追加的Git提交；提交后另执行`--verify --git`并在DONE回执报告实际提交身份和结果。原失败和所有封存目录保持不变，`tests/scratch/`继续保留且不提交。

提交空白检查完整输出指出三份原始文件的CRLF行尾：`package/zip-members.json`、`server/reconnected-listener-check.json`、`server/final-listener-check.json`。只排除这三个已封存原输出后的其余全部暂存文件检查通过；保留原字节，不把完整检查描述为exit0。
