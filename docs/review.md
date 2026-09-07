# 首次提交前代码审查

日期：2026-09-08。范围：Go 文件操作与持久化、目录监听、Wails 服务及菜单、前端保存和标签状态、构建与 CI。沿用迁移记录中的原始样例及 macOS 原生验收结果。

## 已修复

| 优先级 | 问题 | 修复位置与回归验证 |
| --- | --- | --- |
| P1 | 监听目录刷新时，把另存为到其他目录的标签误判为已删除 | `frontend/src/hooks/useAppLifecycle.ts`；新增外部目录标签保留测试 |
| P1 | 另存为异步返回时可能覆盖期间产生的新编辑 | `frontend/src/hooks/useMenuHandler.ts`；新增保存期间编辑保留测试 |
| P1 | 目录响应乱序或监听建立失败可能清空当前画布 | `frontend/src/store/useStore.ts`；请求序号、串行替换监听、成功后切换状态及对应测试 |
| P2 | 父子目录重复授权后，子目录被误判为不可修改的根目录 | `internal/drawing/repository.go`；合并重复能力，测试两种打开顺序及重命名后读写 |
| P2 | Windows 无法直接以非 shell 模式启动 npm.cmd | `scripts/build.mjs`；仅固定 npm 命令使用 Windows shell |
| P2 | 关闭标签后相邻文件读取失败，活动文件仍指向已移除标签 | `frontend/src/store/useStore.ts`；切换前同步清理活动文件 |
| P2 | 自动恢复无效目录时，失败被吞掉，无法清理偏好设置 | `frontend/src/store/useStore.ts`；目录操作返回明确成功状态 |

## 检查结果与边界

- `go vet ./...`、`go test -race ./...`、前端 TypeScript 检查和 29 项前端测试通过。
- macOS 生产构建和本地签名应用包构建通过。
- GitHub 远程在审查时为空仓库；提交不包含依赖目录、构建产物或个人配置。
- Windows 构建入口已修正，但本轮尚未完成 Windows 原生运行验收；不把跨平台源码当作实机验证。
- Wails 固定为 `v3.0.0-beta.17`。平台菜单、对话框及窗口行为仍受 beta 框架和操作系统影响；本轮不声称已验证所有平台原生分支。
- 保存采用原子替换，不能替代多进程冲突合并；文件删除不进入回收站。相关边界见 `docs/migration.md`。
- Go 桌面适配层主要依赖构建与原生验收；业务包单元测试不能代表原生 GUI 自动化覆盖。

后续主题与语言功能单独实现，不混入首次审查基线。

## 再次完整审查：文件管理与异步状态

日期：2026-09-08。审查基线：`e05773d`。重新检查 Go 文件与目录操作、存储边界、偏好设置、监听器、Wails 适配、编辑器和应用外壳状态、构建脚本与 GitHub Release 流程；不修改 Excalidraw 核心。

### 本轮修复

| 优先级 | 问题 | 修复与回归位置 |
| --- | --- | --- |
| P1 | 重命名未等待正在进行的保存，监听器也可能在路径更新前误关标签；删除后的旧读取可能重新打开已删除文件 | `frontend/src/store/useStore.ts` 使用统一 `fileMutationPath`，等待相关写入并使旧请求失效；`frontend/src/hooks/useAppLifecycle.ts` 协调监听与关闭；`frontend/src/store/fileSafety.test.ts` |
| P1 | 普通读取、放弃修改的读取及确认对话框返回后，可能覆盖期间出现的新画布或新修改 | 文件切换、新建、标签关闭和应用退出在异步边界核对原文件与内容；`frontend/src/store/fileSafety.test.ts`、`frontend/src/hooks/useAppLifecycle.test.ts` |
| P1 | 后台脏标签可能被磁盘重新加载覆盖，或在关闭标签、切换目录、退出应用时未经确认丢弃 | 未保存缓存优先；后台标签使用独立路径保存，并参与保存／放弃确认；`frontend/src/store/useStore.ts`、`frontend/src/hooks/useAppLifecycle.ts` |
| P1 | 重命名先检查目标再执行覆盖式重命名，外部并发创建可能被覆盖 | `internal/drawing/repository.go` 复用 `storage.MoveNoReplace`；存储层支持目录且拒绝根路径，增加目录碰撞、单字目录名和路径边界测试 |
| P2 | 用户已确认放弃修改，但关闭标签仍读取原文件，外部删除后无法关闭 | 关闭不再依赖重读；`frontend/src/store/fileSafety.test.ts` |
| P2 | 重命名使用未经后端规范化的显示名称，或占用仍在内存中的目标标签路径 | 使用后端返回路径中的实际名称；提前检查保留中的目标标签；`frontend/src/lib/fileMove.ts`、`frontend/src/store/fileSafety.test.ts` |
| P2 | 根目录中的系统关联文件，其父路径被错误截为相对路径或空字符串 | `parentDirectory` 保留 POSIX 根与 Windows 盘符根；`frontend/src/hooks/useAppLifecycle.test.ts` |
| P2 | 删除确认使用旧的未保存状态，且忽略后台脏标签 | 确认后读取最新状态；`frontend/src/components/TreeView.test.tsx` |
| P2 | 移动或重命名改变 React key，导致编辑器重建并丢失撤销历史 | `OpenTab.editorKey` 作为会话内稳定标识，不写入绘图文件；`frontend/src/components/ExcalidrawEditor.test.tsx` 检查路径变化不重建实例 |

### 验证与边界

- 首批 5 个异步与文件操作回归用例在修复前全部失败，修复后通过；其余用例覆盖后台脏标签、确认期间的新编辑、目录监听恢复、重命名目标冲突及根路径。
- Go `test -race`、`vet`、TypeScript、99 项前端测试、5 项发布脚本测试和 Actions 工作流静态检查通过；生产依赖审计为 0 项漏洞。
- macOS 原生验收使用独立临时配置和文件：连续重命名目录及文件后，标签保持打开、只读模式保留，文件 SHA-256 未变；编辑文字后重命名，未保存内容与黄点保留，再保存到新路径，原有元数据与视口字段保留。
- 稳定标识修复后的原生验收：新增文字后重命名，撤销按钮仍可用；撤销新增文字并保存后，文件保留原有文字、元数据和视口，没有保留被撤销的新增文字。
- 构建与 Release 配置经过复查，未修改发布触发方式、权限或签名策略；没有创建版本标签或发布 Release。
- Windows 文件和目录重命名采用同一禁止覆盖的原生调用，参数依据 [NtCreateFile 文档](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile) 核对；跨平台回归由现有三平台 CI 执行。Windows 桌面手动交互、macOS 12 实机和正式标签发布仍不属于已完成的本机验收。
- 仍保留首次审查说明的边界：原子替换不等于外部多进程冲突合并，删除不进入回收站，Go 业务测试不代表完整原生 GUI 覆盖。
