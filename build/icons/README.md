# Excaligo 应用图标

图案由青色 Go 地鼠、紫色文件夹和用户提供的交叉绘图工具标志组成，表达 Go 实现的目录管理外壳与 Excalidraw 编辑器的组合。没有修改 Excalidraw 内核。

## 资源与来源

- `icon.png`：1024 × 1024 的透明主图，作为原生图标的唯一输入。
- `icon.icns`：macOS 图标，覆盖 32–1024 像素的普通及 Retina 表示。
- `icon.ico`：Windows 图标，包含 16、24、32、48、64、96、128、256 像素。
- `../../frontend/public/excaliapp-icon.png`：256 × 256 WebView 图标。
- `generation.json`：内置 image_gen 的完整生成及修改提示词，以及后处理记录。

Go Gopher 原角色由 Renee French 创作，依据 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 使用和改编，来源：[The Go Gopher](https://go.dev/blog/gopher)。本图重新绘制了角色，并加入文件夹、紫色配色及绘图标志；不表示 Go 项目为本应用背书。应用“关于”对话框也保留作者、来源与许可信息。

图像生成器未能输出实际透明通道，因此经用户明确授权，使用本地 Go 程序去除了仅与外部连通的中性灰棋盘格区域。内部白色眼睛、牙齿和绘图标志保持不透明。外轮廓随后进行了局部平滑、抗锯齿及边缘颜色修复；没有对内部图案作整体模糊。

## 构建与验证

在仓库根目录执行：

```sh
# macOS App
node scripts/build.mjs --package

# Windows 主机：免安装 EXE
node scripts/build.mjs

# 图标尺寸、透明通道及已构建 Windows EXE 的资源校验
go test ./build/icons -v
node --test scripts/windows-resources.test.mjs
```

构建脚本使用当前 go.mod 固定的 Wails v3 命令，从 `icon.png` 同时生成 ICNS 和 ICO。macOS 包将 ICNS 放入 `Excaligo.app/Contents/Resources/icon.icns`，由 Info.plist 引用。

Windows 构建通过 Wails `generate syso` 将 ICO、应用清单和版本信息编译为主包目录中的临时资源对象，再链接到 `excaligo.exe`。生成或编译失败时也会清理本次创建的资源对象；已有同名对象不会被覆盖。清单使用普通用户权限和 Per-Monitor DPI，不新增安装器、管理员权限或证书签名。

Windows 主机测试会读取 `bin/excaligo.exe` 的 PE 资源，核对 Wails 使用的图标组 ID 3、所有图像数据、清单和版本资源。其他主机可用 `EXCALIGO_TEST_WINDOWS_EXE` 指定交叉构建的 EXE 进行同样校验。

以后更换图标时，更新主 PNG 和 WebView 缩略图后重新运行构建与测试即可。
