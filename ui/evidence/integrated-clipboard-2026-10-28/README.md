# REV-008 剪贴板竞态：四号修复证据

日期：2026-10-28（北京时间）。基线为已提交集成3248ad54faa5f0f3a8b6f6501829e95e4699f066。四号复用干净工作区并快进到该提交；只修改ui/及自己的04交接文件。

## 问题与修复

原main的赋值左侧在await之前求值。对同一draft对象，旧readText返回后会覆盖期间新编辑的源码，真实autosave还会将覆盖内容写入下一revision。先发粘贴覆盖后发粘贴，以及旧错误重新打开手动框，是同一问题的变体。

修复在发起读取时捕获请求序号、草稿对象、编辑代次，先读入局部text，再核对最新请求、同一对象/代次及非恢复状态。旧成功不写入；旧错误不打开fallback或覆盖新提示。最新成功遇到草稿修改时明确提示保留当前内容、重新粘贴。手动fallback保留同一上下文，提交时重验，取消后清空；复制窗口不能写回草稿，迟到复制fallback不覆盖已经打开的手动窗口。

## 原始证据边界

- 五号原始记录位于其tests/evidence/integrated-person05-parallel-review-3248ad5-2026-10-28/ui/，未修改或复制覆盖。
- clipboard-run-01的CLIP-EDIT确认覆盖；CLIP-IMPORT为harness-failure，不能当成已证实导入覆盖。
- clipboard-run-02为正确行为断言：CLIP-EDIT、CLIP-ORDER、CLIP-STALE-ERROR三失败，同一缺陷；正常粘贴、后续导入替换draft对象两个负对照通过，exit1且无基础设施异常。后续导入路径不是已证实数据覆盖，本轮只增加防止旧读取额外保存/切换视图的预防性守卫。

## 检查结果

clipboard-order.test.mjs执行完整实际main，只移除其九条import并注入真实依赖；没有复制或修改生产处理函数。parser、editor、source、SessionController和createAutosave均为真实实现；DOM、clipboard、动画调度及带revision CAS的内存保存传输受控。对照模式核对四个关键依赖与旧提交相同。

- before-3248ad5.tap：20项，3通过、17预期行为失败，exit1；没有缺失新helper、语法或等待超时异常。这些是同一缺陷及防护回归，不是17个独立产品缺陷。
- after-targeted.tap：同20项全部通过，exit0。
- 覆盖已保存源码编辑、stdin/语言/driver编辑、A/B两种完成顺序、B等待或成功后的旧错误、编辑后的旧错误、正常/空内容、手动提交/取消、导入与恢复时失效、复制窗口和已有手动粘贴的隔离。源编辑场景保存版本保持2，没有第三次旧内容写入。
- npm-check.txt与npm-test.tap：按仓库要求运行npm run check、npm test，均成功。
- automated-final/：结构PASS；契约10、UI/storage106（含新增20）、既有真实编译调试集成3，共119/119。targeted及npm重复项不再次计入总数。SHA256SUMS.json为该子目录原始清单。

run-evidence.mjs保存前后对照、根命令与完整检查输出；拒绝覆盖既有comparison/自动证据。重跑应使用新目录，不能覆盖本目录。根SHA256SUMS.json封存本目录其余文件；source-inputs.json及source-stage-verification.json绑定测试读取的工作区字节与暂存字节，仅允许CRLF到LF归一化。

本轮没有新增真实浏览器、IndexedDB或系统剪贴板实测；手动dialog.close为受控同步事件，不代表浏览器事件时序。真实编译链仍由既有三项集成检查执行。本记录是四号自测，不替代五号独立复验、新离线包或真实iPad验收。1号须合入固定提交、重新生成新main字节的不可变包并验证后推送；历史包、标签、缓存和草稿保留。
