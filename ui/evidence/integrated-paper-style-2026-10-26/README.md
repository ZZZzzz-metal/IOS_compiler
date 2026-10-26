# 浅色纸面工作台：四号开发验证

开始采集于2026-10-26，整理交付于2026-10-27（Asia/Shanghai）。基线integration-v0.4.1：0e7be0bbe2fdd53f59db363a2fa3578f7b0003ae。此目录不覆盖此前VAL-004或五号验收记录。

## 自动检查

automated/保留verify-probe.mjs本轮运行产生的结构检查、契约10项、UI/storage34项、真实集成3项结果，全部通过。该子目录自带SHA256SUMS.json；目录根的SHA256SUMS.json覆盖本目录所有普通文件（自身除外）。这是开发自测，不是五号独立签收或真实iPad验收。

## 桌面浏览器

使用Codex内置浏览器、本机4199独立端口和真实CompilerAdapter/WorkerDebuggerAdapter。编译资源校验通过；没有模拟变量或替代调试引擎。

- first-desktop.jpg、first-narrow-code.jpg：第一批布局检查，早于禁用文字对比度和断点按钮文字集中修正。
- desktop-final.jpg：最终样式下的真实暂停状态；经过断点16、进入add、选择调用者/当前帧、跳出、跳过至main.cpp:17和vector展开。可见n=3、total=4、vector元素1/2/3，以及尚未执行声明的不可读取原因。全页截图保留了拍摄时的页面滚动及吸顶工具栏位置。
- paper-workbench-final.jpg、final-preview-dom.json：最终交付时重新打开、资源校验完成、默认示例未改动的页面。可作为整体外观截图；DOM记录文档宽度等于视口宽度1265px。
- computed-style.json：最终source/highlight计算样式完全一致；行号按钮24px。表达式输入框正常文字的12.7对比度采样键已从误写的placeholder更正为expressionText；它不是占位文字测量。禁用操作和行号文字分别为4.61、5.12、4.92。
- scroll-alignment.json：Ctrl+End后编辑器、高亮、行号三层scrollTop均为94.666664px；当前代码行与对应行号顶部均为520.197937px。
- responsive-layouts.json：最终1024×768、744×1133、375×812、320×720的DOM采样；viewport为扣除浏览器滚动条后的实际clientWidth，均等于scrollWidth。
- narrow-debug-layout.json：375×812视口下切换调试面板后的DOM状态，代码宽度0、侧栏display:block，文档未横向溢出。
- narrow-debug-final.jpg：截图工具输出仅360×237且呈现宽窗缩放内容，与同轮DOM视口/面板状态不一致，不作为窄屏视觉验收证据。另两次截图调用失败且未生成文件；未伪造替代图片。

以上为桌面响应式检查。未实测iPad Safari、触控、中文输入、软键盘、横竖屏和完整离线冷启动。

## 设计依据与范围

用户明确选择浅色纸面工作台。使用本地impeccable v4.3.1技能；通过GitHub插件读取[pbakaus/impeccable](https://github.com/pbakaus/impeccable)及其README核对来源。context运行一次；静态检测一次发现四处禁用文字对比度提示，已集中修正。最终确认后停止样式迭代。

本轮保留原控件ID、事件命令、表单值、inert锁定、24px代码行高、真实状态与VAL-004快照集合修复。新增main.mjs的body数据属性仅服务展示。运行依赖、外部字体、共享契约和旧离线包未改动。1号合入后需构建新的离线版本。
