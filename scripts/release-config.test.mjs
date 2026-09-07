import assert from 'node:assert/strict'
import { test } from 'node:test'
import { releaseAssetName, releaseManifest, releaseVersion } from './release-config.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

test('resolves release tags and keeps prerelease labels', () => {
  assert.equal(releaseVersion({ GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3' }), '1.2.3')
  assert.equal(releaseVersion({ EXCALIGO_VERSION: 'v1.2.3-beta.1' }), '1.2.3-beta.1')
  assert.match(releaseVersion({ GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'feature/test' }), /^\d+\.\d+\.\d+$/)
})

test('rejects malformed and unsafe release versions', () => {
  for (const version of ['main', '../test', 'v1.2', 'v01.2.3', '1.2.3;run', '1.2.3\n']) {
    assert.throws(() => releaseVersion({ EXCALIGO_VERSION: version }))
  }
})

test('names architecture-specific macOS archives and standalone Windows executables', () => {
  assert.equal(releaseAssetName('1.2.3', 'darwin', 'arm64'), 'Excaligo-v1.2.3-macos-arm64.zip')
  assert.equal(releaseAssetName('1.2.3', 'darwin', 'x64'), 'Excaligo-v1.2.3-macos-amd64.zip')
  assert.equal(releaseAssetName('1.2.3', 'win32', 'x64'), 'Excaligo-v1.2.3-windows-amd64.exe')
  assert.throws(() => releaseAssetName('1.2.3', 'linux', 'x64'))
  assert.throws(() => releaseAssetName('1.2.3', 'win32', 'ia32'))
})

function releaseFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'excaligo-release-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const names = [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64']].map(([platform, arch]) => releaseAssetName('1.2.3', platform, arch)).sort()
  for (const name of names) {
    writeFileSync(join(directory, name), name)
    writeFileSync(join(directory, `${name}.sha256`), `${createHash('sha256').update(name).digest('hex')}  ${name}\n`)
  }
  return { directory, names }
}

test('verifies all three platform assets before preparing the checksum manifest', t => {
  const { directory, names } = releaseFixture(t)
  const manifest = releaseManifest(directory, '1.2.3')
  assert.deepEqual(manifest.names, names)
  assert.equal(manifest.checksums.trim().split('\n').length, 3)
  writeFileSync(join(directory, names[0]), 'tampered')
  assert.throws(() => releaseManifest(directory, '1.2.3'), /Checksum mismatch/)
})

test('rejects missing, extra, or mismatched-version release assets', t => {
  const { directory, names } = releaseFixture(t)
  assert.throws(() => releaseManifest(directory, '2.0.0'), /Unexpected release assets/)
  writeFileSync(join(directory, 'extra.sha256'), 'unexpected')
  assert.throws(() => releaseManifest(directory, '1.2.3'), /Unexpected release assets/)
  rmSync(join(directory, 'extra.sha256'))
  rmSync(join(directory, names[0]))
  assert.throws(() => releaseManifest(directory, '1.2.3'), /Unexpected release assets/)
})
