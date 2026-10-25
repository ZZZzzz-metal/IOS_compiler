# 统一离线 Web 实验入口

这是 1 号在统一工作台上补充的完整缓存实验，不是已经通过 iPad 验收的产品或原生安装包。编译、运行、调试均在浏览器设备内；服务器只提供首次准备所需的静态文件。

## 电脑准备和复测

需要 Node.js 22+，仍无第三方 npm 依赖。在仓库执行：

```powershell
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd run prepare:offline
npm.cmd run start:offline
```

默认电脑入口 `http://127.0.0.1:4187/` 指向一个固定版本的准备页。点击“准备离线资源”，全部通过后才可打开工作台，再点“校验本地资源”。关闭工作台及准备页、停止服务器，重新打开此前记录的**固定版本准备页完整地址**，检查资源后编译全新源码。外层 `/` 选择页不在离线缓存中，不能拿它代替固定版本入口验证。

资源生成在 `app/offline/.local/site/releases/<bundleId>/`；`app/offline/.local/latest-build.json` 记录精确入口、资源数量/字节数、后端组合及 SW 哈希。目录保留全部相对路径，包括界面、保存实现、编译/调试组件、固定工具链、本地许可证、配置、图标和操作手册。准备脚本检查模块导入闭包和实际字节；已经生成的相同版本只校验，不覆盖。四项大二进制与本地产物仍被 Git 忽略，新的 checkout 需要先补齐固定工具链。

```powershell
npm.cmd run test:offline
```

该命令执行真实 SW 模板的 Node 生命周期与故障注入检查；缓存和网络是小型替身，不能充当浏览器或 iPad 证据。浏览器实测另行记录。

## 版本和事务边界

- 每个完整资源集合及 SW 模板生成独立 `bundleId`，使用独立目录、SW scope 和缓存前缀。SW 自带资源清单作为该次安装的信任根；`bundle.json` 是同一清单的可读副本。清单与 SW 自身不参与其资源数组的递归自哈希，生成报告单独记录二者哈希。
- 安装逐项读取、核对长度和 SHA-256，全部通过后才写完成标记。失败的 staging 不可用于运行。旧版本缓存和草稿库不删除，不使用 `skipWaiting()` 抢占已有会话。
- 已控制的版本内请求只读取本版本清单中的已校验缓存；缺失或损坏返回受控失败，不从网络悄悄补入另一组字节。入口每次检查完整集合；工作台准备时通过 MessageChannel 重新核对 SW 的精确 scope、bundle、后端身份和全部缓存。
- 原桌面工作台继续使用独立端口和未缓存资源；旧模块实验 SW 仍被拒绝。此次 `ui/src/main.mjs` 只有这一处集成接入及资源状态文案调整，未替换编译器、调试器或草稿实现。
- 相同 HTTPS origin 下，各版本沿用现有 IndexedDB 草稿；不同协议、域名或端口是不同存储空间。切换入口前应导出完整草稿，不能依赖跨 origin 自动迁移。

缓存激活是资源事务，不代表真实设备功能自检已通过。产品 `contracts/offline-bundle.json` 仍为 `unprepared`，正式兼容组合仍未选择，G2 未通过前不冻结 PWA 路线。

## iPad 入口前提

平板不能访问电脑的 `127.0.0.1`；普通局域网 HTTP 不能完成 Service Worker 安装。需要平板可达且信任证书的 HTTPS 入口。维护者可以提供 TLS 文件后使用：

```powershell
$env:OFFLINE_HOST='实际局域网地址'
$env:OFFLINE_TLS_CERT='服务器证书 PEM 的绝对路径'
$env:OFFLINE_TLS_KEY='服务器私钥 PEM 的绝对路径'
npm.cmd run start:offline
```

非 loopback 监听没有 TLS 会直接拒绝启动。服务只读取生成的 site 目录，不提供上传、编译 API、草稿 API，也不从仓库根目录暴露私钥。证书准备见 [本地 HTTPS](LOCAL-HTTPS.md)；该脚本不替用户安装或信任证书，不修改系统证书存储、防火墙或路由。网络隔离、系统授权和真机可达性须实测。

用户只看 [iPad 操作手册](../../docs/architecture/IPAD-USER-MANUAL.md)，无需在 iPad 安装 Node 或输入上述命令。维护者须给出经核对的实际 HTTPS 固定版本地址、版本、资源大小和结果采集方式，再通知用户开始。

Service Worker 的安全上下文要求见 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)。网站存储与持久化请求的限制见 [WebKit 官方存储策略](https://webkit.org/blog/14403/updates-to-storage-policy/)。添加主屏和请求持久化不保证缓存或草稿永久保留。
