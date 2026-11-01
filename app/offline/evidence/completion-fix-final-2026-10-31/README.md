# v0.4.7 最终集成核证

新包独立交付8cfa15dbf4b3dbeabf3323815bb6dc6f086dc2de已合入da068fedbc23bea6a69c98d8935d11ed55b5ae82。本目录记录10月31日形成的包/续验证据的最终集成，最终强制命令实际于2026-11-01执行，精确UTC时间见final-checks.json；目录名不是这些命令的执行日期。

check和test退出0，契约10通过。node app/main.mjs正确保留正式offlineReady=false/真机待验。root-evidence使用Python -X utf8只读核证33封存文件及22份原始观察通过。默认GBK读Git中文路径的首次harness失败由root-verifier-invocation.json另记，保留原封存脚本与观察。

independent-package-merge.json记录142个所有权内变更、132封存文件及其清单的Git字节复核。独立审阅者也以cat-file --batch逐项确认133个Git blobs，且run01→run02只纠正真实undo选区，未改原oracle。根另一位独立审阅者审阅README/STATUS/app/main/最终报告/01/握手，未发现阻塞发布的矛盾，并只读复核33文件及22观察通过。Git最终原字节核对在本目录提交后执行，其实际结果由后续发布回执记录。

dependency-count-clarification.json保留50静态边+1浏览器动态边的准确分类；旧28文件封存中51误标static的原记录不重写。publication-preflight.json是发布前旧远端身份快照，不能当作最后发布完成回执；实际新标签/PR状态另存后续发布目录。

final-checks.json另核对从固定912a23bf至最终集成的包输入diff为空，以及两份ZIP SHA不变。没有重建、覆盖或上传本地ZIP，没有移动旧标签，没有改正式能力状态。最终结论只覆盖报告列明的桌面范围，iPad/物理断网/实体输入/后台存储与G2/G3仍待。
