# 两次合入后的桌面集成检查

日期：2026-10-27（北京时间）。目标提交 `dc65469c85616f175a735b9977cb37f8c6f188c2`，包含 5 号 `d12aad0` 独立材料及 3 号 `21f2135` 监视语义修复。

环境：Windows x64，Node.js v24.19.0。命令与退出码见 `run-summary.json`；额外实际运行的 `npm.cmd run check` / `npm.cmd test` 见 `npm-summary.json`。所有命令退出码均为 0，所有测试无失败、取消或跳过。

| 检查 | 结果 | 计数说明 |
|---|---:|---|
| 基线结构检查 / npm run check | PASS，资源状态预期 NOT READY | 正式产品能力不因此变成就绪 |
| npm test（契约） | 10/10 | 已包含于下方 196，不再重复相加 |
| 合并 Node 检查 | 196/196 | 契约 10、编译器 27、调试器 75、UI/存储 59、集成 3、离线 22 |
| 既有独立验收脚本 | 21/21 | `validation-raw/independent.json` |
| 同名遮蔽与循环头复现 | 2/2 | 两个 regression JSON；本次遮蔽夹具内层 19、外层 7 |
| 初始化生命周期 | 6/6 | `validation-raw/initializer-lifetime.json` |
| 新独立 UI 竞态脚本 | 14/14 | 无基础设施失败；`validation-raw/independent/run-01/results.json` |

调试器 75 项中已包含新的 watch 语义父测试及 7 个子测试（Node 计数为 8），其中 70 次实际监视查询不能再作为 70 项额外通过数。八进制、指针和 float32 一元符号断言均通过。指针相减仍明确报告不支持，不能写作已支持同数组指针距离求值。

编译/调试和既有验收使用新编译的真实 Wasm，覆盖直接解释执行和 Node Worker；本次没有断网。新增 UI 14 场景运行真实完整主模块、解析器、自动保存和编辑器辅助代码，但 DOM、File.text、网络、编译/调试传输及存储传输受控，不能作为浏览器、IndexedDB 持久化或 iPad 证据。

这是 1 号合并后重跑 5 号脚本的结果，不替代 5 号对新调试器/完整新缓存包的独立签收。本次不包含浏览器离线冷启动、真实 iPad、G2/G3 或第三方分发许可确认；能力表不变。

`validation-raw/` 是新建 `tests/evidence/integrated-person01-publication-v044-2026-10-27/` 的逐文件原始副本，保留其中目标提交、命令、源字节指纹和观察值。只归档这次新输出，不修改历史证据。`SHA256SUMS.json` 校验本目录除其自身外的所有文件。`run-checks.mjs` 拒绝覆盖同名运行目录，重新运行需改用新目录。
