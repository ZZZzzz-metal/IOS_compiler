# iPad 离线 C/C++ 编译调试工具

**2、3 号的编译调试原型和 5 号的独立样例、验收脚本已合入同一仓库。** 全新 C11/C++17 样例通过 Wasm Clang/LLD 编译，实际产物交给调试器，支持已测范围内的断点、三种单步、变量与递归调用栈。iPad 真机离线、完整界面和安装包仍待验收，路线未冻结。

## 项目与交付

- 仓库：`C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger`
- 集成分支：`integration`；本轮标签：`integration-v0.2.1`（加入 5 号验收）。
- 首次基线 `baseline-v0.1.0` 保留；契约仍为 `0.1.0-draft.1`。
- [2/3 编译调试集成](docs/architecture/INTEGRATION-2026-10-25.md)、[5 号验收接入](docs/architecture/VALIDATION-INTEGRATION-2026-10-25.md)、[统一状态](docs/architecture/STATUS.md)。

## 运行真实联合原型

开发电脑需要 Node.js 22+，零第三方 npm 依赖。当前电脑的 11 项工具链资源已经本地校验；新 checkout 的四个大二进制不在 Git 内，首次运行准备脚本可获取固定资源，也可从已有副本复制后校验。

```powershell
Set-Location -LiteralPath 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger'
node compiler/scripts/prepare-toolchain.mjs --verify-only
npm.cmd run demo:integration
npm.cmd run test:integration
```

缺少资源时先执行 `npm.cmd run prepare:toolchain`，首次获取需要网络。demo 会真正编译带唯一标记的新源码并输出构建身份、调试事件和检查结果；不依赖兄弟工作区或预先编译的样例。它验证 C++ 三种单步、容器/指针/递归帧，C 批量输入和 64 位数值，以及终止死循环后新源码重编译。Node 是开发验证宿主，不是 iPad 所需环境。

桌面浏览器联合实验使用同仓库资源：

```powershell
npm.cmd run prepare:probe
npm.cmd run start:probe
```

打开 [联合实验页](http://127.0.0.1:4173/debugger/probe.html)，先准备资源再运行。这个页面使用 3 号的小型实验入口；静态服务器不参与编译或调试计算。浏览器实验的缓存就绪与产品完整离线就绪分别验收。localhost 入口仅供当前开发电脑，不能直接用作 iPad 安装入口。

## 其他检查

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run test:modules
npm.cmd run test:acceptance
npm.cmd run test:regressions
npm.cmd start
```

`npm start` 报告当前状态；真实流水线使用 `demo:integration`。`test:modules` 运行编译器和调试器各自的真实样例与故障检查。原始模块证据保留各自版本归属，本轮结果另存于集成记录。

`test:acceptance` 运行 5 号的 21 组独立检查，`test:regressions` 执行同名遮蔽与循环头变量的最小复现。默认读取本仓库组件，不自动联网；新证据与 5 号的原始失败记录分开保存。样例清单还包含人工验收预期，不能把脚本通过理解为清单全部已执行。

## 当前边界与交接

固定开发组合为 Clang/LLD 8.0.1、旧 `wasi_unstable`、wasm32、小端、O0 与嵌入 DWARF4，string/vector 解释针对已验证的 libc++ `std::__2` 布局。完整语言/标准库覆盖、C++ 异常、RTTI、线程及新 Wasm 提案均未建立支持结论；`bits/stdc++.h` 不支持。二进制与源码映射及全部依赖许可证仍需补齐，不能把当前研发资源视为已具备正式分发条件。

开发候选按实际资源生成，未写入正式兼容组合注册表。`selectedCompatibilityId` 仍为空，完整离线资源包仍为未准备。4 号可按共同接口接入实际会话，5 号独立复测；通过 G2 真机离线关卡后，1 号再冻结路线与扩大安装交付。

- [启动与工作区说明](docs/architecture/START-HERE.md)
- [范围与测试驱动](docs/architecture/SCOPE.md)
- [目录所有权](docs/architecture/OWNERSHIP.md)
- [共享接口与时序](contracts/README.md)
- [候选路线证据](docs/architecture/ROUTES.md)
- [真机验证操作单](docs/architecture/GATES.md)
- [离线资源与更新设计](docs/architecture/OFFLINE.md)
- [1 号交付记录](docs/handoffs/01.md)
