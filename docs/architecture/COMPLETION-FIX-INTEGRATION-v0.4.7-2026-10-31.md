# 代码提示两项已知问题修复集成

2026-10-31，目标0.4.7。用户要求先修好已知问题再真机。本记录按阶段追加实际结果；当前修复及5号独立语义DONE已合入，两条缺陷在原判定的已测语义范围关闭，新完整包及iPad验收仍待。

## 已合入固定交付

2号最终DONE为0f289cf0de5aafc80cafc7c06fd669f95b85d873，含实现6da3280b3fa9aa859188a26a6b12f578151401a4。实现变更373文件全部compiler范围，后继只追加02交接。原vendor、toolchain.lock和普通完整编译路径不变。根已合入两提交，并把新completion-semantics.mjs加入candidate；完整包清单也将带上配方说明和.cpp.patch，便于离线阅读配方及逻辑补丁。配方引用的反汇编研究证据保存在Git仓库，不随运行包附带；不宣称所有研究链接可离线打开。三个Worker路径未变。

修复在补全专用内存副本中让成员模板进入Clang原有static/const/volatile检查，并标记不可用声明，使既有解析器按每条候选过滤；普通、deprecated和合法重载保留。没有名称黑名单，没有关闭成员提示，也未修改5号原失败预期。

## 身份与范围

| 项目 | 身份 |
|---|---|
| 新后端profile | integration-prototype-c3e9a2fea60c51b3 |
| 后端资源 | 36项，新增completion-semantics.mjs |
| 补全toolchainId | binji-wasm-clang-648c4a89997a+completion-semantics.1 |
| 补全实际派生Wasm | 31,214,494字节 |
| 补全compilerResourceHash | sha256:b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901 |
| 原始/普通编译Wasm | 31,214,472字节，sha256:2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d |

原长度/全SHA、精确指令和header先校验，复制后插入22字节并修正body/code-section长度，再检查结构、Wasm有效性与派生全SHA才编译。结果字段报告实际派生hash和ID，adapter校验它们；普通编译profile继续绑定原Clang。源码重建与完整来源/许可事实仍未解决，本次是可复现的二进制派生，不冒称源码重建。

## 已有证据

2号自测：契约10、compiler56、生产31查询/取消释放，另按5号冻结准备随机命名的11查询/24真实调用控制通过。const负调用的语义原因可在候选note中，保留error和关联note；先前Worker路径及诊断匹配脚本失败完整保留。2号自测不代替独立关闭。

根只读复核355封存文件及清单与固定Git原字节一致，12运行指纹匹配；18大型gzip映射解压长度/SHA一致，另一个直接生成的函数索引亦有效。新增文件约22.35MB，最大3.76MB为研究报告压缩件，无新工具链大blob；文本及解压材料未发现凭据、私钥或IPv4。没有运行会重写材料的一次性seal脚本。

根新candidate/prepare-ui完成，既有真实编译调试流水线3/3通过（C++17断点/单步/变量/递归、C11输入/内存、无限循环停止后新Worker），mandatory check/test退出0。命令在根资源映射提交前执行，运行源码固定于2号交付，映射输入指纹另存并在提交后核对。原始输出和资源摘要在app/integration/evidence/completion-fix-backend-2026-10-31。

## 独立验收与后续

5号已正式获准按固定0f289cf执行修复语义阶段，独立从原blob和完整结构化配方派生全SHA并核对新结果身份，保持原30后端例、额外unavailable、11扩展及调用正反对照、生命周期与坏身份拒绝。const静态模板/deleted混合重载另加。旧33与全部exit1不改；3个UI负例的旧范围与本轮结果分开。

