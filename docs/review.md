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
