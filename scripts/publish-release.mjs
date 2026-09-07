import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseManifest, releaseVersion } from './release-config.mjs'

const logPrefix = '[publishRelease 发布 GitHub 安装包][app=excaligo]'
const tag = process.env.GITHUB_REF_NAME
if (process.env.GITHUB_REF_TYPE !== 'tag' || !tag?.startsWith('v')) throw new Error('Publishing requires an existing v-prefixed tag')
const version = releaseVersion()
const directory = 'release-assets'
const { names, checksums } = releaseManifest(directory, version)
const checksumPath = join(directory, 'SHA256SUMS.txt')
writeFileSync(checksumPath, checksums, { flag: 'wx' })
const notesPath = join(directory, 'release-notes.md')
writeFileSync(notesPath, `## 下载与运行\n\n- macOS：按芯片选择 arm64（Apple Silicon）或 amd64（Intel）ZIP，解压得到 Excaligo.app。最低 macOS 12。没有 Apple 开发者证书签名或公证，仅有本地 ad-hoc 签名，首次打开可能需要在系统“隐私与安全性”中允许。\n- Windows x64：直接运行 .exe，无需安装 Excaligo。需要 Microsoft Edge WebView2 Runtime；未做 Authenticode 签名，系统可能提示未知发布者。\n- 用 SHA256SUMS.txt 校验下载文件。源码与构建结果对应标签 ${tag}。\n`, { flag: 'wx' })
const args = ['release', 'create', tag, '--verify-tag', '--title', `Excaligo ${tag}`, '--notes-file', notesPath, '--generate-notes',
  ...names.map(name => join(directory, name)), checksumPath]
if (version.includes('-')) args.push('--prerelease')
console.log(logPrefix, tag)
const result = spawnSync('gh', args, { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status || 1)
