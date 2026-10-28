# 快捷键、监视语义与剪贴板修复集成

本轮于2026-10-27开始，2026-10-28继续整合（北京时间）。目标版本 `integration-v0.4.5`，协议仍为 `0.1.0-draft.1`。固定提交合并、251项检查及最终r3本地归档字节审计已完成；桌面停服浏览器、严格HTTPS及251项检查已完成，GitHub推送/新PR待实际登记。

## 交付来源与行为

4号固定提交 `309d29dd703b1bc5a5beff03a88f232764c95808` 基于已集成的dc65469，1号通过 `3248ad54faa5f0f3a8b6f6501829e95e4699f066` 合入，保留模块历史。30个交付文件仅涉及ui及04交接，用户键盘照片未纳入Git。

标准F5开始/继续、Ctrl+F5运行、Shift+F5停止、F9断点、F10跳过、F11进入、Shift+F11跳出仍保留。默认“无F键：Control＋数字行”另提供Ctrl+5、Ctrl+6、Ctrl+Shift+5、Ctrl+9、Ctrl+0、Ctrl+-、Ctrl+Shift+-。数字行按物理键位识别，无需Fn或Option；可切换为仅标准F键，设置按浏览器来源保存，保存失败有提示且本次选择仍有效。

按钮和快捷键共用真实状态及能力门禁。断点只在源码焦点且编辑稿可写时切换；输入框、弹窗、IME组合输入、长按重复及等待命令确认受到保护，不能堆积继续或单步。只读快照、准备/恢复/编译阶段的限制保留。未实现的重启和运行至光标不映射为其他动作；iPad系统截获而未送达页面的按键只能真机确认。

用户对照表与实机小操作单见 [ui/SHORTCUTS.md](../../ui/SHORTCUTS.md)，总流程见 [平板手册](IPAD-USER-MANUAL.md)。

## 验证与宿主适配

4号的99/99为其交付自测：契约10、UI/保存86、真实集成3；其真实桌面浏览器4205端口完成两种方案七个动作、输出5/exit0及设置保存重开，详见 [4号证据](../../ui/evidence/integrated-shortcuts-2026-10-27/README.md)。这些不作为本轮新完整缓存包或iPad证据。

1号合并后实际结果位于 [shortcuts-integration-2026-10-27](../../app/offline/evidence/shortcuts-integration-2026-10-27/)，目标固定为3248ad5，Windows、Node.js v24.19.0。

| 检查 | 实际结果 | 范围 |
|---|---:|---|
| 相关Node检查 | 121/121 | 契约10、UI/保存86、真实集成3、离线22；未重跑未变后端102项 |
| `npm.cmd run check` | 退出0 | 结构通过，产品资源状态仍预期NOT READY |
| `npm.cmd test` | 10/10，退出0 | 已包含于121项，不重复加总 |
| root-owned适配宿主UI竞态 | 14/14 | 基础设施失败0；真实完整UI主模块，DOM/文件/网络/适配器与存储传输受控 |

新增快捷键使用editor导出的resolveShortcut与shortcutLabels，旧5号VM未注入这两个真实函数；旧宿主又为不存在的dialog[open]返回节点，会误判有弹窗。这是宿主与新界面不匹配，不能作为产品缺陷或缺陷修复证据。1号在自己证据目录保存明确标注的适配副本，注入两个实际导出函数并准确返回无弹窗，路径基准随副本调整；原断言、5号原脚本和历史证据保持原样。适配清单、原始SHA、原始输出与退出码可复查。

本次14项属于1号重跑，不是5号独立签收，也不证明IndexedDB、浏览器缓存或iPad行为。既有5号195+14范围不扩张到本轮。REV-004/005在66db2bb的限定独立关闭结论保留；新快捷键、3号监视修复、REV-001恢复及本轮新包仍待5号复验。

## 5号新增三项P2与当前修复状态

5号对固定3248ad5的并行复查确认下表问题，并已通知相应负责人修复。当前交付为含已知问题的实验原型，既有通过数不能推断全量完好。

