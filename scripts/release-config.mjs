import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

export function releaseVersion(env = process.env) {
  const fallback = JSON.parse(readFileSync(new URL('../frontend/package.json', import.meta.url), 'utf8')).version
  const value = env.EXCALIGO_VERSION || (env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : fallback)
  if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value || '')) {
    throw new Error(`Invalid release version: ${value}`)
  }
  return value.replace(/^v/, '')
}

export function releaseAssetName(version, platform = process.platform, arch = process.arch) {
  const architecture = { x64: 'amd64', arm64: 'arm64' }[arch]
  if (!architecture || !['darwin', 'win32'].includes(platform)) throw new Error(`Unsupported release target: ${platform}/${arch}`)
  const os = platform === 'darwin' ? 'macos' : 'windows'
  return `Excaligo-v${version}-${os}-${architecture}.${platform === 'darwin' ? 'zip' : 'exe'}`
}

export function releaseManifest(directory, version) {
  const names = [releaseAssetName(version, 'darwin', 'arm64'), releaseAssetName(version, 'darwin', 'x64'), releaseAssetName(version, 'win32', 'x64')].sort()
  const actual = readdirSync(directory).sort()
  const expected = names.flatMap(name => [name, `${name}.sha256`]).sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected release assets: ${actual.join(', ')}`)
  const checksums = names.map(name => {
    const checksum = `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}\n`
    if (readFileSync(join(directory, `${name}.sha256`), 'utf8') !== checksum) throw new Error(`Checksum mismatch: ${name}`)
    return checksum
  }).join('')
  return { names, checksums }
}
