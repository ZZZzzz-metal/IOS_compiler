# CC-20261030-02 修复证据（2026-10-31收尾）

本目录是2号自测与研究，不能当作5号独立签收、浏览器完整包或iPad通过。旧 `completion-2026-10-29/`、5号原失败、旧包及标签未修改。

当前执行：补全使用 `binji-wasm-clang-648c4a89997a+completion-semantics.1`，派生31,214,494 B，SHA-256 `b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901`；完整编译仍用原31,214,472 B，SHA-256 `2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d`。见 [固定配方](../../resources/completion-semantics-v1.md)。

| 证据 | 内容与结果 |
|---|---|
| `verification/check.*`、`contracts.*` | mandatory check exit0；契约10/10 |
| `verification/compiler.*` | 编译模块56/56，含既有真实编译/链接/执行、取消回归；新增完整性、const静态模板、同名const/nonconst重载、unavailable/deleted合法混合重载、deprecated、别名/指针、继承/重声明/using与driver/user.inc |
| `provider-2026-10-30T15-14-47-780Z-db4f90bb/` | production engine +实际Node Worker的31查询、原始请求/native/stdout/stderr/结果；真实取消、释放、重启，4个Worker全部释放；const string与unavailable均改为正确修复预期 |
| `controls-2026-10-31T02-05-39-735Z/` | 冻结5号PREP `bef7bc973780e55d5eecdcdfc0e7da1c3d1c6fad` 原文件不变；随机nonce，11查询逐候选oracle通过、24真实编译控制通过，合法调用执行exit0，deprecated警告保留，非法调用有指定unavailable/const诊断。只是2号复跑，后续由5号固定目标独立复验 |
| `verification/repair-controls.*` | 首次脚本Worker URL类型错误exit1，未进入语义执行，保留 |
| `verification/repair-controls-v2.*`、`controls-2026-10-31T02-05-09-509Z/` | 脚本误要求const说明在error行；实际Clang错误为no matching member、const原因在候选note，原文保留。v3按error存在且note明确const语义检查后通过；没有改5号oracle |
| `binary-2026-10-30T15-07-44-888Z/` | 组合派生的19个原生观测/断言全部通过；availability逐重载、命名空间、别名、using、继承、函数模板、字段、枚举、重声明等 |
| `const-binary-2026-10-30T15-07-57-521Z/` | const补丁8/8：const/mutable string、模板、static、volatile、别名、返回表达式与availability；原始function40648反汇编及插入配方 |
| 其他 `probe-*`/`availability-*`/`semantic-*`/`binary-*`/`const-binary-*` | 前期原始工具链与AST/错误方案可行性研究，不把这些记录当产品修复通过 |

大型AST/函数索引采用无损gzip，原始SHA、长度、归档SHA及解压回读检查记于 `large-ast-archives.json`、各 `report.archive.json` 或 `compression-manifest.json`；原始文本可精确恢复。`SHA256SUMS.json`绑定本目录其余所有文件的实际字节；`.gitattributes`禁止Git换行转换。

复现命令：`node --test --test-reporter=tap compiler/checks/*.test.mjs`；`node compiler/experiments/completion-2026-10-29/verify-provider.mjs`；`node compiler/experiments/completion-fix-2026-10-30/verify-repair-controls.mjs <5号checkout>`。后二者每次写新目录。源码重建/来源与许可映射缺口仍为原记录的false；此次可复现二进制派生没有消除这些缺口。