| 编号 | 归属 | 已确认失败与范围 | 当前处理 |
|---|---|---|---|
| REV-006 | 3号 | float32二元转换/比较监视错误：negative+16777217得1、预期0；positive==16777217得0、预期1 | 309cb45已修复集成；5号c32cbf8限定已测桌面范围独立关闭 |
| REV-007 | 3号 | NaN按JS的false处理，使!NaN、逻辑或错误，并错误执行本应短路的除0 | 309cb45已修复集成；5号c32cbf8限定已测桌面范围独立关闭 |
| REV-008 | 4号 | 页面粘贴按钮等待readText期间新编辑已保存，迟到旧读取仍覆盖并进入真实autosave，revision2→3 | 33c1639已修复集成；5号c32cbf8限定受控并发语义范围独立关闭；旧候选暂用系统粘贴并先导出 |

两项监视缺陷的原生Wasm与解释器程序本身对照正确。粘贴失败证据执行完整main及真实autosave，但DOM、clipboard和存储传输受控，不能算真实浏览器IndexedDB或iPad复现。规避不是修复，关闭问题需要新固定提交及独立正负对照。

### 3号固定修复已合入

3号交付 `309cb45191a62fde2b13eeab9746a8d2502ef658` 已通过合并7f49bb6接入。混合float/整数先选共同浮点类型、分别转换两侧再算术/比较；整数转float32复用执行器既有float32FromBigInt以避免二次舍入。NaN真值按C/C++为真、正负零为假，!、&&、||和短路采用同一标量真值规则。runtime只增加helper命名导出，执行指令与转换算法不变，但字节变更仍要求新资源身份。

新后端为 `integration-prototype-60eb6729284e2729`，manifest SHA-256 `60eb6729284e27295b8a76121dfe569027d8c096f9580a279021d6ada08d6789`。3号自测debugger83/83（已包含专项8项和70次真实Worker观察）、真实流水线3/3、既有验收21/21与初始化6/6、契约10/10；重跑5号失败脚本为25通过、0失败、1项sizeof未支持边界，不能将边界或70查询重复加总。原失败与修复后源码/产物和oracle对照保留于 [3号交接](../handoffs/03.md) 及模块证据。

以上属于3号自测，待5号新固定提交独立签收；不宣称完整浮点、任意表达式、NaN载荷或所有IEEE异常支持。此前1号121/14仍只代表3248ad5的键盘合入阶段，不能冒充此新引擎的复验。首次候选和r2都仍绑定旧b02def身份，保留原样；4号固定粘贴修复也已随后集成，最终r3统一绑定两模块的新字节。

### 4号剪贴板固定修复已合入

4号固定 `33c16398948c102edcac4f4c794a3e1de1cb9b19` 已通过合并c14478a接入。读取先进入局部text，之后核对粘贴序号、草稿对象/编辑代次及恢复状态，再赋值保存。旧成功不能写回，旧错误不能打开手动框或覆盖新提示；手动提交同样重验上下文，复制fallback不能写稿或覆盖正在输入的手动窗口。

4号粘贴专项20/20，固定旧3248ad5对照为3通过、17预期行为失败；契约10、UI/保存106、真实集成3共119/119，专项与重复根命令不重复相加。完整实际main、真实editor/source/parser/SessionController/autosave参与检查，DOM、clipboard及CAS内存保存传输受控；没有新增真实浏览器、IndexedDB或系统剪贴板证据。CLIP-EDIT、CLIP-ORDER、CLIP-STALE-ERROR属于REV-008同一缺陷变体；CLIP-IMPORT首轮宿主失败不作为产品失败，后轮导入替换对象是通过的负对照。见 [4号证据](../../ui/evidence/integrated-clipboard-2026-10-28/README.md)。

REV-006/007/008均已修复并集成；5号c32cbf8已对各模块固定修复分支限定已测范围独立关闭，最终组合和r3完整包仍另验。root在组合后的251项检查（契约10、编译27、调试83、UI/保存106、集成3、离线22）实际251通过、0失败；原始TAP保存在app/offline/evidence/fixes-integration-2026-10-28/。旧汇总器只匹配TAP的# tests行，没有识别npm-test的ℹ格式，触发统计断言；实际npm-test原文10通过、0失败。该汇总器错误与产品测试分开保留，root用新汇总器读取原251结果并重跑强制check/test，不重复跑或混加251。最终r3绑定新后端和新main字节，归档已另验，桌面停服浏览器及严格HTTPS通过，推送待实际登记。

