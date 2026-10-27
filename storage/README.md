# 4 号：本地草稿

所有权：4 号。`src/draft-store.mjs` 实现 contracts/protocol.d.ts 中 StorageAdapter 的浏览器 IndexedDB 原型，不新增根依赖。正式启动入口仍由 1 号管理；`node app/main.mjs storage` 只是共同状态入口。

保存 userText/driverText/语言/stdin，使用 revision 防止旧保存覆盖新内容；保存失败显式反馈。重开恢复、复制/导出实际字节、迁移中断后的旧稿恢复必须由 5 号真机复测。

导出 user-source 不夹带测试驱动；complete-project 保留驱动及必要清单。草稿库与工具链更新资源分开，升级不得先删除草稿。资源撤销或存储清理不得继续宣称离线就绪。

## 接入方式

```js
import { createDraftStore, createDraft, serializeDraft, parseImport } from './src/draft-store.mjs';
import { createAutosave } from './src/autosave.mjs';

const store = createDraftStore();
const autosave = createAutosave({ store, onStatus: ({ state, error }) => { /* 显示保存状态与失败 */ } });
const restored = await autosave.restore('main');
// 只有 restore 成功后才接受编辑；没有旧稿时返回 null。
autosave.schedule(createDraft({ id: 'main', userText: 'int main() {}', stdin: '' }));
await autosave.flush();
```

`createDraftStore({ indexedDB, dbName })` 支持注入浏览器数据库工厂，默认库名 `ipad-debugger-drafts-v1`，草稿对象仓库名 `drafts`。`save(draft, expectedRevision)` 在一个读写事务内读取、比较并写入；新草稿的 expectedRevision 必须为 null，旧稿必须匹配持久化 revision。成功 revision 从 1 开始递增；传入 draft.revision 不充当写入锁。事务完成才报告保存成功；配额不足、库不可用、版本阻塞、数据损坏和版本冲突均显式抛出带 code 的错误。

`createAutosave({ store, onStatus, delayMs: 400 })` 仅保留串行保存期间的最新编辑，`restore(id)` 读取持久化版本，`schedule(draft)` 安排保存，`flush()` 等待写入，`retry()` 显式重试，`status` 返回 state/revision/error/dirty。失败保留最新待保存稿；冲突时不得提高 expectedRevision 强行覆盖，应先复制/导出当前内存稿，再重新打开核对。关闭前调用 flush；浏览器强制关闭或终止时的最后一次异步写入不能保证完成。

`serializeDraft(draft, 'user-source')` 导出当前内存中的源码原文，包含原有换行/空白，不包含驱动；`complete-project` 导出格式标识、schemaVersion=1 和完整 Draft 的 JSON。`store.export(id, mode)` 则导出已持久化稿。保存失败时，界面仍可使用 serializeDraft 导出当前编辑内容。

`parseImport(text, { filename, id: 'main' })` 支持 C/C++/TXT 源文件或完整 JSON 草稿；返回新草稿但不写库，调用方显示导入内容后按当前本地版本保存。未知 JSON 版本、损坏字段及非法 Unicode 会拒绝导入，原稿保留。DB v1 的首次建库只在缺少 drafts 时创建对象仓库，无删除迁移逻辑。尚无旧产品数据库迁移，未来迁移必须另行验证中断恢复。

## 已运行检查与待验证

`node --test storage/checks/*.test.mjs` 验证精确源码导出、完整草稿往返、坏文件拒绝、存储不可用反馈、慢保存串行合并、保存失败时保留最新修改和显式重试。此检查使用可控保存适配器验证异步时序，不能替代浏览器 IndexedDB 的跨窗口事务、重开恢复、配额错误及真实 iPad 文件/剪贴板操作；这些由界面集成与 5 号继续实测。
