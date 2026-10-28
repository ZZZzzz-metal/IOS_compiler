# v0.4.5合入与首次候选包审计

日期：2026-10-28（北京时间）。下列archives-audit.json对应首次d62候选，不是最终r2；它在三项新缺陷和缓存手册警告更新前做字节核验。原审计/旧包保留，knownOpenIssues空数组不代表无bug；r2另有审计文件。本目录只新增审计脚本与结果，不修改产品、旧文档、原始模块证据或ZIP；没有POST、推送或合并动作，整体SHA封存由1号最后执行。

- `audit-delivery.mjs`核对4号309d29d相对父提交的30文件范围（ui及04交接），三份清单27条引用、19个唯一目标均按固定Git blob长度/SHA匹配；10份源码指纹匹配提交和合入后的实际字节。HTML/CSS两处工作区CRLF/LF差异按4号已披露记录保留，提交规范化字节正确，不伪称工作字节完全相同。
- 合并后121/121原始TAP、npm check/test退出码和另列14/14受控UI结果核对通过，0基础设施失败。5号原脚本Git与工作区字节相同；root-owned宿主适配副本与适配清单SHA相同，两个原始结果副本也通过长度/SHA。宿主适配不作为5号独立签收或浏览器/iPad证据。
- `audit-archives.py`核对v0.4.5完整包19,292,110字节、60文件，SHA-256 aebdbd56183939742dff98e0b869eed42fadf70c4c94ae49456b92b3343a3692；首次准备包18,522字节、6文件，SHA-256 a29cc8fd8915e284f9c77a681f36b7504526aba7e952ea61a678898568d7ad4f。两档全部成员清单校验通过，51资源/60,870,883字节以及SW/descriptor逐项匹配，仅含本轮release；速查匹配4号固定提交，运行手册、档内文档和当前总手册逐字一致。公开证书只有单个可移除根载荷，未发现私钥载荷或越界成员。
- v0.4.1—v0.4.4八个旧ZIP的长度/SHA与旧已跟踪package.json的Git blob记录完全一致；没有覆盖旧包或旧标签。
- `git-publication-audit.mjs`检查全部可达历史与当前拟发布文件的有限令牌/私钥头/密码URL/敏感文件名和100MiB阈值；四个大型工具链、两档新ZIP和TLS私钥/公开配置8项均被忽略且未跟踪。准确快照范围、体积、对象数和命中见JSON。新临时tests/evidence/integrated-person01-shortcuts-host-2026-10-27目录排除，原始副本已保存在root-owned证据。
- `audit-photo-exclusion.mjs`只读计算用户原键盘照片的内容身份，对比全部可达Git对象及当前发布清单，未发现相同照片内容或文件名；不复制照片、不在报告写原照片内容hash。

有限扫描首次命中的是本目录归档审计源码内用于检查私钥头的字面测试字符串，不含私钥内容，见initial-pattern-finding.json。运行时相同检查改用字节片段组装，避免扫描器匹配自身；最终有限检查结果以git-publication-audit.json为准。这不是安全认证、完整机密发现、二进制许可清查、5号独立验收或真实iPad/G2/G3验收。

本目录生成期间主控仍会追加浏览器证据和交付文档；发布清单属于带时间的检查快照，最终源码/证据由主控封存。原始结果分别见delivery-and-checks-audit.json、delivery-manifest-targets.json、archives-audit.json、git-publication-audit.json、photo-exclusion.json。

R2另行结果见archives-r2-audit.json及audit-archives-r2.py：两档所有成员、51项资源/60,872,055字节和SW/descriptor全量匹配，缓存手册包含三项问题的用户警告，档内更新说明列明REV-006/007/008；原八个旧ZIP及首候选两档共10档长度/SHA不变。r2仅增加警告，没有修复产品问题；4号后续报告的粘贴修复尚待固定提交集成，r2仍为候选，后续最终包需重建。本追加不改首次archives-audit.json或原候选报告。

R3最终本地包另验见archives-r3-audit.json及audit-archives-r3.py：完整19,294,031字节/60文件，首次准备19,139字节/6文件；51资源60,874,273字节与两控制面全匹配。新main/variables/runtime与c14478a及当前字节一致，速查/手册/公开单根配置一致。三项修复已集成待5独立关闭，旧8ZIP加d62/r2四档共12档不变；r3精确路径ignored且未跟踪2/2。251原文和npm-test10原文的实际通过计数见integrated-251-raw-audit.json，旧汇总器格式错误不记作产品失败。r3不改变旧候选与旧audit JSON，仍不证明真实iPad、分发许可或独立签收。

5号随后交c32cbf8并已合入222e30a：REV-006/007与REV-008分别在模块固定修复分支的限定范围独立关闭，最终组合/r3包的独立签收仍另列。本目录不改打包或浏览器记录的既有时间点结论。
