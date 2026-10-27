# 2026-10-27 调试监视表达式复审

复审对象为 `integration-v0.4.1` 的引擎组件，开发组合 `integration-prototype-cf02b4efe9477db1`。本轮重新通过真实 `CompilerAdapter → WorkerDebuggerAdapter → evaluate` 查询复现；没有修改编译器或调试器。引擎源文件精确字节见 [输入指纹](../../app/offline/evidence/deep-review-2026-10-26/engine-source-inputs.json)，实际构建、事件、监视返回及独立编译诊断见 [原始结果](../../app/offline/evidence/deep-review-2026-10-26/engine-results.json)。归档目录沿用首次审查的日期，本报告为下一日复核。

两项已确认问题均属于 **3号调试模块**，目前未修复。它们发生在监视表达式求值中。本轮同一产物的程序执行输出与原生 WebAssembly 一致，不能据此写成程序自身算错或编译器算错。

## REV-002：前导零整数常量按十进制解释（P2）

在下方程序第8行暂停后，`octal` 显示 `8`，但监视 `010`、`00010` 均返回 `availability=available, type=int, displayValue=10`。监视 `08` 也返回 available 的 `8`。

预期：C++ 整数常量 `010`、`00010` 应取八进制值 `8`；`08` 含无效八进制数字，应明确拒绝。若当前表达式子集不支持八进制，也应返回 unsupported，不能静默按十进制报告可用值。独立的真实 CompilerAdapter 编译 `int main() { return 08; }` 返回 failed，诊断 `invalid digit '8' in octal constant`。

定位：`debugger/src/variables.mjs` 的 `numericLiteral()`（约493–505行）将整数文本直接交给 `BigInt(text)`，并仅区分十六进制与十进制的候选类型，没有先处理 C/C++ 的八进制语法。建议按词法基数解析并验证数字，再按基数选择整数候选类型。回归至少覆盖 `0`、`010`、`00010`、`077`、`08`、十进制和十六进制，并检查运算组合不能在后续阶段重新丢失类型。

## REV-003：指针与整数偏移分支未区分右操作数指针（P2）

本例暂停时 `p=0x00101488`、`q=0x00101480`，均为同一 `int[3]` 中的 `int*`，元素大小为4字节。

| 监视表达式 | 实际返回 | 预期或支持边界 |
|---|---|---|
| `p + q` | available，`int*`，`0x00506688` | 两个指针相加应明确拒绝；CompilerAdapter 对同式真实源码报 invalid operands |
| `p - q` | unavailable，`Address is outside wasm32 memory` | 对本例同一数组合法相减应为整数 `2`；如子集暂不支持，应明确 unsupported，不能按地址偏移处理 |
| `p + 1` | available，`int*`，`0x0010148c` | 本例为合法的数组末尾后一位置；此结果符合预期 |
| `*(p-1)` | available，`int`，`22` | 符合预期，对照确认普通指针偏移与解引用路径可运行 |

定位：`debugger/src/variables.mjs` 的 `binary()`（522–527行）只检查左值 `_pointerTarget` 和右值标量是否 `bigint`。右指针地址本身也是 bigint，因此误进入“指针±整数×元素大小”分支，并在后面的指针操作检查之前提前 continue。`p+q` 被拼成伪指针，`p-q` 则产生负地址并报内存范围错误。

建议先根据两侧指针类型区分：拒绝 pointer+pointer，合法 pointer-integer 做缩放；pointer-pointer 相减如要支持，需校验类型、元素大小、地址差及可证明的支持范围并返回有符号整数。无法证明时明确 unsupported。回归包含两侧均指针、指针与整数、零比较、有效差值和无法证明有效性的场景，避免把 bigint 存储类型当作 C++ 操作数类型。

## 最小源程序与重新复现

```cpp
#include <cstdio>
int main() {
  int array[3] = {11,22,33};
  int *p = &array[2];
  int *q = &array[0];
  int octal = 010;
  float f = 16777216.0f;
  std::printf("target octal=%d difference=%d plus=%.0f minus=%.0f\n", octal, int(p-q), (+f)+1, (-f)-1);
  return 0;
}
```

第8行设置初始断点。程序继续执行后，原生 Wasm 与调试解释器均正常退出0，stdout均为：

```text
target octal=8 difference=2 plus=16777216 minus=-16777216
```

[复现脚本](../../app/offline/evidence/deep-review-2026-10-26/engine-reproduce.mjs) 使用已校验的本地固定工具链，重新编译新源程序并启动真实 Worker；它还独立编译无效 `08` 与 pointer+pointer 源码以保存编译诊断。脚本拒绝覆盖证据文件。后续复跑请选择新的输出目录：

```powershell
$env:ENGINE_REVIEW_OUTPUT='app/offline/.local/deep-audit/engine-rerun-unique'
node app/offline/evidence/deep-review-2026-10-26/engine-reproduce.mjs
Remove-Item Env:ENGINE_REVIEW_OUTPUT
```

本轮保存了 [源程序](../../app/offline/evidence/deep-review-2026-10-26/engine-source.cpp)、实际34400字节Wasm、原始查询/事件及输入指纹。脚本退出0表示复现链路完成且程序输出对照一致，不表示这些监视缺陷已修复；修复验收需重新核对 results 中每项的语义。

## 附录：额外观察与边界

`(+f)+1` 监视返回 double `16777217`，`(-f)-1` 返回 double `-16777217`，但本例真实 C++ float 运算打印 `16777216` 与 `-16777216`。`unary()` 约583行调用 `literal()` 未保留 float32 位宽，后续二元运算按 double 计算。建议3号明确浮点监视支持范围：若支持，保留一元运算的 float 类型和舍入；若未支持，拒绝求值。本轮 README 只承诺“测试过的无副作用整数运算”，因此此差异单列为待确认支持范围，不新增为已承诺整数功能的主缺陷。

`1+p` 被明确返回 unsupported，`p[-1]` 被索引边界规则拒绝，而 `*(p-1)` 返回22。这些体现当前表达式子集的限制，未计入本轮两项主缺陷。没有执行真实浏览器或真实 iPad 验收；也未证明全部 C++ 表达式、浮点或指针来源分析的正确性。G2仍待真机。
