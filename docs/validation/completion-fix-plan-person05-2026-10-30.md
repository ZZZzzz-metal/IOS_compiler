# CC-20261030-05：两条补全缺陷的独立复验准备

当前状态为 **DONE-PREP，修复复验待固定目标**。5号准备基线为 `cbc92b26cdb647f3a61379fa84e58f1e039741fc`，本轮没有运行真实补全、编译或浏览器测试。2号尚在修复；收到其固定 DONE 和1号指定的完整目标提交后再运行昂贵语义。旧 LIMITED-DESKTOP ACCEPT 仅保留历史，本轮两条问题均须实际关闭；真机进度与旧 PR #4 合并建议暂停。

## 不变的判定与历史

- 原33逻辑场景及 `tests/lib/completion-oracle.mjs` 不改。原 `const-string` 仍要求 `size/c_str` 存在、`append` 不可确认；mutable `string` 必须保留 `append`。不得把失败改为预期通过或整体关掉补全。
- `tests/completion-availability-independent.mjs` 原额外场景不改：ordinary/deprecated 候选保留，unavailable 不可确认，deprecated 真实调用编译成功且保留警告，unavailable 真实调用编译失败。
- 旧额外场景实际执行了 unavailable 与 deprecated 两次调用；ordinary 当时只有候选断言。新扩展另补 ordinary 的真实调用，不将其倒记为旧证据。
- 已有 exit 1、452/150文件等封存目录、v0.4.6标签和包保持字节不变。初轮21项20通过1失败、另发现 VAL-002 共两条缺陷及后续记录均保留。只在新的 `integrated-*` 目录采集新证据。

## 最小扩展矩阵

新增11个查询，所有自定义业务标识符使用执行时生成的随机 nonce，nonce、原始源码、请求及哈希入证据。准备阶段的固定 nonce 仅用于自检，不作为产品通过证据。每次真实执行另生成 nonce，并保留原名称场景作为历史关闭依据。

| 场景 | 数量 | 必须保留 | 必须排除 / 调用对照 |
|---|---:|---|---|
| `using` 别名的 const / mutable `std::string` | 2 | 两者 `size,c_str`；mutable `append` | const `append` 不可确认；const 调用失败、mutable 调用成功 |
| 具体 `Box<int>` 的 const / mutable 对象 | 2 | const 普通成员和 const 成员模板；mutable 全部合法成员 | const 非 const 普通成员及非 const 成员模板排除；对应实际调用正反对照 |
| 同名 `read() const` / `read(int)` | 2 | const 保留前者；mutable 两者保留 | 按签名排除 const 对象上的后者，不能整个名字禁止 |
| unavailable 属性在定义、先行声明、被包含声明中 | 3 | 各自不同名称的 ordinary 与 deprecated | unavailable 排除；三类调用分别成功、失败、成功且警告 |
| available(double) / unavailable(int) 同名重载 | 1 | 合法 double 签名及合法对照 | int 签名排除；double 实际调用成功、int 失败 |
| A/B namespace 中同名函数，A unavailable、B合法 | 1 | 查询B时同名合法函数保留 | B实际调用成功、A失败；防跨上下文按名字整禁 |

模板使用已具体化的 `Box<int>`，避免未实例化依赖类型的能力边界混入本轮。别名及随机名称变换保留源结构和语义；不以字符串 `append` 或已知 blocked 名字作为实现黑名单。

输入定义在 [completion-fix-fixtures.mjs](../../tests/lib/completion-fix-fixtures.mjs)，额外判定在 [completion-fix-oracle.mjs](../../tests/lib/completion-fix-oracle.mjs)。准备命令为 `node tests/prepare-completion-fix-evidence.mjs integrated-person05-completion-fix-preparation-2026-10-30`，拒绝覆盖已有目录。其结构化调用对照尚未接入真实执行；固定目标到达后接入并保留实际编译器结果，不能把这次输入生成当作执行完成。

## 执行与关闭条件

