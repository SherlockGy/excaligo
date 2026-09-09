<p align="center">
  <img src="build/icons/icon.png" width="160" height="160" alt="Excaligo：Go 地鼠抱着带有绘图标志的紫色文件夹" />
</p>

# Excaligo

基于 [Excalidraw](https://github.com/excalidraw/excalidraw) 的本地优先桌面绘图应用，使用 Go + Wails v3 构建目录管理与桌面外壳。

Excalidraw 提供绘图编辑器，Excaligo 负责本地文件夹、标签页、只读浏览、保存和原生窗口集成。绘图文件使用标准 `.excalidraw` 格式，可直接打开和保存；编辑器保持官方依赖，不修改其内核。Excaligo 是独立项目，并非 Excalidraw 官方桌面客户端。

[下载与发布](https://github.com/SherlockGy/excaligo/releases) · [从源码构建](#从源码构建) · [MIT 许可证](LICENSE)

## 功能

- **本地目录管理**：文件夹树、新建文件与子目录、重命名、删除，以及侧边栏拖动移动文件。
- **多标签页**：缓存画布和未保存内容；侧边栏与标签页都用文件名前的黄点提示未保存状态。
- **默认只读**：打开文件先浏览，需要修改时再切换编辑；编辑转只读前自动保存。
- **只读交互开关**：可开启直接滚轮缩放、左键拖动画布，浏览操作不改写绘图文件。
- **外部修改处理**：当前只读文件自动重载，保留查看位置；保存时检测外部版本变化，发生冲突后由用户选择。
- **绘图与导出**：使用 Excalidraw 编辑器，支持手动保存、30 秒自动保存、另存为，以及 PNG、SVG、Excalidraw 和素材库导出。
- **主题与语言**：亮色、暗色、跟随系统；应用外壳支持中文和英文，主题也同步到编辑器。
- **桌面集成**：原生菜单、最近目录、全屏、无边框窗口、演示模式及文件打开入口；内置字体支持离线加载画布。

## 下载与运行

在 [GitHub Releases](https://github.com/SherlockGy/excaligo/releases) 查看已发布版本。发布流程生成以下文件：

| 平台 | 发布文件 | 使用方式 |
| --- | --- | --- |
| macOS · Apple Silicon | `Excaligo-v<版本>-macos-arm64.zip` | 解压后打开 `Excaligo.app` |
| macOS · Intel | `Excaligo-v<版本>-macos-amd64.zip` | 解压后打开 `Excaligo.app` |
| Windows · x64 | `Excaligo-v<版本>-windows-amd64.exe` | 直接运行，无需安装 Excaligo |
| 校验文件 | `SHA256SUMS.txt` | 核对下载文件的 SHA-256 |

macOS 构建目标为 12.0 及以上。不使用 Apple Developer ID 证书或公证，仅有本地 ad-hoc 签名；首次打开可能需要在系统“隐私与安全性”中允许。Windows 版本不做 Authenticode 签名，可能出现未知发布者提示，运行需要 Microsoft Edge WebView2 Runtime。

没有可用发布包时，可以按下文从源码构建。普通分支推送只触发 CI 并生成 Actions 构建产物，不会自动发布 Release。

## 使用方式

### 管理绘图文件

打开一个本地工作目录，在左侧文件树中创建、打开和整理绘图。拖动单个文件到目标文件夹即可移动；拖到顶部工作目录名称或文件列表空白处可移回根目录。移动不会重新序列化绘图内容，目标重名时拒绝覆盖。

当前不支持拖动整个目录或拖入外部文件来执行移动；跨文件系统移动会失败并保留源文件，不自动执行复制后删除。

> 删除经过界面确认后直接作用于磁盘，不移入回收站。删除文件夹会同时删除其内容，请提前备份。

### 只读与编辑

新建、打开以及切换到已保存的标签页时，默认进入只读。点击工具栏的“只读”进入编辑，点击“编辑中”保存后返回只读。保存失败时，保留编辑状态和未保存内容。

只读模式下，画布拖动、缩放和主题切换不会触发绘图保存。在右上角设置中开启“只读时滚轮缩放”，即可使用滚轮直接缩放、左键拖动画布；关闭时保留编辑器默认的浏览交互。

只读是应用内的保存策略，不改变操作系统文件权限，也不禁止用户明确确认的重命名、删除或图片导出。另存为绘图文件需要先进入编辑模式。

### 外部修改与保存冲突

当前活动标签页处于只读且没有未保存内容时，外部修改会自动重载，并用非阻塞提示告知。提示不必先关闭：外部继续修改时，应用会继续检查和重载，同时保留当前画布位置与缩放。文件暂时不可读或内容尚未写完时，保留最后一次有效画面并重试。

编辑状态不会自动重载外部内容。保存时如果检测到文件版本已变化，会暂停保存并保留本地编辑，提供以下选择：

- **加载外部版本**：重新读取磁盘内容，放弃本地未保存修改。
- **用本地内容覆盖**：再次核对外部版本后保存本地内容；外部又有变化时，需要重新确认。
- **关闭提示**：保留冲突状态，不会恢复自动保存或静默覆盖。

这里采用文件版本校验，不提供自动合并、版本历史或跨进程文件锁；多程序同时修改重要文件时，仍建议保留备份。

### 主题、语言与版本

右上角设置面板提供主题、应用语言、只读交互开关和当前 Excalidraw 版本。主题与语言也可通过原生菜单“视图 → 主题 / 语言”设置，修改会保存并在重启后恢复。

主题同时影响应用外壳和 Excalidraw。语言只切换应用外壳，不切换 Excalidraw 编辑器内部文案。系统标题栏及系统文件选择器自身的语言仍由操作系统管理。

偏好设置位于系统配置目录下的 `excaligo/preferences.json`。开发和测试可通过 `EXCALIGO_CONFIG_DIR` 指定独立的配置父目录。

## 从源码构建

需要 Go 1.25 或更高版本、Node.js 22.12 或更高版本，以及相应平台的 Wails 原生构建依赖。macOS 需要 Xcode Command Line Tools。

克隆仓库后，在仓库根目录执行：

```sh
git clone https://github.com/SherlockGy/excaligo.git
cd excaligo

# 安装依赖、生成平台图标与绑定，构建前端和可执行文件
node scripts/build.mjs

# 启动构建结果
node scripts/run.mjs
```

macOS 应用包：

```sh
node scripts/build.mjs --package
open bin/Excaligo.app

# 可选：生成 DMG；同名目标已存在时不会覆盖
node scripts/build.mjs --dmg
```

Windows 使用相同的 `node scripts/build.mjs` 入口，输出 `bin/excaligo.exe`，带嵌入图标、应用清单和版本信息，不弹出控制台窗口。

macOS 打包脚本固定使用 Go 1.26.8，以保持 macOS 12.0 的构建目标；Go 会按需下载该工具链。当前仓库固定 Excalidraw 0.18.1 与 Wails v3.0.0-beta.17，Wails Go 模块、前端运行时和绑定生成器使用匹配版本。实际 Excalidraw 版本在构建时从安装包读取，无需手动维护界面版本文案。

## 开发

```sh
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.17
# 将 Go 的 bin 目录加入 PATH
wails3 task dev
```

开发模式启动 Wails 原生应用及 Vite 热更新服务，前端监听 `127.0.0.1:9245`。仅启动 Vite 不会启动 Go 服务。

### 目录结构

```text
cmd/excaligo/           程序入口
internal/desktop/      原生窗口、菜单、对话框和前后端服务适配
internal/drawing/      文档校验、文件版本、目录树和文件操作
internal/preferences/ 偏好设置持久化
internal/localization/ 中英文共享翻译
internal/watcher/      目录监听
internal/storage/      原子文件写入和移动
frontend/              React 界面、Excalidraw 适配和生成的绑定
build/                 平台元数据、图标和资源测试
scripts/               构建、打包和发布脚本
examples/              示例绘图
```

只读、主题和文件同步逻辑位于应用外壳，通过 Excalidraw 的公开 API 接入，不修改 `node_modules` 或维护私有内核分支。维护细节见 [编辑器集成说明](docs/editor-integration.md)；图标来源、格式与再生成方式见 [应用图标说明](build/icons/README.md)。

### 测试

先完成依赖安装和构建，再执行：

```sh
go test -race '-coverprofile=coverage.out' ./...
go vet ./...
npm --prefix frontend run typecheck
npm --prefix frontend run test:run
node --test scripts/release-config.test.mjs scripts/windows-resources.test.mjs
```

测试覆盖文件读写、路径边界、保存冲突、只读重载、标签切换、主题语言、拖动移动，以及原生图标和发布资源。CI 包含 Apple Silicon macOS、Intel macOS 和 Windows x64 的构建与测试。Windows 原生交互及 macOS 12 实机仍需单独验收；Linux 不在当前发布矩阵中。

### 发布

推送符合 `v1.2.3` 或 `v1.2.3-beta.1` 形式的版本标签会触发 [Release 工作流](.github/workflows/release.yml)。三平台 CI 全部通过后才发布，预发布标签会标记为 prerelease，不自动覆盖已有 Release。

本地构建完成后，执行 `node scripts/package-release.mjs` 可在 `bin/release/` 生成同格式资产及校验文件。已有同名产物不会被覆盖。

## 上游与致谢

- [Excalidraw](https://github.com/excalidraw/excalidraw)：本项目的绘图内核来源，通过官方 `@excalidraw/excalidraw` 包集成。
- [Wails v3](https://github.com/wailsapp/wails)：Go 与原生桌面窗口的集成框架。
- [React](https://github.com/facebook/react)：应用界面组件。
- [Go Gopher](https://go.dev/blog/gopher)：图标中的角色由 Renee French 原创，本项目改编为抱着绘图文件夹的地鼠，沿用 CC BY 4.0 署名要求。

## 开源协议

Excaligo 项目代码采用 [MIT License](LICENSE)，版权归属 `Copyright (c) 2026 SherlockGy`。

第三方依赖及素材保留各自的版权和许可，不因本项目采用 MIT 而改变。[Excalidraw 使用 MIT 许可证](https://github.com/excalidraw/excalidraw/blob/master/LICENSE)；Go Gopher 相关图标素材遵循 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，作者及改编说明见 [图标来源](build/icons/README.md)。本项目不代表上游项目或图标作者为其背书。
