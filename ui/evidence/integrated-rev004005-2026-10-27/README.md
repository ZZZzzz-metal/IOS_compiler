# REV-004 / REV-005：四号修复与开发自测

日期：2026-10-27（Asia/Shanghai）。来源为1号聊天最新结论、DEEP-REVIEW-2026-10-27.md与REVIEW-UI-2026-10-27.md。固定基线integration-v0.4.2：9727c51915325732e8d1b365f5e9bf672c717aaf；合并至四号浅色样式分支的提交为f57f7d7。原复现、旧失败、旧包与标签均保留。

## 最终结果

结构检查通过；契约10/10、UI/storage59/59、真实集成3/3，共 **72/72** 通过。原始输出在automated-final/，该目录SHA256SUMS.json由verify-probe.mjs生成。automated/保留较早一轮69/69结果，早于补强失效读取错误的草稿代次判断，不作为最终运行。

新增25项正确行为回归：REV-004有8项，REV-005有17项。使用同一套最终测试读取固定旧样式源码b9ed5d1时，3项通过、22项按预期失败，见baseline/old-behavior-final.tap；不存在ReferenceError/SyntaxError造成的假阳性。baseline/old-behavior.tap是补强前22项的对照（3通过、19失败）。这些失败是证明旧缺陷可被检出的对照，不能记成旧版本通过。

```powershell
$env:UI_EVIDENCE_DIR='ui/evidence/integrated-新的唯一目录'
node ui/scripts/verify-probe.mjs
# 只用于历史缺陷对照，预期退出非零；不要混入正式通过结果
$env:UI_REVIEW_REF='b9ed5d1'
node --test ui/checks/import-order.test.mjs ui/checks/preparation-gate.test.mjs
Remove-Item Env:UI_REVIEW_REF
```

## 确定性竞态回归的范围

测试从当前main.mjs取实际处理器/函数执行，没有另写一套正确逻辑替代应用。DOM、网络、File.text Promise、编译调试传输及store传输为可控替身；parseImport和createAutosave使用真实模块，store记录真实自动保存收到的内容并检查revision CAS。它们验证的是UI编排，不是浏览器IndexedDB耐久性、资源完整性绕过、真实编译或iPad表现。

- REV-005：A/B逆序完成仅B进入保存；旧成功/错误/finally不能覆盖新稿、后选文件或提示；等待时编辑源码/输入/语言、切换草稿、同ID替换及恢复均得到保护；过期错误不覆盖新操作提示；真实parser处理源码与完整JSON、最新格式错误保留原稿。
- REV-004：首个await前同步锁住运行/调试/准备；编辑重绘不解锁；重复prepare无第二请求；编译入口直接检查真实状态；HTTP/网络/信任/资源失败清除旧candidate并可重试；活动会话/编译/恢复/未恢复状态拒绝进入；单次编译捕获的组合贯穿构造、编译、产物交接及会话启动；停止后不启动旧结果。

## 真实桌面浏览器

browser/serve-delayed-prepare.mjs是仅绑定127.0.0.1:4204的静态测试宿主。实际页面、模块、30项工具链资源、File.text、IndexedDB及编译调试适配器没有被替换。宿主仅让candidate响应延迟4秒，并在第三次请求返回503，以便观察真实交互；不是发布宿主或产品离线验证。

browser/browser-results.json记录可见DOM采样：

1. 首次准备时三个入口立即disabled，executionState为preparing。
2. 使用真实文件选择器导入import-source.cpp，源码与文件相符，实际显示保存版本1。
3. 已准备后再次校验，编辑源码引起重绘并按F5，三个入口仍disabled、状态仍preparing；成功后解锁。
4. 第三次candidate请求503，运行/调试保持disabled、准备可重试，资源栏明确未就绪；重试成功后解锁。
5. 导入程序真实输出27、返回27；重开保留附加注释的源码及保存版本2。最终源码重载后重新校验、再运行仍输出27并返回27，见fixed-execution.jpg。

prepare-failure.jpg保留失败时画面。真实文件选择器操作明显耗时，未据此给出iPad耗时或性能结论。浏览器一次等待文字可见的调用超时，紧接的DOM读取确认校验已成功；没有把该次超时当作通过或失败的程序行为。File.text乱序未在浏览器内注入，乱序保障来自前述受控回归。import-project.json是自动生成的完整草稿样例，本轮浏览器未使用；完整JSON由自动回归验证。

source-inputs.json记录最终测试输入的工作树与Git暂存字节指纹。根SHA256SUMS.json覆盖本目录普通文件（自身除外），保留两个自动运行的独立清单。baseline原始TAP中的缩进空行保持报告器输出，专用.gitattributes关闭该生成记录的空白检查，未清洗日志字节。

结论为四号已修复并自测通过，待1号合入、另建不可变离线包、5号独立复验。3号REV-002/003、真实iPad、物理断网、软键盘、系统驱逐与G2/G3均不在本结论中。
