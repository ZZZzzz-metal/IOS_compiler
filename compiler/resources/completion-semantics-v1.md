# 固定 Clang8 补全语义修正 v1

本修正只用于代码补全的 Clang Module：先校验原始工具链资源，再执行确定的内存变换，并校验派生字节与 Wasm 结构。普通编译继续使用原始 Clang。原始 vendor 文件、资源锁定清单、旧失败与旧发布包不覆盖。

| 身份 | 字节数 | SHA-256 |
|---|---:|---|
| 原始 `clang` | 31,214,472 | `2a466f0e990329d3230b869d04fc20803eae96a7feb3a3f6c93e25a77b8aed1d` |
| 两项修正后的补全 Module 字节 | 31,214,494 | `b15c58339d3428cb6b75448bfcf1624ee48521654bde2684d239d170836fb901` |

派生字节只适用于上述精确原始输入。任何哈希、上下文指令、函数体或代码段长度不符均应失败，不能对未知编译器继续尝试偏移修补。原始输入由原 lock 与配方 `sourceHash` 绑定；**CompletionResult.compilerResourceHash 报告实际执行的派生字节全 SHA**，即上表第二行，toolchainId 为 `binji-wasm-clang-648c4a89997a+completion-semantics.1`。完整编译结果仍报告原始资源身份。补全实现及其变换模块还必须由新应用资源组合和固定发布包覆盖，旧包不能借用新结论。

## const / volatile 成员模板

LLVM 8.0.1 的 `ResultBuilder::AddResult` 直接对 `R.Declaration` 执行 `dyn_cast<CXXMethodDecl>`。成员函数模板的声明是 `FunctionTemplateDecl`，原检查没有进入其模板方法，因此 const 接收对象仍得到非 const 模板候选。修正仅在已有 `HasObjectTypeQualifiers` 分支内解包局部方法指针，再执行原有实例方法和限定符规则。`R.Declaration` 本身不改，后续签名构造仍得到完整模板声明；静态方法也继续通过原有静态检查。

定位依据来自锁定字节的实际反汇编，而非候选名称：Wasm function `40648` 的参数为五个 i32、无返回值，包含 using 声明的自递归分支、嵌套名称优先级 75、结果记录步长 56 和限定符匹配优先级减一，顺序与官方 `AddResult` 一致。其原有 `isConstructor` 分支已经检查声明 kind 25、读取声明 `+24` 的模板目标，并检查目标 kind 51。由同一函数中的这些既有指令确认 `FunctionTemplateDecl` 的 kind 与目标偏移。限定符分支的原始方法 kind 检查覆盖 50–53，之后调用既有静态检查和类型限定符函数。

在原始偏移 `0x11e7953`（十进制 18,774,355）插入以下 22 字节：

```text
20 02 28 02 10 41 ff 00 71 41 19 46 04 40 20 02 28 02 18 21 02 0b
```

```text
local.get 2
i32.load align=2 offset=16
i32.const 127
i32.and
i32.const 25
i32.eq
if
  local.get 2
  i32.load align=2 offset=24
  local.set 2
end
```

插入点位于 `R.Declaration` 非空检查之后、原有 CXXMethod kind 检查之前。局部变量 2 随后进入原有 static/instance/qualifier 检查。原函数体长度从 1,400 变为 1,422；代码段长度从 25,177,807 变为 25,177,829。只更新这两个 ULEB 长度字段；函数索引、调用表、内存数据地址和原有分支深度不变。

关键原始反汇编见 [function-40648.txt](../evidence/completion-fix-2026-10-30/const-binary-2026-10-30T15-07-57-521Z/function-40648.txt)，变换和实际输入/输出见同目录 [patch.json](../evidence/completion-fix-2026-10-30/const-binary-2026-10-30T15-07-57-521Z/patch.json) 与 [summary.json](../evidence/completion-fix-2026-10-30/const-binary-2026-10-30T15-07-57-521Z/summary.json)。这些初始实验的 8 项断言通过，覆盖 const/mutable string、const/mutable/volatile 模板方法、静态方法、别名、const 返回表达式及 availability；后续生产适配器和独立验收结果另行记录。

## unavailable / deprecated

Clang 内部结果已经带有 `Availability`，但 `PrintingCodeCompleteConsumer` 仅在值为 3（NotAccessible）时打印 `Inaccessible`，值为 2（NotAvailable）未被输出。现有输出解析器已经排除 `Inaccessible` 条目，因此将打印条件扩展为无符号 `Availability >= 2`，保留 available=0 与 deprecated=1。

Wasm function `39589` 通过原始 `COMPLETION: `、`Hidden`、`InBase`、`Inaccessible` 字符串及结果记录字段访问定位。在原始偏移 `0x1144a22`（十进制 18,106,914），`41 03 47`（`i32.const 3; i32.ne`，不满足则跳过标记）变为 `41 01 4d`（`i32.const 1; i32.le_u`）。该处后续分支于是仅在值大于 1 时输出标记。补全候选仍由 Clang 的原生声明、可见性与可用性元数据决定，没有符号名称黑名单。

## 来源与可重建边界

[可读逻辑补丁](completion-semantics-v1.cpp.patch) 对照 LLVM 官方 [CodeCompleteConsumer.cpp](https://github.com/llvm/llvm-project/blob/llvmorg-8.0.1/clang/lib/Sema/CodeCompleteConsumer.cpp) 与 [SemaCodeComplete.cpp](https://github.com/llvm/llvm-project/blob/llvmorg-8.0.1/clang/lib/Sema/SemaCodeComplete.cpp) 的相应逻辑。实际交付采用固定二进制的受校验变换，并非已完成 LLVM 工具链源码重建。

原始二进制到完整源码、构建依赖与许可的映射缺口依然存在。`sourceRebuildVerified`、`binarySourceRevisionsKnown`、`distributionLicenseReviewComplete` 不因本次修正变为 true。原始字节及其许可记录继续以 [工具链锁定清单](toolchain.lock.json) 和 [LICENSES.md](LICENSES.md) 为准。
