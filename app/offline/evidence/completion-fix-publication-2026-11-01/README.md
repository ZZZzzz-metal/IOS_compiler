# 2026-11-01 v0.4.7 实际发布回执

固定integration-v0.4.7目标ca86a65772818ef2a65b86471322b58577775c62，对象8646719f32127b9df05a6e25d924ef62977a89e7。integration、5号固定交付8cfa15d及新标签原子推送成功；remote-refs-after-push.json记录实际只读远端检查，2/4分支亦在各自固定交付，main及旧v0.4.6标签对象和目标均不变。

github-pr-ready.json为实际API回读的公开元数据：PR #4 open、draft=false、merged=false、head=ca86a657、base=ef5d390、maintainerCanModify=false。pr-description.json是该次公开标题/正文的输入，凭据只在原生调用内存中使用，不进入证据目录。后续文档回执提交将前移integration/PR头，不移动此固定标签，也不改变包。实际最终文档提交身份从Git历史与远端取得，不能把当前回执的旧头误作最后头。

handshake-receipts.json记录1号真实发出的ACCEPT通知和2/4/5明确回复的ACK-ACCEPT-DESKTOP，含具体固定版本及桌面/真机边界。消息发送成功与对方明确ACK分别记录；此轮已收齐三方ACK。

post-commit-verification.json记录根33续验和15最终集成文件提交后Git原字节核对；independent-final-git-review.json为另一个只读审阅者对固定提交的50个blobs（含两清单）复核。5号132文件新包交付及原语义证据在各原封存目录保留。

whitespace-full原文保留完整检查exit2，仅四份原始证据的CRLF行尾；精确排除这四份后其余内容exit0。没有清洗原始日志。发布回执提交的空白检查显式使用cr-at-eol，保留blank-at-eol、blank-at-eof、space-before-tab检查，接受原始CRLF而不修改仓库配置。

发布前后各项强制check/test的实际命令、时间和输出分别保存，不累加成额外用例；本目录清单不含自身，封存后Git原字节另核。真实iPad/G2/G3仍未通过。ZIP、TLS私钥和大资源未上传，用户手动合并main。
