import { spawnSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseAssetName, releaseVersion } from './release-config.mjs'

const logPrefix = '[packageRelease 打包发布文件][app=excaligo]'
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const version = releaseVersion()
const name = releaseAssetName(version)
const outputDir = join(root, 'bin', 'release')
const output = join(outputDir, name)
mkdirSync(outputDir, { recursive: true })
if (existsSync(output)) throw new Error(`Release asset already exists: ${output}`)

if (process.platform === 'darwin') {
  const result = spawnSync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', join(root, 'bin', 'Excaligo.app'), output], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
} else {
  copyFileSync(join(root, 'bin', 'excaligo.exe'), output, constants.COPYFILE_EXCL)
}
const hash = createHash('sha256').update(readFileSync(output)).digest('hex')
writeFileSync(`${output}.sha256`, `${hash}  ${name}\n`, { flag: 'wx' })
console.log(logPrefix, output)
