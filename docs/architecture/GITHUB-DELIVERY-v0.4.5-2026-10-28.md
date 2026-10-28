# v0.4.5 GitHub交付与下一轮复验

2026-10-28（北京时间）。已推送集成分支、3/4/5号固定交付与新标签，并建立 [PR #2](https://github.com/ZZZzzz-metal/IOS_compiler/pull/2)。PR保持open、未合并，main为9946398a1307263385dedc93bb9f1add0281c101，由用户手动合并；保留用户已合并PR #1的主线。

| 项目 | 固定身份 |
|---|---|
| 受测集成代码与integration-v0.4.5标签落点 | 40a079ba2065384572f268e4bb91bda437e46cec |
| 标签对象 | b9bed1dcc54362ac3210169b734d566d5f49efc8 |
| module/03-debugger | 9cb5bb66cfee1b917b89d71474c6fb38dde676d8（产品修复309cb45，后续仅交接） |
| module/04-ui | cd0c6fae4f25d275e7e0dc7a5124f516d84fed00（产品修复33c1639，后续仅交接） |
| module/05-validation | c32cbf82250593d11ed3c1e107961636b3a61a8c |
| 最终离线包 | ipad-web-probe-eb5236b6ed8f9aab4a9d9ced，51资源、60,874,273字节 |
| 后端组合 | integration-prototype-60eb6729284e2729 |

新代码、README、中文平板手册、原始失败与独立正负对照均已进入GitHub。完整本地ZIP、大工具链、TLS材料与用户键盘照片没有上传。两档新ZIP及12个旧包的字节证据见 [本轮集成报告](SHORTCUTS-INTEGRATION-2026-10-28.md)。本文件是推送后的追加收据，不移动固定标签、不改已封存源码/包/证据；integration随后增加本收据提交，复验使用上表固定标签代码。

## 平板入口和操作资料

首次电脑开机、同Wi-Fi，用Safari打开本机交付资料中提供的固定准备入口，再按 [v0.4.5更新步骤](IPAD-UPDATE-v0.4.5.md)、[完整手册](IPAD-USER-MANUAL.md) 和 [键盘速查](../../ui/SHORTCUTS.md) 操作。严格CA/IP HTTPS检查在同电脑通过；平板互访和实际断网仍待用户测试。公开测试根证书2026-11-02北京时间09:29:59到期，信任操作由用户按手册手动决定，不绕过浏览器警告。局域网地址/电脑运行状态变化后须重新确认，GitHub本身不托管本项目编译服务。

完整静态包在本机app/offline/.local/packages/ipad-offline-debugger-v0.4.5-r3.zip，SHA-256 f1877f4e031f5a46bdafab71ea5ae611a8dd74c58c7256c9ed367e92cb00c068；首次准备包为ipad-first-setup-v0.4.5-r3.zip，SHA-256 3d9b89e7aa7332df00d47e090a644433458d31f87089daa6494b1f732eebec3e。不是IPA，不能解压后以file://启动。

## 已完成与下一步

1号合并后251/251通过，强制根检查通过；最终r3桌面停服重开、51资源校验、全新源码输出6、Control七动作、标准方案开始/停止/运行与替代禁用、草稿和选择恢复、缓存文档及严格HTTPS均通过。原汇总器格式错误已单独保存，不冒充产品失败或删除证据。

5号c32cbf8在各固定修复分支的已测范围独立关闭REV-006/007（309cb45桌面）与REV-008（33c1639受控并发语义）。这不是最终40a079b组合或r3完整包的独立签收。下一轮5号使用显式固定40位revision、60eb6729284e2729及全新integrated-*输出目录，验最终组合/完整缓存、快捷键和REV-001实际浏览器离线恢复，保留所有旧证据；3号配合监视边界，4号配合真实系统剪贴板、IndexedDB和界面/草稿检查。

真实iPad、Safari主屏、实体键盘、后台/内存压力及G2/G3仍待。第三方二进制完整来源与许可映射未完成，本次上传是实验原型源码交付，不是正式软件发行。
