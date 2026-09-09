import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { releaseVersion } from './release-config.mjs'

export function windowsVersionInfo(version) {
  const productVersion = releaseVersion({ EXCALIGO_VERSION: version })
  const parts = productVersion.split('-')[0].split('.').map(Number)
  if (parts.some(value => value > 65535)) throw new Error('Windows version components must fit uint16')
  const numericVersion = `${parts.join('.')}.0`
  return {
    fixed: { file_version: numericVersion, product_version: numericVersion },
    info: { '0000': {
      CompanyName: 'SherlockGy', ProductName: 'Excaligo',
      FileDescription: 'Excaligo - Excalidraw with Go-powered folder management',
      OriginalFilename: 'excaligo.exe', InternalName: 'excaligo',
      FileVersion: numericVersion, ProductVersion: productVersion,
      Comments: 'App icon adapted from the Go Gopher by Renee French (CC BY 4.0).',
    } },
  }
}

// The resource object must be in the main package, not the repository root.
// Never overwrite a pre-existing object; clean up our own files on failures too.
export function withWindowsResources({ root, arch, wailsVersion, version, run }, build) {
  const logPrefix = `[withWindowsResources 嵌入 Windows 图标][app=excaligo][arch=${arch}]`
  if (!['amd64', 'arm64', '386'].includes(arch)) throw new Error(`Unsupported Windows architecture: ${arch}`)
  const info = windowsVersionInfo(version)
  const object = join(root, 'cmd', 'excaligo', `wails_windows_${arch}.syso`)
  if (existsSync(object)) throw new Error(`Resource object already exists: ${object}`)
  const temporary = mkdtempSync(join(tmpdir(), 'excaligo-windows-resources-'))
  let owned = false
  try {
    mkdirSync(join(root, 'cmd', 'excaligo'), { recursive: true })
    writeFileSync(object, '', { flag: 'wx' })
    owned = true
    const infoPath = join(temporary, 'info.json')
    writeFileSync(infoPath, JSON.stringify(info, null, 2), { flag: 'wx' })
    console.log(logPrefix)
    run('go', ['run', `github.com/wailsapp/wails/v3/cmd/wails3@${wailsVersion}`, 'generate', 'syso',
      '-arch', arch, '-icon', join(root, 'build', 'icons', 'icon.ico'),
      '-manifest', join(root, 'build', 'windows', 'excaligo.manifest'), '-info', infoPath, '-out', object])
    return build()
  } finally {
    if (owned) rmSync(object, { force: true })
    rmSync(temporary, { recursive: true, force: true })
  }
}