5号固定2978d9501c58fe7b6d7d7439b5f728a0b59ccbf6已合入e00566b27fb6ee2256f318811376d2e95e67cb3f。845变更均属5号；831新封存文件及清单由根再次verify --git，原字节一致。原30后端、原extra1、随机11及后加static/deleted2共44逻辑、88真实双路响应全通过；27完整编译控制全过，10负例准确匹配4 const、5 unavailable及1 deleted语义原因。18派生/完整性中5项合成身份控制单列；7生命周期场景25检查、主21/最小2/初始化6、31基础设施及强制check/契约10通过。输入与34个成功二进制产物的独立只读后审未发现空跑或计数混淆。详细范围见[5号报告](../validation/completion-fix-person05-0f289cf-2026-10-31.md)。

const-string及extra的源码、offset、sourceHash与原oracle不变，本轮正确保留可调用项并排除原非法项。同名混合重载逐签名判断，合法deprecated/ordinary/static候选和实际编译正例保留。原33中的3个UI自动负例有先前固定UI证据，本语义阶段没有重新执行浏览器，不能写成本轮33次UI实测。

4号DOC-DONE b33b52e8616fef0171f49ab2f22f7c5cbb8306d9只改ui/COMPLETION.md，根已合入，UI运行字节不变。版本/手册与能力说明更新到0.4.7，能力状态继续implemented-unverified；手册补去过时的监视待验状态，明确iPad仍须实测。完整包纳入新语义模块、配方和逻辑补丁，在线与离线.patch均作为文本阅读。

下一步生成全新的0.4.7不可变包，单独做停服冷开、全新代码补全/撤销/编译调试/草稿恢复。最终新包未验前PR #4保持草稿，真机继续暂缓。旧v0.4.6标签、包、缓存、失败及LIMITED-DESKTOP ACCEPT仅作历史保留；main仍由用户手动合并。

## 新0.4.7包已生成，实际浏览器另验

固定包源码912a23bf14cd6e48a0adb7ec119f4ce86bc58f93；bundle为ipad-web-probe-4b6a8377cadd31e675701549，65资源60,976,781字节，后端36资源身份不变。SW SHA为6900d0dd90e0ef6cdff3d891316251cc3e2c70924d3d26c870e8bc51e3271ac5，descriptor SHA为e9791ceb17df941d32f31e4dfc7216c75b5aba877f4492a404a8bb4e38c2870d。

| 归档 | 字节 / 成员 | SHA-256 |
|---|---|---|
| ipad-offline-debugger-v0.4.7.zip | 19,337,572 / 74 | 6cc808248baaca8e1107de49d71458fd2140f8c83cd3bbb8810598351abc330d |
| ipad-first-setup-v0.4.7.zip | 18,056 / 6 | 0958fef87a5871c8c9a4edfc23f10a9b929888f2898da370dfbfdd981351d18f |

归档工具实际生成后又以verify-existing只读核验。65资源全部长度/hash及控制面通过；58份固定Git原字节、4份锁定大型资源、3份生成内容，手册在两ZIP/运行包/固定Git原字节完全一致。并行只读审阅额外核对51条静态相对导入封闭、三个Worker、独立canonical后端manifest重算及单根证书配置。16份旧ZIP逐项保持不变；原Zip、标签和缓存未覆盖。研究证据链接仍属Git材料，不随运行包附带。

根mandatory check/test及离线23通过；在实际Wi-Fi接口以显式CA和正常主机名检查逐项取得65份HTTPS资源并核hash，入口/SW/descriptor/补丁媒体类型及私钥路径404通过，未改系统证书信任或防火墙。最初沙盒EACCES、获准直接检查发现旧进程已停ECONNREFUSED，均不冒称产品失败或成功；新建本项目静态服务后实际通过。证书当前有效，但真机开始时重新核对地址和有效期。

已向5号发送固定包PACKAGE-FINAL并得到明确ACK；其使用独立localhost服务验停服冷开、新源码两项修复可见行为、确认/原生撤销、编译调试值及草稿/方案恢复。当前未收到PACKAGE-DONE，不提前写成通过。根字节与HTTPS证据在app/offline/evidence/completion-fix-package-2026-10-31；平板操作见[0.4.7准备单](IPAD-UPDATE-v0.4.7.md)和[完整手册](IPAD-USER-MANUAL.md)。
