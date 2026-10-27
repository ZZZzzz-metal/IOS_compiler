# v0.4.4 本地归档字节校验

本记录只说明完整静态包与首次准备小包的生成和逐文件校验，不表示当前HTTPS可达、真实浏览器通过、iPad/G2/G3通过或工具链分发许可已完成。

- 固定包：`ipad-web-probe-40b0be1b9616e4ec152be87a`，50项，60,850,729字节。
- 完整ZIP：`app/offline/.local/packages/ipad-offline-debugger-v0.4.4.zip`，19,283,669字节，59文件，SHA-256 `124e04793eeb01cc424c320b289bf5d1cbdc81d6710702966f4eabc6762de5de`。
- 首次准备ZIP：同目录 `ipad-first-setup-v0.4.4.zip`，18,611字节，6文件，SHA-256 `41db45be8507c700302fc5ebf5bf33d6d5c97594ff87b88e812360ae81cd5709`。
- SW SHA-256：`f497fdac6f0277fcca184e24f98ecf31f888905d2ed078cfd6039c0a0106e6a3`；descriptor SHA-256：`2c9e7a0b33e1cb478c45c5f78075694aa7a18ce3d226c7fa50bfd10567c707d0`。

两档均验证无重名、越界路径、私钥或测试故障夹具；每个文件均与生成输入逐字节匹配，档内SHA清单全量复核。完整包中的50项资源、SW及descriptor与新固定包一致，包内手册与运行资源内的手册一致。公开证书配置解析为单个可移除根证书，DER指纹与指定测试根证书一致。ZIP只存在于忽略目录，未被Git跟踪。

`package-archives.py` 是实际执行生成器的逐字节副本，`archive-commands.json` 记录命令和退出码；`package.json` 是结构化结果；`build.json` 和 `bundle.json` 保存本次构建及50资源身份。构建基线dc65469含3号21f2135和5号d12aad，根手册/元数据增量另由资源哈希绑定，不把未提交内容冒充基线提交。

说明已区分：新3号监视修复、REV-001及本次完整缓存包待5号独立复验；5号d12aad只在66db2bb已测桌面范围独立关闭REV-004/005，既有195项与新增14项分别记录。p-q为明确不支持，不能写成指针距离计算成功。平板和同Wi-Fi互通仍需实际确认。

6个既有v0.4.1/v0.4.2/v0.4.3 ZIP长度与SHA均与已跟踪历史报告一致，详见 `previous-archives.json`。当前没有名为v0.4.0的ZIP，其原始release仍在；未宣称该版ZIP存在。未覆盖旧证据、旧ZIP或旧标签。
