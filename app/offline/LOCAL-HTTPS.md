# 局域网 HTTPS 实验准备（维护者）

更新：2026-10-26。此文件用于首次传送离线资源前的电脑端准备。它不表示已有可达的 iPad 网址，也不替代 [平板操作手册](../../docs/architecture/IPAD-USER-MANUAL.md) 或 G2 真机结果。

## 先确认网络

iPad 与电脑应能互相访问。同一个 Wi-Fi 名称不保证设备互通，校园或访客网络可能隔离设备。当前工作台的 `127.0.0.1` 只代表正在使用的设备自身，不能把电脑的 localhost 地址发给平板。普通局域网 HTTP 不满足离线 Service Worker 的安全上下文条件。[MDN：Service Worker 注册](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)

先用 `ipconfig` 确认电脑当前 Wi-Fi IPv4 地址。不要选 VPN、虚拟网卡或断开的接口；地址变化后需要重新准备证书及入口。不要为此关闭防火墙或关闭浏览器证书检查。若网络隔离，应换能互通的私人网络，或另行准备正常受信任的 HTTPS 静态站点。

## 生成短期证书文件

需要 PowerShell 7 的 `pwsh`、Node.js 22+，无第三方依赖。先生成离线站点，再运行脚本，参数替换为已确认的 Wi-Fi IPv4 地址：

```powershell
npm.cmd run prepare:offline
pwsh -NoProfile -File app/offline/prepare-local-https.ps1 -Address '已确认的IPv4地址'
```

脚本只写 `app/offline/.local/tls/local-https-时间-随机值/`，每次新建目录，默认有效期 7 天（`-Days` 可设 1–30 天）。它不打开端口，不写入 Windows 证书存储，不改防火墙。根证书私钥签发后释放，未保存；服务端私钥只保存在生成目录的 `server-key.pem`。不要分享该私钥或整个生成目录。

输出的 `setup.json` 含证书名称、SHA-256 指纹、到期时间和候选 HTTPS 地址。地址只是待连通性检查的地址。`root-only.mobileconfig` 仅含这次根证书，没有 MDM、VPN、代理、账户或远程管理载荷；这不是 App 安装包。

## 用户手动安装并信任证书

通过用户已有可信的文件传送方式，把 `root-only.mobileconfig` 或 `root-ca.cer` 交给平板，并单独提供 `setup.json` 中的证书名称与 SHA-256 指纹供核对。不要依赖绕过该 HTTPS 网站的安全警告来取得根证书。

用户在 iPad「设置」中安装下载的描述文件；安装前核对本次证书名称、载荷仅为证书。安装后还需进入「设置 → 通用 → 关于本机 → 证书信任设置」，只对本次根证书启用完全信任。手动安装描述文件不会自动使根证书受 SSL 信任；这些步骤必须由设备用户执行。[Apple：安装描述文件](https://support.apple.com/102400)、[Apple：信任手动安装的证书](https://support.apple.com/102390)

启用根证书信任会改变设备对 TLS 证书的信任范围。仅为这次由自己电脑生成、核对过的短期证书执行；不要安装来源不明的证书。测试结束后，在「设置 → 通用 → VPN 与设备管理」移除本次描述文件。移除后再联网访问测试服务器将不再受信任，不要绕过警告；已保存离线资源的实际行为仍按真机步骤验证。

## 启动静态 HTTPS 服务

维护者读取本次 `setup.json`，设置下面四个值。路径必须指向同一个新生成目录，地址必须与证书参数一致：

```powershell
$env:OFFLINE_HOST='已确认的IPv4地址'
$env:OFFLINE_PORT='4187'
$env:OFFLINE_TLS_CERT='本次生成目录的完整路径/server-cert.pem'
$env:OFFLINE_TLS_KEY='本次生成目录的完整路径/server-key.pem'
npm.cmd run start:offline
```

服务只读取生成的 `.local/site/`。TLS 私钥在 `.local/tls/`，不会通过该静态站点提供。它没有远程编译、执行或草稿 API，编译调试仍在浏览器内完成。不要为了方便将整个仓库或 `.local/` 作为网站根目录。

用户在 iPad Safari 打开本次候选 HTTPS 地址，确认没有证书警告，能够打开固定版本入口并准备资源。只有实际连通与 Service Worker 准备成功后，才把精确地址、版本及指纹填入交付记录。若打不开，记录网络隔离、系统防火墙、证书名称/日期、地址变化等原因；不能把候选地址写作已可用。

资源准备与主屏入口验证完成后，继续按平板手册关闭网络与辅助电脑，冷启动编译全新源码。证书有效、HTTPS 可访问、资源下载成功均不等于 G2 已通过。

## 本轮工具验证

2026-10-26 在当前 Windows、PowerShell 7.6.5、Node.js 24.19.0 上，以 `-Address 127.0.0.1` 实际生成证书。已核验根自签、叶证书签名与 CA 约束、IP/localhost SAN、服务端密钥匹配、DER 指纹和有效期；确认未保存根私钥。临时使用本机 4188 端口，通过显式指定该根 CA 的 HTTPS 请求取得生成站点的 200 响应，未指定 CA 的默认信任请求仍拒绝证书；私钥 URL 返回 404。测试服务已停止，没有安装系统证书或开放局域网。结果位于忽略目录 `app/offline/.local/tls-check-result.json`，不作为 iPad 已信任证书或已联网通过的证据。

Python 标准库解析实际生成的描述文件，确认只有一个根证书载荷，证书字节与 DER 相同且允许移除。真实 iPad 上的文件交付、安装、手动信任、Wi-Fi 互通、HTTPS 和离线冷启动仍待操作验证。
