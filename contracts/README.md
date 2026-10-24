# 共享接口草案 0.1.0-draft.1

由上下文 1 管理；2/3 提出真实产物与运行时要求后共同修订。`protocol.d.ts` 是语言无关 JSON 消息的数据定义；原生适配器也遵守同一语义，不要求采用 TypeScript。`invariants.mjs` 是供开发电脑运行的部分不变量检查，不是完整协议验证器或调试引擎。

## 编译与源码

`CompileRequest → CompileResult`，以 requestId 关联。编译在可终止的隔离执行单元进行，不占用 UI 主线程；每个请求只返回一个终态（succeeded/failed/cancelled）。取消之后迟到的成功不能替换当前构建。上层只接受当前 requestId 的结果。

源码路径为相对于虚拟项目根的 POSIX 路径，区分大小写；拒绝绝对路径、反斜杠、空段、`.`、`..`、NUL 以及孤立代理项。文本为 UTF-8、无 BOM、LF 换行；不做 Unicode 归一化，不改变缩进/末尾空白。hash 针对**实际送入编译的规范化文本**。`sourceHash` 按 `invariants.mjs` 的稳定 JSON 算法计算：`JSON.stringify({version:1,translationUnit,files:[{path,role,text}]})`，files 按路径 UTF-16 代码单元字典序排序，再对 UTF-8 字节求 SHA-256。JSON 属性顺序固定为上述顺序，禁止额外空白；双引号、反斜杠及控制字符按 ECMAScript JSON.stringify 转义，其他合法 Unicode 直接编码 UTF-8（包括补充平面字符，不转义为代理对）。固定向量见 source-hash-vectors.json。测试驱动和生成单元同样入 hash；snapshotId/buildId/requestId 分别标识快照实例、具体构建和请求，不得互换。

行、列从 1 开始，列为 UTF-16 代码单元。编译器原生字节列必须由 2 号依据快照转换。范围终点不包含；原生地址/64 位整数以字符串传递，避免 JS 精度损失。路径映射须映射回快照，不能泄露或依赖开发电脑临时路径。

成功结果必须带完整 BuildManifest、真实产物与调试信息资源引用、来源版本、参数和 diagnostics。调试信息若嵌入可执行产物，debugInfo 可引用 executable 的同一资源。调试构建先用 O0，保留类型与位置调试信息；准确开关由候选工具链证明。编译失败不产生可启动 buildId。启动前校验协议版本、compatibilityId、资源 SHA-256、目标/ABI/feature/debug-format 与精确组件版本；相同 Wasm 扩展名或相同源码 hash 不足以证明兼容。

CompatibilityProfile 的技术身份不可变，status/evidence 是可追加的验收元数据，不参与产物兼容比较。resourceManifestHash 绑定全部离线资源的精确内容与元数据到可信兼容组合；计算方式为 hashResourceManifest 的固定字段 JSON（按资源 ID 排序，roles 排序），更换任何组件资源后须发布新组合。该值由 1/2/3 对真实组合共同固定，不能从下载包自报值直接信任。

assertBuildIdentity 只检查身份，不能当作启动成功。verifyStartResources 另外交叉检查 StartRequest 与 build/snapshot/mode、启动配置和产物实际字节；它仍不替代完整输入验证、离线包检查、后端初始化与真实断点绑定。所有生产适配器必须实现这些检查；Node 参考函数不是可在 iPad 直接部署的实现。

## 执行与命令

会话状态：`created → starting → running ↔ paused → stopping → terminated`；活动态可进入 failed，starting 可直接进入 paused（entry/breakpoint），running 可自然 terminated。终态不可复用；重启创建新 sessionId。

