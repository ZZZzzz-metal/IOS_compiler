# 共同基线启动与交接

仓库：`C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger`

更新：2026-10-25。集成分支integration；本轮交付integration-v0.3.0，包含新初始化修复、最小界面/保存和独立回归。baseline-v0.1.0、integration-v0.2.0、integration-v0.2.1均固定不动。协议仍为0.1.0-draft.1。后续修订另发标签，不移动旧标签。当前没有上传GitHub或发布应用；来源、实际结果及限制见 [v0.3.0统一界面集成报告](UI-INTEGRATION-2026-10-25.md)。

## 每个上下文第一次进入

1. 读取 AGENTS.md、README.md、contracts/README.md、自己的目录说明、docs/architecture/STATUS.md。
2. 执行 `git rev-parse integration-v0.3.0` 记录本轮完整提交号；`git status --short` 检查现有改动。历史标签保持可查。
3. 2/3/4/5现在均有独立工作区和模块分支，必须优先复用。先保留未提交与未跟踪改动，再由各自负责人同步本轮标签；不要重建目录、重置文件或在1号integration工作区切分支并行编辑。1号不会代为切换其他负责人的工作区。
4. 确认 `git branch --show-current` 和 `git rev-parse --show-toplevel` 指向自己的工作区，再只修改所有权内的文件。

已有工作区同步前先在自己的目录核对：

```powershell
git status --short
git branch --show-current
git rev-parse --show-toplevel
git rev-parse integration-v0.3.0
```

确认本轮标签已发布、改动已保留后，才按模块交接同步；遇到冲突交由相关所有者解释并保留双方修改。禁止删除重建已有工作区。

## 当前最小启动

开发电脑使用Node.js 22+，无第三方npm依赖。先检查工具链本地字节，再启动最小界面：

```powershell
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd start
```

`npm start` 与 `npm run start:ui` 均先生成当前组合的UI开发配置，再启动本机静态服务；默认地址为 `http://127.0.0.1:4184/ui/probe.html`。`npm run prepare:ui` 可单独准备配置。若该端口受旧实验缓存影响，可在启动前设置 `UI_PROBE_PORT` 为其他空闲端口；不清理旧缓存或草稿。编译与执行在浏览器Worker完成，静态服务器不提供编译API。此入口只供开发电脑验证，不是iPad安装入口。

状态检查已迁移为 `npm run status`；`node app/main.mjs`及模块参数仍保留：

```powershell
node app/main.mjs
node app/main.mjs compiler
node app/main.mjs debugger
node app/main.mjs ui
node app/main.mjs storage
node app/main.mjs validation
npm.cmd run status
node scripts/check-baseline.mjs
node --test contracts/checks/*.test.mjs
```

以上状态入口只报告接入情况与部分共同不变量。实际编译调试使用下列入口：

```powershell
npm.cmd run prepare:toolchain -- --verify-only
npm.cmd run test:modules
npm.cmd run test:integration
npm.cmd run demo:integration
npm.cmd run test:acceptance
npm.cmd run test:regressions
npm.cmd run test:initializer
npm.cmd run test:ui
```

`prepare:toolchain -- --verify-only` 只校验固定的本地工具链资源，不联网或写入。省略 `--verify-only` 时会按锁定来源下载缺少的文件；资源准备细节见 compiler/README.md。当前电脑的集成仓库已具备并校验这些字节；大二进制未加入 Git，单独新建工作区不会自动获得它们。保留相同工具链清单与 SHA-256，不用未校验的替代文件。真实联合演示每轮生成新源码、由 CompilerAdapter 构建并交给 WorkerDebuggerAdapter 执行。

运行验收或UI证据归档前，将 `VALIDATION_EVIDENCE_DIR`、`UI_EVIDENCE_DIR` 分别指定为本仓库 `tests/evidence/integrated-*`、`ui/evidence/integrated-*` 下全新的复测目录；具体参数见各测试说明。不要覆盖已封存证据，独立复验应另选目录。`npm run verify:ui`用于UI开发检查与归档，不代表5号已独立签收。

需要旧模块浏览器诊断入口时：

```powershell
npm.cmd run prepare:probe
npm.cmd run start:probe
```

打开启动命令输出的本机地址，按页面操作准备资源与执行诊断。服务只提供静态本地资源；原型的源码编译、执行和调试在本机完成。这里使用 Node 是开发复测方式，不代表 iPad 需要 Node。浏览器模块缓存与桌面运行证据不能替代 G2 的真机断网冷启动验收。

## 交付与整合

每位负责人填写 docs/handoffs/编号.md，记录起始标签、实际提交号、变更文件、运行命令/环境/结果、未验证、依赖与下一步。提交后由用户转发记录或在共享仓库提供分支名；不要假设不同聊天共享历史，也不要未经用户授权互发消息。

本轮已合入3号09a4a12、4号49eda46、5号d20b485，对应合并提交496c52e、fc72445、94ba2a7；2号34e46b9沿用。VAL-003修复分支已有5号6场景独立对照通过证据，原VAL-001/002和历史失败仍保留。本轮组合结果集中在UI集成报告；新引擎与界面/保存的整体独立验收仍交5号复验，不把4号自测或1号集成检查写成5号签收。用户将在1号交付后通知5号。

G2 前不发布 frozen 路线；G2 后才扩大 UI 与安装交付。后续基线迁移由 1 号说明，不能自行更新协议号形成多套契约。
