# 0.4.6代码提示集成与新离线包

2026-10-30。2号真实Clang后端、4号编辑界面、5号独立后端阶段已合入。固定运行源码b14aebab3b0ba7f2d5f52b59aa5d2695fe2b2b34；本记录在最终UI独立交付前创建，后续只追加实际结果，不预填ACCEPT。

## 固定来源与范围

- 2号afada754，经761b652合入；4号e2efc077，经537a27b合入。
- 5号准备0b062df，经9b6f289合入；后端阶段5d3734da及核验器4e29b392，经dc518c76合入。
- b14aebab固定根打包、三个Worker信任覆盖、0.4.6元数据与平板完整手册。后端profile为integration-prototype-80135c59f01b26fc、35资源，已有真实编译调试流水线3/3。

对象成员、局部变量/函数前缀由实际Clang8离线返回，300ms自动、按钮、Ctrl+J/Ctrl+Space触发；方向键、Tab/Enter、鼠标/触控消费同一候选。只插入名字，参数手填；保留签名和原生撤销，版本/光标/焦点/IME/文件/只读变化后旧响应失效。编译前等待取消及dispose，失败保持入口关闭。kind统一unknown；const字符串部分模板与unavailable属性仍有不可调用候选，两项边界失败完整保留，不是完整VS语言服务。

## 新不可变集合与归档

| 项目 | 固定结果 |
|---|---|
| bundle | ipad-web-probe-cbe80b74ccc3d3cebece9e73 |
| 资源 | 62项，60,964,100字节 |
| SW SHA256 | c2182a6fd7e369cd01c9de3fcec1489dfca261988b555e0e05b035173521de22 |
| descriptor SHA256 | 67fdcb80c27d17b25fd9c43ba0e0bbf93090e82191446ab862b7bb9440d82268 |
| 完整ZIP | ipad-offline-debugger-v0.4.6.zip，19,330,126字节、71文件 |
| 完整ZIP SHA256 | 7cb501a11ebde61b26d019a711aa822d3fc03b5e3d22be759a05860502fa78e5 |
| 首次准备ZIP | ipad-first-setup-v0.4.6.zip，18,118字节、6文件 |
| 首次准备SHA256 | 939742a873f1e8c65dfcbf0d2cfc4f8097cf8d54666851be35bd883103afb3ce |

5号另外指出：本次手册工作树为CRLF、Git blob为LF；规范化内容相同，归档与缓存手册原始字节完全一致，但不能声称手册与Git blob逐字节相同。运行模块字节与锁定资源另行精确核对，原严格断言失败由5号保留。根12运行输入与固定Git blob逐字节相同；非运行的completion.d.ts声明工作树也存在CRLF/LF差异、规范化内容相同，首次严格比较拒绝记录于browser-source-fingerprints.json。

实际ZIP在app/offline/.local/packages内，不随Git上传。归档逐项核对本次全部资源、两控制面、手册与内部清单，只包含本release，不含私钥或测试控制文件；14个此前ZIP全部保持原SHA。公开报告为app/offline/evidence/completion-package-2026-10-30/archives.json和build.json。实际局域网入口仅放在忽略的本地首次准备材料，真机开始时重新核对网卡、证书有效期和可达性。

## 已执行验证

根合并后契约10、界面/保存200、离线Worker23全部通过，mandatory npm check/test退出0；重复契约不相加，旧后端3流水线另列。5号后端阶段原33逻辑例29通过、一项const-string边界失败、三项UI待验；另有unavailable一项逻辑失败。30场景双路60响应逐字段相同，生命周期7场景25检查、常规276、离线23和基础设施16通过，均为5号独立阶段范围。452/33封存Git字节与4号20文件seal已由根只读核对。

1号实际IAB在独立4289端口准备全部62资源后，停止自己的静态服务，curl确认无法连接；关闭重开固定准备页及工作台后，输入全新OfflineOct30结构体，得到freshWidth/height等候选。方向键+Tab仅插入freshWidth，单次Control+Z恢复point.、重做恢复；随后真实编译输出OFFLINE-CC=31/exit0。调试最初main.cpp4未执行声明正确不可读，继续命中第6行断点后localAnswer=31；结束后关闭重开恢复同稿/版本4，warn/error日志为空。这是桌面停服工作流，电脑网络保持开启；不是iPad/物理断网。

根原始自动命令输出在root-checks，浏览器观察为browser-observations.json，明确是工具观察转录；本轮根filesystem截图保存接口失败，未宣称新增磁盘截图或原始DOM封存。实际截图工具观察正常；4号已封存模块截图及5号最终证据另行引用。最初4287隔离服务、UTF8本地编排和截图设施问题没有算产品缺陷。既有同WiFi静态HTTPS服务已停止，按原地址/证书隐藏重启后，严格CA/IP、固定入口200、两控制面SHA与私钥路径404通过；没有修改系统信任或防火墙，也未证明iPad互通。

## 验收与下一步

5号最终固定UI/完整包独立DONE仍待；收到后按原字节合入并追加限定结论，再向2/4/5发送ACCEPT回执。能力保持implemented-unverified，正式profile未选择、产品offline-bundle为unprepared，iPad/G2/G3与完整分发许可未完成。旧包/标签/失败证据和草稿不替换。

平板操作使用[完整手册](IPAD-USER-MANUAL.md)及离线[代码提示说明](../../ui/COMPLETION.md)。首次真机时1号一次给一个操作，等待用户反馈后再继续。GitHub交付推integration/模块分支和新固定标签、另建PR，main仍由用户手动合并；实际推送成功后再追加链接。