## 首次离线候选（保留历史，不是最终入口）

1号已将新增 `ui/SHORTCUTS.md` 纳入离线文档清单，更新根平板手册与版本元数据。新集合已生成；资源身份绑定实际字节，不能把构建基线3248ad5当作根未提交增量已在该提交中。

| 字段 | 值 |
|---|---|
| bundleId | `ipad-web-probe-d62dc8a59f565ee8ea469473` |
| 资源 | 51项，60,870,883字节 |
| 后端组合 | `integration-prototype-b02def5d2c6e7f39`，引擎资源不变 |
| Service Worker SHA-256 | `f829c487a2b1f15f39fca50b6088d5a467464ef67e59750e370ee3bf0b98f836` |
| descriptor SHA-256 | `356afdefd66a8b1e82ffd4ae4dae9cdab89ef08bd0758cd1ea44ae6f17c9e060` |

首次候选完整ZIP19,292,110字节、首次准备ZIP18,522字节已通过全成员/资源/控制面字节审计。旧package的knownOpenIssues空数组反映打包当时的记录，不能作为无bug声明；原候选和审计按时点保留。加入三项警告后另生成以下r2，不覆盖首次候选。旧标签、旧包、旧缓存入口与草稿不覆盖、不自动清理。正式兼容profile仍未选择，产品offline-bundle仍unprepared，G2/G3待验。

## 第二候选r2集合及本地归档（历史候选）

根缓存手册已补入三项问题警告。4号随后报告REV-008源码修复与19项自测通过，后续固定33c1639已合入c14478a，但该修复与309cb45均不在本r2；须使用重新构建的最终r3，本r2保留为候选而非最终入口。第二候选集合为 `ipad-web-probe-140bdf81578b308bc93faa7b`，51项、60,872,055字节；后端b02def不变。SW SHA-256为 `e009022b2ac349b0b534f4818cf66a4b85b3d460fe752206fbb1ab3972db478e`，descriptor SHA-256为 `7f78d4d5b17d311712ea44d11d9ed860bb4c5994e23175c26a213dd6322c0ec6`。

本地完整 `ipad-offline-debugger-v0.4.5-r2.zip` 为19,293,360字节、60文件，SHA-256 `06a8019c3233ab05ef0af45ea959d77dd2e1dc7e70be7cfd81eeab22940cf2d4`；首次准备 `ipad-first-setup-v0.4.5-r2.zip` 为19,203字节、6文件，SHA-256 `087ac3f26a1ca7f190133150c792a1133c43fee0f54683def824c3b87baadc7a`。生成记录位于app/offline/evidence/shortcuts-package-r2-2026-10-28/，进一步字节审计见shortcuts-audit-2026-10-28。字节核验不关闭三项产品缺陷；本地ZIP不上传GitHub，不代表二进制分发许可完成。

第二候选r2的停服后重开/新源码/按键链路、离线速查可达性、严格HTTPS以及推送结果仍由主控完成后追加，不预填通过。真实iPad、主屏、VoiceOver与5号独立验收仍待。

## 最终r3资源与本地归档

最终用于本轮固定交付的资源集合为 `ipad-web-probe-eb5236b6ed8f9aab4a9d9ced`，51项、60,874,273字节；后端为 `integration-prototype-60eb6729284e2729`。SW SHA-256 `fbc19966c4f21d2c0e5c4596ef52014ee89daac920a965d58ce2d8e24ff5cbe8`，descriptor SHA-256 `dddfee8ddf378f51262a0b4ab15c739f7c681cbe4961699da3077b42b3d81d72`。资源基线为c14478a，根手册/清单/元数据增量另由实际资源和源码指纹绑定。

| 本地归档 | 字节 / 文件数 | SHA-256 |
|---|---:|---|
| ipad-offline-debugger-v0.4.5-r3.zip | 19,294,031 / 60 | `f1877f4e031f5a46bdafab71ea5ae611a8dd74c58c7256c9ed367e92cb00c068` |
| ipad-first-setup-v0.4.5-r3.zip | 19,139 / 6 | `3d9b89e7aa7332df00d47e090a644433458d31f87089daa6494b1f732eebec3e` |

