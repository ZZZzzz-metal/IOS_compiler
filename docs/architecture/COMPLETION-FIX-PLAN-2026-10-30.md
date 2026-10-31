# 已知补全问题修复与重新验收

2026-10-30。用户要求先修好已确认问题，再进入真机实测。此前把两项失败作为桌面实验原型的限制接受，未满足这个交付要求；本轮将其重新纳入必须关闭的缺陷。PR #4已恢复草稿，暂停推荐合并与真机推进。旧integration-v0.4.6、包、LIMITED-DESKTOP ACCEPT和原始失败仅作历史保留。

## 必须修复

1. const std::string等对象仍出现不可调用的非const成员函数模板；已确认append反例编译失败，候选却可确认。
2. unavailable符号仍作为可选择候选；实际调用编译失败。deprecated符号可合法调用并产生警告，不能将它和unavailable一并过滤。

原33场景32通过/const-string一项失败，额外unavailable一项失败的事实不改写。本轮必须用保留的原失败预期和实际调用正反对照验过，不能靠改oracle、按名字黑名单或关闭成员提示获得全绿。

## 分工与握手

| 请求 | 负责人 | 当前状态 | 交付 |
|---|---|---|---|
| CC-20261030-02 | 2号编译 | ACK，研究/修复中 | 语义修复、真实候选正反对照、固定提交及资源身份 |
| CC-20261030-05 | 5号独立验收 | ACK，先准备，等待固定修复 | 原oracle复验、扩展正反对照、限定关闭结论 |
| CC-20261030-04 | 4号界面 | ACK，原UI冻结 | 若修复需要UI/API增量，再由1号明确派发 |
| 集成 | 1号 | 进行中 | 契约协调、固定交付合入、新包及桌面流程复验 |

沿用REQ→ACK→DONE→ACCEPT。旧请求的ACCEPT不等于本轮问题已关闭；新轮尚无成功DONE或ACCEPT。

## 修复原则与技术调查

优先使用真实编译器语义。研究助手从LLVM llvmorg-8.0.1官方源码定位两个疑点：PrintingCodeCompleteConsumer打印时丢失availability，ResultBuilder的对象限定符过滤未解包FunctionTemplateDecl。须由2号核对锁定Wasm实际版本/来源、复现并验证方案，不能仅凭上游源码片段宣布当前二进制已可修复。可评估原生输出/AST语义、二次语义校验或可重建工具链补丁；资源或共享API有变化时由1号协调新身份。

来源：[CodeCompleteConsumer.cpp](https://github.com/llvm/llvm-project/blob/llvmorg-8.0.1/clang/lib/Sema/CodeCompleteConsumer.cpp)、[SemaCodeComplete.cpp](https://github.com/llvm/llvm-project/blob/llvmorg-8.0.1/clang/lib/Sema/SemaCodeComplete.cpp)。

保留非const对象的合法模板成员、普通const方法、别名、重载、访问控制、C11/C++17、头文件和driver/user.inc。候选身份、取消、暖Worker释放、超时及编译屏障继续有效，不以可靠性退化换过滤。若无法获得足够语义信息，应记录实际技术阻塞并继续解决，不能把问题改称通过。

## 再交用户前的顺序

2号固定修复并自测，5号在固定目标独立证明两条原失败关闭；1号合入并执行相关回归，重建新的不可变资源组合与包。工具链字节变化则既有编译/调试流水线须真实复验，不能只跑补全。新包再做桌面停服冷开、全新代码补全/撤销/编译调试与草稿重开。上述完成后更新PR、手册和结论，再指导用户进行iPad特有的网络、安装、键盘/触控与后台测试。

真机验证仍不可被桌面测试代替；当前先完成已知问题的修复工作。后续结果只按实际固定提交和证据追加，不预填成功。

## 独立准备已接收

5号固定bef7bc97已合入e5dce648，后续澄清2a0a81dc亦合入，仅PREP签收。93文件均为5号范围，84文件及清单Git原字节一致；新增11查询/24完整调用控制，覆盖随机命名、别名、具体模板、const同名重载、属性声明/定义/头文件、deprecated、混合重载及A不可用/B同名合法上下文。根28项输入/判定自检（5+23去重）与mandatory check/test通过；首次根命令仅选5项却错误期望28的统计断言已保留并纠正，不是产品失败。这些是测试基础设施，真实provider/CompilerProbe本阶段运行0。后续const负调用还须匹配const语义诊断，不能只凭任意compiler-exit。结构化派生可包含精确插入及body/code-section长度修正，须固定完整配方/原hash/header-beforeguard/最终全SHA；不局限等长替换。2号正式修复交付与5号实际复验继续待。
