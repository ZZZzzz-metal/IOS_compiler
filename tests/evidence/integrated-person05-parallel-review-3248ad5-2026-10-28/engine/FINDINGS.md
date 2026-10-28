# 5号独立引擎复查：3248ad5，2026-10-28

受测提交：`3248ad54faa5f0f3a8b6f6501829e95e4699f066`。真实组合：`integration-prototype-b02def5d2c6e7f39`。`debugger/src/variables.mjs` 的 SHA-256 为 `7a678889ab7b8f21dcc39f83c51771b9fff8df7103bec92275937c8ff40f996c`。

执行 `node tests/watch-types-independent.mjs`，以实际 CompilerAdapter 编译全新 C++17 源码并持久化产物，再交给隔离的 WorkerDebuggerAdapter。先在原生 WebAssembly 上运行同一字节，取得各表达式的实际 C++ 结果；在第一条 printf 前真实断点暂停后查询监视；继续后的解释器输出与原生输出逐字相同，均 exit 0。没有注入 PC、目标内存、变量或暂停事件。

原始材料位于 `run-01/`：完整 `source.cpp`、`artifact.wasm`、含构建/快照/真实查询及事件的 `results.json`、`checks.tap`。本次脚本 exit 1，14 项通过、11 项失败、1 项仅记录未支持范围。失败没有转换成预期成功。

## 新问题 A：float32 与整数混合运算没有先转换整数（P2，3号）

最小相关声明：

```cpp
float positive = 16777216.0f;
float negative = -16777216.0f;
int exactInt = 16777217;
```

| 监视表达式 | 实际编译程序结果 | 监视实际结果 |
|---|---|---|
| `negative + exactInt` | 0 | available 1 |
| `exactInt + negative` | 0 | available 1 |
| `positive - exactInt` | 0 | available -1 |
| `positive == exactInt` | 1 | available 0 |
| `positive < exactInt` | 0 | available 1 |
| `positive / exactInt == 1` | 1 | available 0 |
| `negative + exactLong`，exactLong 为 16777217 的 long long | 0 | available 1 |

C++ 的通常算术转换要求先把整数转换为 float32。当前 `variables.mjs:548` 起先用 `Number` 计算；算术仅在结果处 Math.fround，比较没有对应的 float32 共同类型转换，产生上述已接受但错误的值。

README 没有承诺完整混合浮点支持，这限制了可宣称的通过范围，但当前适配器也没有将这些表达式标为 unsupported；因此报告的是返回错误值，而不是要求扩展一个明确拒绝的表达式子集。可修正转换，或在无法证明语义时明确拒绝。

## 新问题 B：NaN 布尔转换错误，并错误执行本应短路的右侧（P2，3号）

最小相关声明：

```cpp
float nanValue = __builtin_nanf("");
int zero = 0;
```

| 监视表达式 | 实际编译程序结果 | 监视实际结果 |
|---|---|---|
| `!nanValue` | 0 | available 1 |
| `nanValue || 0` | 1 | available 0 |
| `nanValue && 1` | 1 | available 0 |
| `nanValue || (1/zero)` | 1，右侧不执行 | error: Division by zero |

C++ 中 NaN 转 bool 为 true；JS 的 `!NaN`/`!!NaN` 将 NaN 当 false。定位为 `variables.mjs:523` 的短路判断、565 行逻辑结果、594 行一元 `!`。这是实际 Worker 查询结果，不是仅静态推断。程序原生/解释执行均正常短路，错误仅在监视解释器。

## 已确认保留的修复与明确边界

- REV-002：`010 + 077 == 71`、`037777777777 + 1 == 0`，通过。
- REV-003：合法 `*(p-1) == 22`，通过；同一真实数组中 p-q 原生为 2，但监视明确 unsupported，并说明无法证明共同数组来源，符合本轮选择的边界；没有把它写成差值已实现。
- `p+q` 明确 unsupported，符合指针相加拒绝要求。
- 小整数提升、signed/unsigned32 比较、signed64 与 unsigned32 混合、unsigned32 环绕，所列具体对照通过。
- `(+positive)+1` 仍为 float 的 16777216，原有浮点一元修复通过。
- 普通空指针与整数除零短路正常；NaN 的特殊布尔转换失败另列。
- `sizeof(exactInt)` 返回 unavailable，原因 `Identifier sizeof is unavailable or ambiguous`。当前语法未开放 sizeof，本次只记录范围，不将这一明确未建立支持的功能计为产品缺陷或通过。

没有修改产品文件、共享 profile、能力表、旧证据或 1 号工作树。没有浏览器、真实 iPad 或整机断网测试；本报告不改变 G2/G3 状态。已立即将两组确定问题发给主任务，由主任务按用户授权通知 3 号。
