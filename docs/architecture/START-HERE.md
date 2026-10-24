# 共同基线启动与交接

仓库：`C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger`

集成分支 integration；共同标签 baseline-v0.1.0；协议 0.1.0-draft.1。标签建立后固定不移动；修订用新标签并通知各模块。当前不配置远程仓库，没有上传 GitHub 或发布应用。

## 每个上下文第一次进入

1. 读取 AGENTS.md、README.md、contracts/README.md、自己的目录说明、docs/architecture/STATUS.md。
2. 在仓库执行 `git rev-parse baseline-v0.1.0` 记录完整提交号；`git status --short` 检查现有改动。
3. 已有合适的独立工作区就复用；没有时基于同一标签建立自己的工作区，不能在 1 号 integration 工作区切分支并行编辑。
4. 确认 `git branch --show-current` 和 `git rev-parse --show-toplevel` 指向自己的工作区，再只修改所有权内的文件。

下列命令由对应上下文按需执行，不表示已经建立了全部工作区：

```powershell
Set-Location -LiteralPath 'C:\Users\20964\Documents\ChatGPT\C++算法编译器\ipad-offline-debugger'
git worktree add -b module/02-compiler '../ipad-debugger-02' baseline-v0.1.0
git worktree add -b module/03-debugger '../ipad-debugger-03' baseline-v0.1.0
git worktree add -b module/04-ui '../ipad-debugger-04' baseline-v0.1.0
git worktree add -b module/05-validation '../ipad-debugger-05' baseline-v0.1.0
```

目录存在或分支已存在时先检查/复用，不删除重建。支持的 Codex 项目可优先用应用的工作区创建工具，并指定相同基线；本地命令是无需远程配置的备选。

## 当前最小启动

Node.js 22+，无需下载依赖：

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

这些入口仅检查共同结构、状态和部分不变量。2/3 接入真实实现后，在各自目录提供独立运行与复现方式，再交由 1 号整合入口。Node 状态检查不是可在 iPad 安装的应用。

## 交付与整合

每位负责人填写 docs/handoffs/编号.md，记录起始标签、实际提交号、变更文件、运行命令/环境/结果、未验证、依赖与下一步。提交后由用户转发记录或在共享仓库提供分支名；不要假设不同聊天共享历史，也不要未经用户授权互发消息。

1 号读取具体分支与记录，逐项集成共享变更，再请 5 号独立验证。G2 前不发布 frozen 路线；G2 后才扩大 UI 与安装交付。后续基线迁移由 1 号说明，不能自行更新协议号形成多套契约。
