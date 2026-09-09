import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseVersion } from './release-config.mjs'
import { withWindowsResources } from './windows-resources.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const logPrefix = '[build 构建桌面应用][app=excaligo]'
const appVersion = releaseVersion().split('-')[0]
const args = new Set(process.argv.slice(2))
const version = readFileSync(join(root, 'go.mod'), 'utf8').match(/github\.com\/wailsapp\/wails\/v3\s+(\S+)/)[1]
const frontend = join(root, 'frontend')
const env = { ...process.env }
if (process.platform === 'darwin') {
  // Go 1.26 is the last Go release supporting the original macOS 12 target.
  env.MACOSX_DEPLOYMENT_TARGET = '12.0'
  env.CGO_CFLAGS = `${env.CGO_CFLAGS || ''} -mmacosx-version-min=12.0`.trim()
  env.CGO_LDFLAGS = `${env.CGO_LDFLAGS || ''} -mmacosx-version-min=12.0`.trim()
}
function run(command, argv, cwd = root) {
  console.log(logPrefix, command, ...argv)
  // Windows batch launchers require cmd.exe. Only the fixed npm commands below
  // use a shell; paths and user-provided arguments never go through it.
  const result = spawnSync(command, argv, { cwd, env, stdio: 'inherit', shell: command === 'npm.cmd' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
if (!existsSync(join(frontend, 'node_modules')) || args.has('--ci')) run(npm, ['ci', '--no-audit', '--no-fund'], frontend)
// One canonical PNG supplies both native formats on every build host.
run('go', ['run', `github.com/wailsapp/wails/v3/cmd/wails3@${version}`, 'generate', 'icons',
  '-input', 'build/icons/icon.png', '-macfilename', 'build/icons/icon.icns',
  '-windowsfilename', 'build/icons/icon.ico', '-sizes', '256,128,96,64,48,32,24,16'])
run('go', ['run', `github.com/wailsapp/wails/v3/cmd/wails3@${version}`, 'generate', 'bindings', '-ts', '-i', './cmd/excaligo'])
run(npm, ['run', 'build'], frontend)
if (process.platform === 'darwin') env.GOTOOLCHAIN = 'go1.26.8'
const binary = process.platform === 'win32' ? 'excaligo.exe' : 'excaligo'
const tags = args.has('--server') ? 'production,server' : 'production'
const ldflags = process.platform === 'win32' && !args.has('--server') ? '-s -w -H windowsgui' : '-s -w'
const buildBinary = () => run('go', ['build', '-tags', tags, '-trimpath', `-ldflags=${ldflags}`, '-o', join('bin', binary), './cmd/excaligo'])
if (process.platform === 'win32') {
  withWindowsResources({ root, arch: process.env.GOARCH || { x64: 'amd64', arm64: 'arm64', ia32: '386' }[process.arch],
    wailsVersion: version, version: releaseVersion(), run }, buildBinary)
} else {
  buildBinary()
}

if (args.has('--package') || args.has('--dmg')) {
  if (process.platform !== 'darwin') throw new Error('The .app/DMG packaging target requires macOS')
  const bundle = join(root, 'bin', 'Excaligo.app', 'Contents')
  mkdirSync(join(bundle, 'MacOS'), { recursive: true })
  mkdirSync(join(bundle, 'Resources'), { recursive: true })
  cpSync(join(root, 'bin', binary), join(bundle, 'MacOS', 'excaligo'))
  cpSync(join(root, 'build', 'darwin', 'Info.plist'), join(bundle, 'Info.plist'))
  run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${appVersion}`, join(bundle, 'Info.plist')])
  run('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${appVersion}`, join(bundle, 'Info.plist')])
  cpSync(join(root, 'build', 'icons', 'icon.icns'), join(bundle, 'Resources', 'icon.icns'))
  run('codesign', ['--force', '--sign', '-', join(root, 'bin', 'Excaligo.app')])
  if (args.has('--dmg')) {
    const dmg = join(root, 'bin', 'Excaligo.dmg')
    if (existsSync(dmg)) throw new Error(`Output already exists: ${dmg}`)
    run('hdiutil', ['create', '-volname', 'Excaligo', '-srcfolder', join(root, 'bin', 'Excaligo.app'), '-format', 'UDZO', dmg])
  }
}