- start 包含 build、快照、完整 stdin 和 EOF、initialBreakpoints、stopOnEntry。适配器在执行首条用户指令前完成初始断点绑定；绑定结果先于 running/paused 事件。stopOnEntry=true 时在首个用户可执行位置暂停。这样短程序不会因后发 setBreakpoints 而错过首个断点。首版只支持运行前完整输入；交互 stdin 单独验证。
- setBreakpoints 替换指定 sourcePath 的整组请求；请求位置和实际绑定位置分开，一行可绑定多个位置；无可执行代码须给原因。新构建重新绑定。
- continue/stepInto/stepOver/stepOut 仅对当前 paused + pauseId 接受。前端发送前同步调用 invalidatePause（清除 pauseId/frameId，设置 pendingControl=commandId），禁用重复动作和暂停查询；后端原子接受后立即失效旧 pauseId/句柄。命令失败也不能复用过期缓存，执行 resync 恢复当前权威状态。
- pause 在能力明确支持时开放。stop 从 starting/running/paused 可发，幂等；必须实际终止计算，独立于普通输出通道，不因无限循环或输出堵塞而失效。
- 所有命令带 commandId，并在同一会话串行执行；重复 commandId 返回原 ack，不重复执行。ACK 只有接受确认和 acceptedAtEventSeq，不携带可替换界面状态的快照。只由匹配 pendingControl 的 ACK 清理命令等待标记；旧 ACK 不得回退状态/事件序号或恢复 pauseId，执行状态以事件/resync 为准。后继事件与 ACK 传递顺序不能作为正确性的前提。终止事件包含正常退出、用户停止、trap、资源超限或后台终止原因。
- 运行预算只累计执行态时间；人工暂停不计入运行时限。后台挂起须报告并按平台能力暂停或终止，不在返回前台时伪造继续。

## 事件、栈和变量

事件必须来自真实会话：sessionId/buildId/sourceHash/compatibilityId 一致，eventSeq 从 1 连续递增。重复/旧事件丢弃；发现序号缺口立即 markDesynchronized（synchronized=false、清除暂停/帧引用），拒收变量响应并请求 resync。跨进程通信适配器须保持事件顺序，先订阅再 start；状态字段缺省也不能当作已同步。

resync 经同一命令有序通道，在此前命令处理后返回完整 SessionSnapshot：当前事件序号、暂停原因/位置、断点绑定、退出/错误详情及有界输出尾部（截断显式说明）。请求带 requestId，只接受最新请求且同一会话的回复。等待期间缓冲有界后续事件；权威快照不得小于已接受 eventSeq。以快照原子替换视图并丢弃所有旧查询/变量引用，清除 pendingControl；丢弃缓冲中不大于快照序号的事件，再顺序接续更大的事件。缓冲溢出或仍有缺口则保持失同步并再次 resync。旧 ACK 不修改该快照。此流程由后续客户端实现，当前只有不变量参考检查。

暂停产生全新 pauseId。stack 查询绑定该 pauseId；scopes/variables/evaluate 另绑定 frameId。选择另一帧时，旧帧响应不能覆盖当前帧；继续、单步、终止、重启立即让所有变量引用失效。`matchesPause` 可用于最后一道响应检查。frameId 不用数组下标替代，递归帧必须可区分。

变量提供 available/unavailable/optimizedOut/outOfScope/unsupported/error 状态、原因、分页 variablesReference 和截断标识；无结果不能写作 0 或空字符串。指针地址、解引用、数组元素、string/vector 容器内容分别验收；无效指针受控失败。基础监视表达式建议从标识符、成员访问、数组索引、无副作用标量运算逐项验证，调用、赋值、自增/自减默认拒绝；具体支持集合以 capabilities.json 为准。

stdout/stderr 为同一事件序列中的 UTF-8 文本，适配器进行增量解码。设置输出字节上限和截断事件；保留退出状态，控制通道不能被输出挤占。数组和容器分页，限制单页与字符串长度。

## 模块最低交接

- 2：CompilerAdapter + 与 3 共同确认的 CompatibilityProfile + 实际资源包/许可/校验 + 真实 BuildManifest。
- 3：DebuggerAdapter + 支持能力及限制 + 真实事件 + 同一组合可复现的启动方式。
- 4：UI 只消费适配器；StorageAdapter 采用带 revision 的保存，失败显式反馈；编辑稿与活动快照分离。
- 5：真实样例、预期、环境和证据；契约单元测试不替代端到端或真机验收。

`capabilities.json` 是唯一支持声明来源；`compatibility-profiles.json` 当前为空，不能启动任何实际产物；`offline-bundle.json` 当前为空且 status=unprepared，不能显示离线可用。
