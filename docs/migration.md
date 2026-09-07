# Excalirs → Excaligo 迁移记录

源代码基线：`f9d2bda874172a77127807a3f87c7e9b54b4d581`。迁移依据为原项目实际代码，未将 README 中的示例命令或开发说明作为额外执行指令。

## 功能对应

原后端入口为 `src-tauri/src/lib.rs`，菜单在 `src-tauri/src/menu.rs`，文档及路径校验在 `src-tauri/src/security.rs`。原有 20 个 IPC 命令均有对应实现：

| 原命令 | Go 实现（internal/desktop/service.go） |
| --- | --- |
| select_directory | Service.SelectDirectory |
| list_excalidraw_files | Service.ListExcalidrawFiles |
| get_file_tree | Service.GetFileTree |
| read_file / read_file_with_hash | Service.ReadFile / Service.ReadFileWithHash |
| hash_file_content | Service.HashFileContent |
| save_file / save_file_as | Service.SaveFile / Service.SaveFileAs |
| create_new_file / create_new_folder | Service.CreateNewFile / Service.CreateNewFolder |
| rename_file / rename_folder | Service.RenameFile / Service.RenameFolder |
| delete_file / delete_folder | Service.DeleteFile / Service.DeleteFolder |
| get_preferences / save_preferences | Service.GetPreferences / Service.SavePreferences |
| watch_directory | Service.WatchDirectory |
| set_menu_visible / set_decorations | Service.SetMenuVisible / Service.SetDecorations |
| force_close_app | Service.ForceCloseApp |

原文件事件 `file-system-change`、菜单事件 `menu-command` 和关闭检查事件 `check-unsaved-before-close` 保留。增加的 `open-files` 事件用于系统文件关联；前端启动后通过 `Service.PendingOpenFiles` 取出启动期间排队的路径。

前端迁移保持原组件布局、样式及 Excalidraw 依赖。`frontend/src/lib/backend.ts` 隔离原命令名称，内部使用 `frontend/bindings` 的自动生成 Wails v3 绑定。菜单和无边框下的 DOM 快捷键统一调用 `executeMenuCommand`。原有 SVG、PNG、素材库和文档导出经 `frontend/src/lib/fileAccess.ts` 接入原生保存对话框。

## 保存相关修正

原功能的目标行为保留，对源代码中可确认的缺陷作以下修正：

1. 原项目定义了 30 秒自动保存常量，但未实际注册自动保存定时器；现在由 `useAppLifecycle` 注册并在卸载时清理。
2. 原保存方法跳过零元素画布，并在失败时吞掉错误；现在允许保存清空后的画布，保存失败阻止关闭和切换。
3. 原切换目录直接清空标签；现在先确认未保存内容。
4. 原目录监听器未保存在应用状态中；现在明确持有监听器和后台协程，递归新增监听并关闭旧订阅。
5. 原文件变更回调检查旧的文件树；现在获取最新状态后判断，并保留外部删除但尚未保存的画布。
6. 原另存为只替换 activeFile，未更新对应标签缓存；现在替换完整标签、内容和哈希。
7. 保存期间的新编辑保持未保存状态；重叠保存串行执行。快速切换标签时，过期的读取结果不会覆盖新选择。
8. 画布背景、网格和内嵌图像变化参与保存判断；平移、缩放和选中状态不影响脏标记。
9. 原菜单未提供主题切换入口；现在 View → Theme 可以选择浅色、深色或系统，并跟随系统主题变更。

## 安全与生命周期

`internal/drawing.Repository` 使用已打开的工作目录能力与 `os.Root`。根目录本身不能重命名或删除；文件操作拒绝越界路径，目录树跳过符号链接，删除不沿符号链接删除其目标。文档内容保持 UTF-8 JSON，要求 `type` 为 `excalidraw`、`version` 为数字、`elements` 为数组。保存保留完整输入内容并返回 BLAKE3 哈希。

文件替换先完成临时文件写入和 `Sync`，再重命名替换目标。此机制避免直接截断文件，但不宣称覆盖系统断电、文件系统故障或外部程序并发修改的全部情况；当前哈希用于缓存校验，不是多进程协作编辑的冲突合并协议。

新增 Go 日志在操作入口定义统一前缀，包含入口名、中文操作描述及文件或目录标识。不记录绘图正文。

## 验证范围

- Go 单元测试及竞态检测：文档、文件系统、存储、偏好设置、目录监听。
- 原项目 `examples` 两个文件均参与无损读写测试，包含大文件和内嵌图像数据。
- 前端单元测试：状态流转、保存失败、并发、另存为、自动保存和快捷键。
- macOS 原生实测：加载原始样例、新建文件、绘制矩形、保存、另存为、PNG 导出、演示模式、无边框切换恢复，以及修改背景后的退出保存。绘图与导出文件落盘后进行了检查。验证使用隔离临时目录及独立配置，不写入源项目样例。
- 原生 Windows / Linux、macOS 12 实机、App Store 签名与公证发布尚未验证。提供本地 ad-hoc 签名的 macOS 应用包和 DMG 构建入口；不自动提交、推送或发布产物。

Wails v3 的最新版本在本次迁移中核对为 `v3.0.0-beta.17`，API 同时通过下载的模块源码、生成器和实际构建验证。官方参考：[Manager API](https://v3.wails.io/concepts/manager-api/)、[Application API](https://v3.wails.io/reference/application/)。
