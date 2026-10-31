# Windows只读Git核验器修复证据

首次452路径Git核对触发ENAMETOOLONG；原始错误和旧脚本完整保留。
修复仅分批、保序读取hash-object/rev-parse，大小/SHA/文件集合/HEAD字节检查保持。
主452及旧66/67/179文件verify --git均通过，check/test/语法另列。
主证据与其已提交清单未改，本目录另封存；不是产品修复，不改变const/属性边界失败。
