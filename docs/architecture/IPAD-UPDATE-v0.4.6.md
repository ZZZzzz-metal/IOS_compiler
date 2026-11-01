# iPad更新步骤：0.4.6代码提示

本轮新增离线编辑代码提示，旧v0.4.5入口不包含此功能。桌面结果与独立验收见[本轮报告](COMPLETION-INTEGRATION-v0.4.6-2026-10-30.md)；真实iPad仍待实际验证，1号会一次给一个操作，收到反馈再继续。

| 核对项 | 本轮固定值 |
|---|---|
| bundle | ipad-web-probe-cbe80b74ccc3d3cebece9e73 |
| 资源 | 62项，60,964,100字节 |
| 完整ZIP | ipad-offline-debugger-v0.4.6.zip |
| ZIP SHA256 | 7cb501a11ebde61b26d019a711aa822d3fc03b5e3d22be759a05860502fa78e5 |
| 首次准备ZIP | ipad-first-setup-v0.4.6.zip |
| 首次准备SHA256 | 939742a873f1e8c65dfcbf0d2cfc4f8097cf8d54666851be35bd883103afb3ce |

1. 在旧工作台导出完整草稿，存到“文件→我的iPad”。等显示已保存后关闭旧工作台，不删除原入口或原草稿。
2. 等1号核对当前同WiFi入口、对应公开证书和有效期，再用Safari打开指定**固定版本**准备页。地址结尾应为`/releases/ipad-web-probe-cbe80b74ccc3d3cebece9e73/index.html`，前面的实际HTTPS地址由本地交付材料和1号当场核对，不从旧版本说明猜。
3. 点击“准备离线资源”，保持前台，等“已检查62项资源，可以打开工作台”；再按[完整手册](IPAD-USER-MANUAL.md)把此固定入口添加到主屏、检查已存资源和校验工作台。
4. 先完成手册“代码提示”小操作：C++17、空测试驱动，输入point.，选择x，立即单次撤销；再试loc和addV。可用Ctrl+J或按钮，Control+空格可能被系统用于切换语言。
5. 按手册关闭WiFi/蜂窝/共享网络及辅助电脑，关闭重开，再把Point改为Pixel、x改为width验证全新源码提示；继续P01–P11编译、断点、单步、变量和草稿操作。每步如实反馈，不用预期代替实际结果。

完整ZIP是静态Web实验资源，不能在iPad“文件”里解压后直接当IPA或用file://安装。首次准备由1号电脑侧提供可信HTTPS；平板无需安装Node或运行终端命令。少数const模板或unavailable函数候选仍可能不可调用，以编译诊断为准；触控、实体键盘、原生撤销与耗时都需你的真机反馈。
