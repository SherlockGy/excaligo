# Excaligo

使用 Go + Wails v3 重写 Excalirs 的本地 Excalidraw 桌面编辑器。保留原项目的 React、Excalidraw、界面样式与文件格式，原 Rust/Tauri 后端由 Go 服务替代。

迁移基线为 `SherlockGy/excalirs` 的 `f9d2bda874172a77127807a3f87c7e9b54b4d581`。具体功能对应关系与验证范围见 [迁移说明](docs/migration.md)。

## 运行

需要 Go 1.25 或更高版本、Node.js 22.12 或更高版本，以及相应系统的 Wails 原生编译依赖。macOS 需要 Xcode Command Line Tools。

```sh
# 在仓库根目录执行，安装依赖、生成绑定、构建前端与 Go 程序
node scripts/build.mjs

# macOS 应用包（本地 ad-hoc 签名）
node scripts/build.mjs --package
open bin/Excaligo.app

# macOS DMG；目标文件已存在时不会覆盖
node scripts/build.mjs --dmg
```

开发模式：

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.17
# 确保 Go 的 bin 目录已加入 PATH
wails3 task dev
```

开发模式使用 Wails 原生应用和本地 Vite 热更新服务，监听 `127.0.0.1:9245`。仅运行 Vite 不会启动 Go 服务。干净检出时保留的 `frontend/dist/.gitkeep` 用于生成绑定，正式构建会先生成真实前端资源。

Wails Go 模块与 `@wailsio/runtime` 均固定为 **3.0.0-beta.17**，这是迁移时（2026-09-08）查询到的最新 v3 版本；该版本仍为 beta。采用该版本的 Service、Window / Menu / Dialog / Event Manager API，TypeScript 绑定由同版本 CLI 生成，不包含 Tauri 运行时。

macOS 打包脚本使用 Go **1.26.8**，保持原项目 macOS **12.0** 的最低系统目标；Go 会按需下载该工具链。直接用 Go 1.27 编译的程序需要 macOS 13 或更高版本。依据：[Go 1.26 发布说明](https://go.dev/doc/go1.26#darwin)。

## 功能

- 文件夹树与递归文件列表、文件夹优先排序、隐藏文件过滤。
- 文件及文件夹新建、重命名、删除；重名时最多尝试 100 个数字后缀。
- Excalidraw 完整绘图编辑器，多标签页、画布缓存和 BLAKE3 外部变更检测。
- 手动保存、30 秒自动保存、另存为、PNG / SVG / Excalidraw / 素材库导出。
- 关闭、切换文件和目录前的未保存确认；保存失败会保留编辑内容。
- 递归目录监听，创建新子目录后继续监听，切换目录会关闭旧监听。
- 原生菜单、最近 10 个目录、浅色 / 深色 / 系统主题、侧边栏开关。
- F5 演示模式、激光笔、Escape 退出演示、无边框模式、全屏和窗口控制。
- `.excalidraw` 文件关联及命令行文件打开。内置字体，离线加载画布。

偏好设置保存在系统配置目录的 `excaligo/preferences.json`，可用 `EXCALIGO_CONFIG_DIR` 指定配置父目录以隔离开发与测试。文件采用与原项目相同的 `preferences` 包装对象及 snake_case 字段；不会自动改写旧应用的配置文件。绘图文件可以直接打开，无需转换。

删除操作与原项目一致：经过界面确认后直接删除，文件夹包含的内容也会删除，不会移入回收站。

## 包结构

```text
cmd/excaligo/          程序入口
internal/desktop/     Wails 装配、原生窗口/菜单/对话框、IPC 服务
internal/drawing/     文档校验、BLAKE3、目录树与受限文件操作
internal/preferences/ 偏好设置及持久化
internal/watcher/     递归监听和资源生命周期
internal/storage/     原子文件替换
frontend/             React 前端、生成的绑定及嵌入资源
build/                Wails 开发配置、平台元数据和图标
scripts/              构建与打包入口
examples/             原项目绘图样例
```

业务包不依赖 Wails，便于单元测试。`internal/desktop` 只负责平台适配；不使用无实际外部消费者的公共 `pkg` 目录。运行时文件能力由用户选择或上次保存的工作目录授予，通过 Go `os.Root` 限制路径访问并防止符号链接越界。目录树跳过符号链接；新建使用排他创建，保存采用同目录临时文件写入、同步、关闭、重命名。目录监听和打开的文件系统根在服务关闭时释放。

## 验证

```sh
go test -race -coverprofile=coverage.out ./...
go vet ./...
npm --prefix frontend run typecheck
npm --prefix frontend run test:run
```

Go 测试包括原始样例无损往返、文件操作、JSON 校验、BLAKE3 向量、路径和符号链接越界、并发新建、写入失败、偏好设置兼容与目录监听生命周期。前端测试覆盖保存失败拦截、空画布、并发保存、自动保存、标签缓存、异步读取顺序、另存为和快捷键。

CI 在 macOS 上构建应用包并执行上述检查。macOS 原生界面已进行本地验证；Windows / Linux 尚未完成原生构建及交互验收。macOS 12 的最低版本元数据与编译目标已配置，尚未在 macOS 12 实机上验收。

## 来源

前端组件、样式、图标与样例来自提供的 Excalirs 项目；保留其文件 `source: ExcaliApp` 标识。绘图引擎来自 [Excalidraw](https://github.com/excalidraw/excalidraw)，桌面框架来自 [Wails v3](https://v3.wails.io/)。原项目的 README 声明 MIT，但本地基线未附 `LICENSE` 文件，因此本次未代替上游添加新的许可证声明。
