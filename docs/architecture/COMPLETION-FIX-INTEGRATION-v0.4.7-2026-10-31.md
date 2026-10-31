# 代码提示两项已知问题修复集成

2026-10-31，目标0.4.7。用户要求先修好已知问题再真机。本记录按阶段追加实际结果；当前修复已合入，5号独立语义及新完整包验收仍待，不提前关闭缺陷。

## 已合入固定交付

2号最终DONE为0f289cf0de5aafc80cafc7c06fd669f95b85d873，含实现6da3280b3fa9aa859188a26a6b12f578151401a4。实现变更373文件全部compiler范围，后继只追加02交接。原vendor、toolchain.lock和普通完整编译路径不变。根已合入两提交，并把新completion-semantics.mjs加入candidate；完整包清单也将带上配方说明和.cpp.patch，保持离线说明链接完整。三个Worker路径未变。

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

两条原失败独立实过后再更新能力/手册和4号离线说明，生成全新的0.4.7不可变包并单独做停服冷开、全新代码补全/撤销/编译调试/草稿恢复。最终新包未验前PR #4保持草稿，真机继续暂缓。旧v0.4.6标签、包、缓存、失败及LIMITED-DESKTOP ACCEPT仅作历史保留；main仍由用户手动合并。