生成记录在app/offline/evidence/shortcuts-package-r3-2026-10-28/，另行审计为 [archives-r3-audit.json](../../app/offline/evidence/shortcuts-audit-2026-10-28/archives-r3-audit.json)。两档全部成员长度/SHA、51项运行资源和SW/descriptor均匹配，仅含当前release。速查匹配4号固定源码；新main、variables及runtime与c14478a和当前工作区逐字匹配；缓存手册、档内文档与当前根手册一致，列明三项修复已集成、待5号独立复验。公开证书只含单个可移除根载荷，没有私钥或越界成员。v0.4.1—0.4.4八档和d62/r2四档共12个已有ZIP长度/SHA不变。

两档ZIP保留在忽略目录，不上传GitHub；这不是IPA或正式二进制许可签收。r3的浏览器停服/新源码/快捷键/离线速查、严格HTTPS和实际推送/新PR由主控核验后另记。真实iPad、主屏、VoiceOver及独立验收仍待；knownOpenIssues列出的REV-006/007/008状态为“修复已集成，独立关闭待”，不能据字节核验直接关闭。

## GitHub交付

用户已合并 [PR #1](https://github.com/ZZZzzz-metal/IOS_compiler/pull/1)，远端main为 `9946398a1307263385dedc93bb9f1add0281c101`；它仅新增合并提交，与8cc96b3的树无差异。本轮保留该合并主线后向integration、module/04-ui及新固定标签推送，另建新PR，main仍由用户手动审核合并。本段说明交付安排，不能作为本轮推送成功证据。大型工具链、完整ZIP和TLS材料继续保留在忽略目录，用户照片不上传；完整依赖来源及许可映射仍待。

## 最终桌面验证及5号追加签收（当前结论）

1号最终r3真实浏览器记录见 [results.json](../../app/offline/evidence/shortcuts-browser-2026-10-28/results.json)。在线准备51项后停止本机4199静态服务，关闭重开固定入口检查51项；输入全新源码实际编译输出KEY045R3=6。Control数字行七动作、真实断点8、三种单步、停止、stdin焦点保护，以及标准方案F5/Shift+F5/Ctrl+F5和数字替代禁用均已实际观察；关闭重开恢复源码版本2及Control数字方案，缓存快捷键和新手册可达。r2另有完整标准七动作历史，不冒充最终r3全标准验证。截图为r3-workbench.png。电脑网络没有物理断开，独立4187静态准备服务仍运行，因此不是iPad或整机断网验收；剪贴板竞态依旧仅由受控main/autosave检查覆盖。

同电脑严格HTTPS结果见 [lan-check.json](../../app/offline/evidence/shortcuts-package-r3-2026-10-28/lan-check.json)：CA和IP身份验证、entry200、SW/descriptor摘要、私有路径404均通过。入口为https://100.65.235.35:4187/releases/ipad-web-probe-eb5236b6ed8f9aab4a9d9ced/index.html；iPad实际互访仍待。证书2026-11-02北京时间09:29:59到期，用户自行按手册决定信任，不绕过浏览器警告。

随后5号交付c32cbf82250593d11ed3c1e107961636b3a61a8c，已通过222e30a合入，仅增加测试和交接文档，没有改变r3运行资源字节。REV-006/007在3号固定309cb45的已测桌面范围独立关闭：同一源码/38373字节Wasm、25通过0失败1项sizeof边界，原11错归零。REV-008在4号固定33c1639的受控并发语义范围独立关闭：同一8场景25断言，旧3通过5行为失败，新8/8场景25/25断言通过。CLIP-IMPORT首轮宿主错误及后轮负对照按原样保留。

独立报告为 [监视复验](../validation/floating-person05-309cb45-2026-10-28.md)、[粘贴复验](../validation/clipboard-person05-33c1639-2026-10-28.md)、[原基线并行复查](../validation/parallel-review-3248ad5-2026-10-28.md)。这些结论不扩张为最终组合、r3完整包、真实系统剪贴板/IndexedDB、iPad、REV-001浏览器离线恢复或G2/G3验收。r3归档中的待复验字段为打包时记录；本段更新模块固定分支签收，不改旧包，也不宣布最终组合独立通过。
