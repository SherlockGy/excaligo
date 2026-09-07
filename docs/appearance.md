# 应用外壳主题与语言

首次审查基线已推送至 `main`，提交 `d7b22f8781c0fa0b1683fe80db7351badc36e338`。本功能在该基线之后实现。

## 范围

- macOS、Windows 共用 React 外壳设置面板，提供亮色、暗色、跟随系统及中文、英文。
- 原生菜单中的主题和语言命令与设置面板调用相同状态更新入口。
- 翻译包括侧边栏、空状态、标签关闭提示、文件操作菜单、未保存确认、应用错误提示、新建文件对话框和快捷键帮助。
- Excalidraw 只接收主题，未设置 `langCode`。画布标签不因语言变化而重新挂载，语言切换不修改绘图文件。
- 系统原生标题栏及文件选择器内置控件仍采用系统外观和语言；不修改系统全局设置。

## 实现

- `frontend/src/components/ShellSettings.tsx`：独立设置面板，可通过键盘访问、Escape 或外部点击关闭。
- `frontend/src/hooks/useTheme.ts`：显式主题与系统主题解析，订阅及清理系统外观变更。
- `frontend/src/store/useStore.ts`：设置更新、串行持久化及失败回退。
- `internal/preferences/store.go`：`language` 向后兼容、允许值校验、原子持久化。
- `internal/localization/locales`：Go 和 TypeScript 共享中英文文案。
- `internal/desktop/menu.go`：原生菜单翻译、主题与语言选择、跳过相同菜单配置并释放旧菜单项。
- `scripts/build.mjs`、`scripts/run.mjs`：跨平台构建和启动，Windows 使用 GUI 子系统。
- `.github/workflows/ci.yml`：macOS 和 Windows 矩阵验证。

## 已执行验证

- Go 业务包及本地化目录测试、竞态检测和 `go vet`。
- 37 项前端测试及 TypeScript 检查，包含设置落盘、旧配置兼容、失败回退、系统主题订阅清理、翻译键/占位符和 Excalidraw 语言隔离。
- macOS 原生窗口：从设置面板切换亮/暗和中/英，从原生菜单切换语言，新建文件中文提示，隐藏侧边栏与无边框下访问设置，退出后重新启动恢复中文暗色。
- 测试使用独立临时配置与样例副本；切换和重启后样例副本与原文件逐字节一致。
- macOS `.app` 构建和本地签名通过；Windows x64 生产可执行文件交叉编译通过。

Windows 原生交互尚未在本机验证。CI 的配置不能代替执行结果，后续以 GitHub Actions 的实际运行状态为准。