1. 固定目标完整40位提交；确认产品工作树干净，记录编译源码、冻结接口、工具链锁与实际资源字节。仅哈希相同的依赖可复用旧回归证据。5号不改变他人工作树或产品代码。
2. 先执行原33的后端场景和额外 unavailable 原脚本。两条原失败在公开 CompletionAdapter 和隔离 native engine 两路都必须按原 oracle 实过。原3个UI自动触发例可沿用未变UI证据，不重复整套UI或把原33后端结果写成33次新查询。
3. 扩展11查询两路执行。保留完整请求/快照、原始返回、CLI stdout/stderr/argv/exit、UTF8坐标、资源身份和释放事件；先运行原 oracle，再运行 `completion-fix-oracle.mjs` 的严格签名检查。原生输出可带有效不可用标记；冻结 Item 无禁用状态，最终返回非法候选即失败。原始 CLI 与最终候选分别记录，不盲目要求两者文本相等。
4. 同名混合重载逐候选判定。原 oracle 的整名排除和“至少存在一条合法签名”均不足；额外判定要求合法签名存在、非法签名不存在，闭合签名集拒绝无法识别的同名候选。若真实 detail 格式不符合准备正则，记录基础设施缺口并从真实原始输出审查，不能删掉失败断言后宣称修复。
5. 新的完整调用程序走真实 CompilerProbe；失败必须是编译器的预期语义诊断，不能把超时、初始化或链接失败当反例成功。正例须实际链接并 smoke exit 0，deprecated 须有 warning；保留源码、hash、诊断和产物。不得用调用程序替换原补全输入。
6. 先补两条关闭所需的最小范围。修复改变公共编译/工具链资源时执行对应回归，并重点确认主样例内层 shadow=17、出块恢复5、已初始化循环头变量可读；最终集成与新包由1号另给固定目标再验。未变UI不重复整套。

## 补全专用派生Wasm的身份准备

1号追加条件：允许从锁定原始Clang二进制按固定配方派生仅供补全执行的Wasm，原vendor、工具链锁及完整编译保持原用途。当前只有availability的实验线索，const模板及最终交付仍未DONE；本轮不预写修复通过。

架构约束追加：1号已允许const修复采用精确结构化插入与相关body/code-section长度修正，不再限定所有变更等长；其22字节插入目前仍是实验描述，最终细节以2号固定DONE完整配方为准。先前bef7bc97准备证据中的等长表述保留当时历史，不改已封存84文件。

收到交付后，5号从原锁定blob独立读取原SHA，按最终固定完整配方的header/before字节守卫、明确定位与长度规则重新派生，计算最终全文件SHA；不能仅调用产品自身validator签收。若配方包含插入或长度修正，须独立检查相关函数body与section的编码/边界及所有修正，不只比较补丁局部。核对实际补全执行的模块、派生toolchainId、Result.compilerResourceHash、新模块manifest/profile；sysroot仍核对原锁。资源身份可随真实修复合法变化，原33源码/语义oracle不变；测试驱动使用独立重算的期望身份，不能继续盲用原Clang hash，也不能删除身份断言。

另补原hash错误、before字节不符、派生全SHA错误三类拒绝路径，并按最终配方检查Wasm header及结构长度守卫，确认失败有明确结果、不悄悄执行未校验模块。除派生器函数外，公开adapter也须拒绝伪装原compilerHash或错误派生toolchainId，不能只验局部工具后默认生产入口安全。具体可执行配方和负例待2号固定DONE后接入。常规编译资源前后逐字节核对，补全专用派生不能改写为完整工具链已替换。

## 固定目标轮另加的小对照

1号后续追加两类：const对象的static成员模板必须保留；deleted重载不可确认，同名合法重载必须保留。收到固定目标后另加独立源码与实际调用对照，逐签名检查，并分别统计。这两类不改bef7bc97的11查询/24控制数量，也不重写原33或84文件封存；当前仅列待执行要求。

本轮准备自检只检查输入、坐标、哈希、对照配对及判定器对合成坏结果的识别；真实 provider/CompilerProbe/native/浏览器执行均为0。真机离线、Safari/物理输入、完整界面与草稿强可靠性、安装/升级/驱逐/强杀/后台/性能及 G2/G3 继续待验证。
