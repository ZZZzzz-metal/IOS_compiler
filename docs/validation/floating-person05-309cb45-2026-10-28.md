# 5号独立复验：混合浮点与NaN监视修复（2026-10-28）

固定受测产品为3号 `309cb45191a62fde2b13eeab9746a8d2502ef658`，父提交为原失败基线 `3248ad54faa5f0f3a8b6f6501829e95e4699f066`。**两条新P2在该固定分支的已测桌面范围独立复验通过。** 这不表示原基线或下一完整离线发行包已经包含并通过修复。

1号统一编号为REV-006（混合浮点转换）与REV-007（NaN真值/短路）。本报告给出这两条问题的限定独立关闭证据。

5号保留自己的工作区和原始失败证据，只读导入3号固定工作区中的完整实际编译/调试产品。执行前后3号工作区均干净，HEAD为同一提交、受测产品与提交无差异。没有修改3号产品、资源身份、共享能力表、旧标签或原失败输出。

## 同一程序的独立前后对照

使用5号 `tests/watch-types-independent.mjs`，仅增加显式产品根目录、固定revision/profile守卫与新输出位置；26条表达式观察及生成的C++17源码保持不变。脚本直接使用受测工作区的CompilerAdapter、产物持久化与隔离WorkerDebuggerAdapter，以同一实际Wasm的原生运行结果作为oracle，没有注入PC、变量、内存、暂停或返回值。

| 检查 | 原3248ad5 | 新309cb45 |
|---|---|---|
| 专项实际观察 | 14通过、11失败、1范围记录，exit 1 | **25通过、0失败、1范围记录，exit 0** |
| float32/整数混合7处 | 运算或比较返回错误available值 | 全部与真实C++一致，包括两侧顺序、减法、除法、比较及long long混合 |
| NaN布尔/短路4处 | !、\|\|、&&错误；本应短路的除零被执行 | 全部正确；NaN为真，`nanValue \|\| (1/zero)` 返回1且不计算右侧 |
| 同一源码与产物 | sourceHash 8f4ea167…；Wasm 38373字节 | sourceHash及源码/Wasm字节完全相同 |
| 程序输出 | 原生与解释执行输出一致、exit 0 | 与旧程序原生输出逐字相同，解释输出仍一致、exit 0 |

完整sourceHash为 `sha256:8f4ea16786be3da29608a1034506eb34c2685b8d6d268e9b057942fa3a176161`；2380字节source.cpp的SHA-256为 `a781aa556e582cbeecd61aa561a9dc388ee8640ac7c82d3782572d893880015f`；Wasm SHA-256为 `67b3504d64da47a6b0feb495aa6338f89c3f1056d197016f758295bb11ef95e4`。前后错误变化没有依赖更换输入程序或产物。

旧REV-002的八进制与无符号环绕、REV-003合法指针偏移、整数提升/比较及一元float样例仍通过。p+q与p-q继续明确unsupported；指针差值没有因此实现。sizeof继续只记录未开放范围，不作为通过项或新缺陷。

## 独立回归与身份

本次5号实际执行并另存5条命令，全部exit 0：上述独立监视脚本、`npm.cmd run check`、`npm.cmd test`、`node --test --test-reporter=tap debugger/checks/*.test.mjs`、`npm.cmd run test:integration`。原始日志验证调试器 **83/83**、契约 **10/10**、真实CompilerAdapter→Worker流水线 **3/3**，均无失败或跳过。83项包含3号新增专项，属于模块回归；5号独立监视25项另列，不膨胀为用户验收数量。check确认29项能力记录结构通过，完整产品离线状态仍NOT READY。

受测开发组合为 `integration-prototype-60eb6729284e2729`，resourceManifestHash为 `sha256:60eb6729284e27295b8a76121dfe569027d8c096f9580a279021d6ada08d6789`。variables.mjs实际SHA-256为 `9f5d827a927414d34fe5af62bf2583e1531321e9d9d7c8e39d7e99458b96c88e`。运行时因增加命名export也有新实际身份，不能继续沿用旧b02def5d组合。

新证据独立保存在 `tests/evidence/integrated-person05-floating-309cb45-2026-10-28/`：原始命令/退出码/日志、实际执行runner副本、源码/Wasm/完整查询与事件、前后比较和 `verification.json`。封存前发现汇总脚本原先误读build.sourceHash，导致comparison.json漏写该元数据字段；原输出保留，`verify-results.mjs`另行严格验证snapshot及build的实际sourceHash、已知完整hash、原始字节与全部命令输出。正确字段已在verification.json记录，原执行脚本另存rerun-executed.mjs，修正后的rerun.mjs供后续参考。该元数据采集修正没有改变产品、专项断言或原始结果。

## 交接与限制

本轮确认3号两条监视求值问题在固定修复分支的具体已测范围修复。1号仍需合入并按新的实际资源字节生成新组合及不可变离线包；集成与发行验证另存新证据。4号剪贴板竞态不在本次受测修复内，不能由这份通过结论关闭。

环境为Windows、Node v24.19.0，本次没有浏览器、真实iPad或系统断网操作。真实iPad完全离线、正式界面与草稿可靠性、安装/升级/驱逐、强杀/配额、实体键盘/中文/触控/后台及G2/G3仍待验证。最初21项中20通过1失败、另发现VAL-002及后续各轮历史原样保留。
