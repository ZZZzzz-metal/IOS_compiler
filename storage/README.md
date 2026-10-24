# 4 号：本地草稿

所有权：4 号。接口为 contracts/protocol.d.ts 中 StorageAdapter；当前尚未实现。独立状态入口：`node app/main.mjs storage`。

保存 userText/driverText/语言/stdin，使用 revision 防止旧保存覆盖新内容；保存失败显式反馈。重开恢复、复制/导出实际字节、迁移中断后的旧稿恢复必须由 5 号真机复测。

导出 user-source 不夹带测试驱动；complete-project 保留驱动及必要清单。草稿库与工具链更新资源分开，升级不得先删除草稿。资源撤销或存储清理不得继续宣称离线就绪。
