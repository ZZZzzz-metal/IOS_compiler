# 编辑时的代码提示

完成“校验本地资源”后，在可编辑源码中输入名称，或输入对象的 `.`、指针的 `->`、作用域的 `::`，停顿约300毫秒会请求本机 Clang 提示。也可点“代码提示”，或在源码内按 **Ctrl+J / Ctrl+Space**。候选名称和签名来自实际离线提供方，不上传源码。

用 ↑↓ 选择，Tab 或 Enter 插入，Esc 关闭；可直接点候选。插入只补名称，不自动填写参数或模板片段。多个重载保留各自签名。没有可选候选时，Tab 继续使用已有缩进；Shift+Tab 仍取消缩进。

Ctrl+J 参考 Visual Studio 的 List Members，Ctrl+Space 参考 Complete Word，见 [Microsoft 官方表](https://learn.microsoft.com/en-us/visualstudio/ide/default-keyboard-shortcuts-in-visual-studio?view=vs-2022)。iPad 外接键盘的 Control+Space 也用于切换语言键盘，见 [Apple 说明](https://support.apple.com/en-ie/guide/ipad/ipad1aa5a19a/ipados)。系统可能先截获快捷键；没有响应时点按钮。Ctrl+J 的真机行为也需确认。

组合输入期间不请求或确认候选。移动光标、改变选区、切换文件/语言、导入、恢复草稿、进入只读快照或离开源码后，旧候选不能编辑当前稿。注释、字符串、字符、原始字符串及数值小数点会压制提示。候选框随源码滚动和可见视口定位；没有空间容纳一行时关闭。

确认候选使用原生文本编辑事务，支持浏览器撤销/重做，并只进入一次正常保存。光标位于名称中间时替换完整名称，保留周围源码；UTF16偏移显式映射BOM与CRLF。浏览器不能提供原生可撤销插入时，会保留内容并提示手动输入。原生撤销已在本机内嵌浏览器验证，Safari/iPad仍待真机确认。

开始编译会停止新补全，等待活动请求结算并释放暖Worker；结束后按需重建。若取消或释放失败，不再启动编译，提示先保存或导出草稿后重开，避免两个未确认释放的Wasm实例争用内存。

首版能力以 [编译提供方说明](../compiler/COMPLETION.md) 为准。种类统一显示“符号”，不猜测AST类型；Clang8没有标记的某些const模板成员不可用性仍无法可靠筛选。候选最多显示80项，使用前缀继续缩小范围。它不是完整VS语言服务。iPad触控滚动、软键盘、IME、性能和停服离线提示仍待最终固定包与真机验收。

本轮已测范围和原始记录见 [四号补全证据](evidence/integrated-completion-2026-10-30/README.md)。受控DOM/提供方传输测试与真实Clang页面观察分开记录，不将模拟触控当作iPad通过。
