# 只读查看与 Excalidraw 内核维护

## 设计边界

Excalidraw 保持官方 npm 包，不维护私有 fork，不修改 `node_modules` 源码。应用使用公开的 `theme`、`viewModeEnabled`、`onChange` 和 `excalidrawAPI`；编辑器适配组件使用官方类型，升级时由 TypeScript 检查接口兼容性。

外壳按钮位于 `frontend/src/components/DocumentModeButton.tsx`，沿用现有工具栏的颜色、字体和布局，不向 Excalidraw 内部菜单插入业务逻辑。版本信息位于现有设置面板。

## 只读与保存

- `frontend/src/store/useStore.ts`：`readOnly` 默认开启，`savingBeforeReadOnly` 标记切换中的保存；二者仅存在内存，不写入偏好设置或绘图文件。
- `toggleReadOnly`：进入编辑不写盘；返回只读时先通过公开属性将编辑器设为查看状态，等待失焦回调，然后保存。已有自动保存和最后一次修改会按顺序完成；保存失败保留编辑状态、内容和脏标记。
- 保存期间拒绝新的文件切换、标签关闭、重命名和删除，完成前重复点击模式按钮不会发起第二次切换。异步结果仅更新原保存目标，不改变其他文件的模式。
- `frontend/src/components/ExcalidrawEditor.tsx`：只读、演示或非活动标签的变更回调不更新文件内容和脏标记。拖动、缩放仍由 Excalidraw 正常处理，保留在当前画布实例内。
- `saveCurrentFile`：即使误收到显式保存内容，只读状态也不会调用文件写入服务；自动保存另外检查只读和过渡状态。应用“另存为”在只读时提示先进入编辑模式。
- `frontend/src/lib/scene.ts`：`sceneFingerprint` 排除视口、选区及主题；`serializeScene` 只覆盖绘图相关字段，保留原文件视口与其他元数据，不将当前查看状态写入文件。
- 新建文件、磁盘打开和切换已保存标签均默认只读；未保存缓存若仍存在，则保持可编辑以免锁住待保存内容。模式切换本身不重新挂载编辑器。

这是应用内的查看策略，不是文件系统权限控制。用户明确确认的文件管理和图片导出仍然可用，其他应用对文件的修改也不会被阻止。

## 版本与升级

2026-09-08 查询 npm `latest` 和 [官方发布页](https://github.com/excalidraw/excalidraw/releases/tag/v0.18.1)，最新稳定版为 **0.18.1**。项目此前已经安装该版本，本次改为精确固定 `0.18.1`，没有将未发布版本作为升级结果。

`frontend/vite.config.ts` 在开发、测试和正式构建时读取安装包的版本，验证其为稳定版本，再注入 `frontend/src/lib/version.ts` 使用的常量。设置面板显示该值，无需第二处硬编码。

后续升级流程：

1. 查询 npm `latest`，核对官方发布说明及 React peer dependencies，不使用 `next`、`rc` 或 preview。
2. 在 `frontend/package.json` 固定经确认的新版本，通过 npm 更新 `frontend/package-lock.json`。
3. 重新审查 overrides。当前对 Radix Tabs、nanoid、Mermaid parser、lodash-es 和 immutable 的约束用于兼容或安全修复；上游修复后再评估移除，不能直接复制旧约束到新内核。
4. 执行 TypeScript、全部前端测试、Go 竞态测试、依赖审计与 macOS/Windows 构建。
5. 原生验收：打开旧文件、图片/文字/空画布、文本转图、主题、只读拖动缩放、编辑转只读保存、保存失败及文件导出。只读浏览前后对比文件字节及修改时间。

本次依赖审计由 10 项告警降至 0；使用兼容版本更新依赖和既有 overrides，没有通过降级 Excalidraw 或关闭审计消除告警。Mermaid 更新需要相应 parser 导出；配套更新后，构建及原生 Mermaid 预览/插入均通过。

## 审查与验证记录

- Go `vet` 及 `test -race` 通过；TypeScript 与 53 项前端测试通过。
- 测试涵盖只读写入拦截、视口不进入保存内容、保存失败重试、等待已有自动保存、保存期间的最后一次编辑、重复切换和导航拦截、新打开及缓存标签的只读默认值、主题无重挂载、版本显示与真实依赖一致。
- macOS 原生 `.app` 构建和本地签名通过，Windows x64 GUI 可执行文件交叉编译通过。
- 原生验收使用独立临时配置和样例副本。首次只读打开后，拖动、缩放、保存快捷键、主题和语言切换，样例字节及修改时间均未变化。
- 编辑文字后切回只读，文件中包含最后输入的文字，脏标记清除；继续只读浏览不再改写。未结束的文本输入也验证了直接点击模式按钮保存。
- 新建文件默认只读；Mermaid 预览、插入和保存通过；切换标签默认只读；退出前处于编辑模式，重启后恢复为只读。
- Windows 桌面交互和保存失败的原生系统对话框未在本机实测；保存失败及竞态由自动化测试覆盖，不能等同于 Windows 实机验收。
