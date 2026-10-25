# 共同基线启动与交接

仓库：`C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger`

更新：2026-10-25。集成分支 integration；首次架构标签 baseline-v0.1.0 保持固定；本轮 2/3 集成交付使用 integration-v0.2.0。协议仍为 0.1.0-draft.1。标签建立后固定不移动；后续修订另发标签。当前不配置远程仓库，没有上传 GitHub 或发布应用。精确提交与结果见 [本轮集成报告](INTEGRATION-2026-10-25.md)。

## 每个上下文第一次进入

1. 读取 AGENTS.md、README.md、contracts/README.md、自己的目录说明、docs/architecture/STATUS.md。
2. 在仓库执行 `git rev-parse integration-v0.2.0` 记录本轮完整提交号；`git status --short` 检查现有改动。首次标签仍可用 `git rev-parse baseline-v0.1.0` 查看。
3. 已有合适的独立工作区就复用。2/3 已有模块分支和工作区，不重复创建，也不由 1 号切换它们的分支。已有工作区先保留未提交改动，再按所有权协调合入新标签；没有工作区的 4/5 从本轮标签建立，不能在 1 号 integration 工作区切分支并行编辑。
4. 确认 `git branch --show-current` 和 `git rev-parse --show-toplevel` 指向自己的工作区，再只修改所有权内的文件。

下列命令仅供尚未建立工作区的对应上下文执行；先确认本轮标签存在：

```powershell
Set-Location -LiteralPath 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger'
git worktree add -b module/04-ui '../ipad-debugger-04' integration-v0.2.0
git worktree add -b module/05-validation '../ipad-debugger-05' integration-v0.2.0
```

目录存在或分支已存在时先检查/复用，不删除重建。支持的 Codex 项目可优先用应用的工作区创建工具，并指定相同基线；本地命令是无需远程配置的备选。

## 当前最小启动

开发电脑使用 Node.js 22+，无第三方 npm 依赖。先查看状态并检查共同约定：

```powershell
node app/main.mjs
node app/main.mjs compiler
node app/main.mjs debugger
node app/main.mjs ui
node app/main.mjs storage
node app/main.mjs validation
node scripts/check-baseline.mjs
node --test contracts/checks/*.test.mjs
```

以上状态入口只报告接入情况与部分共同不变量。实际编译调试使用下列入口：

```powershell
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd run test:modules
npm.cmd run test:integration
npm.cmd run demo:integration
```

`prepare:toolchain -- --verify-only` 只校验固定的本地工具链资源，不联网或写入。省略 `--verify-only` 时会按锁定来源下载缺少的文件；资源准备细节见 compiler/README.md。当前电脑的集成仓库已具备并校验这些字节；大二进制未加入 Git，单独新建工作区不会自动获得它们。保留相同工具链清单与 SHA-256，不用未校验的替代文件。真实联合演示每轮生成新源码、由 CompilerAdapter 构建并交给 WorkerDebuggerAdapter 执行。

需要浏览器诊断入口时：

```powershell
npm.cmd run prepare:probe
npm.cmd run start:probe
```

打开启动命令输出的本机地址，按页面操作准备资源与执行诊断。服务只提供静态本地资源；原型的源码编译、执行和调试在本机完成。这里使用 Node 是开发复测方式，不代表 iPad 需要 Node。浏览器模块缓存与桌面运行证据不能替代 G2 的真机断网冷启动验收。

## 交付与整合

每位负责人填写 docs/handoffs/编号.md，记录起始标签、实际提交号、变更文件、运行命令/环境/结果、未验证、依赖与下一步。提交后由用户转发记录或在共享仓库提供分支名；不要假设不同聊天共享历史，也不要未经用户授权互发消息。

本轮 1 号已合入 2 号 34e46b9 和 3 号 4138dcd，分别形成合并提交 3dba55b 和 e4e1ceb；统一入口及复测结果见集成报告。5 号以集成标签重新提供独立样例与复测；4 号继续按 G2 前有限原型范围消费真实适配器。

G2 前不发布 frozen 路线；G2 后才扩大 UI 与安装交付。后续基线迁移由 1 号说明，不能自行更新协议号形成多套契约。
