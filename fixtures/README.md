# 5 号独立验收源码

`manifest.json` 是8份首轮样例的输入、输出、精确断点行号、变量、递归栈与单步预期。它只存预期，实际结果保存在 `tests/evidence/`。所有断点按执行标记语句前解释；不能读取尚未执行的声明目标作为已初始化值。行列从1开始，列按UTF-16代码单元。

| 样例 | 用途 | 输入 / 关键预期 |
|---|---|---|
| c-core.c | C11输入输出、循环、递归、数组、指针和三种单步 | `2 5 8`；sum=15、triangle=6、adjusted=18、*pointer=5 |
| cpp-core.cpp | C++17函数、递归、循环、遮蔽、vector扩容、4类string | `4`；vector={7,1,8}、recurrence=33、最终105 |
| cpp-stl.cpp | sort/map/unordered_map/queue/priority_queue与空vector | 输出见manifest；只验证实际输出，不承诺各容器调试格式化 |
| compile-error.cpp | 中文及emoji后的诊断定位 | 第4行第40个UTF-16代码单元；无可运行产物 |
| runtime-trap.c | 受控异常与恢复 | stderr后执行__builtin_trap；不使用C未定义行为猜结果 |
| infinite-loop.c | 停止、界面响应、再次启动 | unsigned计数无限循环；需要真正Stop |
| output-flood.c | 输出限额与UTF-8完整性 | 5376字节输出、exit 7；限额64字节后仍保存退出码 |
| solution-driver.cpp | 可编辑main测试驱动 | 输入`20 2`输出answer=42；不承诺自动适配题站 |

`// @bp:name` 是稳定行号锚点。更改源码后同步manifest；自动检查会拒绝漂移。真机需编译此前没编译过的源码时，在文件末尾追加唯一注释，保持前面的断点行号。

跳出函数可在调用者调用行的返回续接位置暂停，此时调用结果的存储尚可能未执行。先验证被调函数已退出、调用栈回到正确调用者；若仍在调用行，执行一次stepOver到下一行，再验证赋值结果。manifest中的stepOut checkpoint指向完成该存储后的验证位置。

已知缺陷最小源码位于 `regressions/`。`lexical-shadow.cpp:6` 的value必须为19，`:8`恢复外层7；`loop-header.cpp:4` 的i为0、1、2，回到已初始化的循环头后i仍须可读。循环头同一行可有多个指令位置，不预填未经验证的列或当前值。
