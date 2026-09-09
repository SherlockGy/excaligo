import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { windowsVersionInfo, withWindowsResources } from './windows-resources.mjs'

test('uses numeric Windows versions while retaining the full release label', () => {
  const info = windowsVersionInfo('v1.2.3-beta.1')
  assert.equal(info.fixed.file_version, '1.2.3.0')
  assert.equal(info.fixed.product_version, '1.2.3.0')
  assert.equal(info.info['0000'].ProductVersion, '1.2.3-beta.1')
  assert.equal(info.info['0000'].OriginalFilename, 'excaligo.exe')
  assert.match(info.info['0000'].Comments, /Renee French/)
  assert.throws(() => windowsVersionInfo('65536.0.0'), /uint16/)
  assert.throws(() => windowsVersionInfo('../bad'), /Invalid/)
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'excaligo-resource-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, arch: 'amd64', wailsVersion: 'v3.0.0-beta.17', version: '1.2.3' }
}

for (const arch of ['amd64', 'arm64']) {
  test(`embeds the main-package icon resource for ${arch} and cleans it after linking`, t => {
    const options = { ...fixture(t), arch }
    let object, infoPath
    const run = (command, args) => {
      assert.equal(command, 'go')
      assert.deepEqual(args.slice(0, 4), ['run', `github.com/wailsapp/wails/v3/cmd/wails3@${options.wailsVersion}`, 'generate', 'syso'])
      assert.equal(args[args.indexOf('-arch') + 1], arch)
      assert.equal(args[args.indexOf('-icon') + 1], join(options.root, 'build', 'icons', 'icon.ico'))
      object = args[args.indexOf('-out') + 1]
      infoPath = args[args.indexOf('-info') + 1]
      assert.equal(object, join(options.root, 'cmd', 'excaligo', `wails_windows_${arch}.syso`))
      assert.equal(JSON.parse(readFileSync(infoPath)).fixed.file_version, '1.2.3.0')
      writeFileSync(object, 'compiled-resource')
    }
    const result = withWindowsResources({ ...options, run }, () => {
      assert.equal(readFileSync(object, 'utf8'), 'compiled-resource')
      return 'built'
    })
    assert.equal(result, 'built')
    assert.equal(existsSync(object), false)
    assert.equal(existsSync(infoPath), false)
  })
}

for (const stage of ['generate', 'build']) {
  test(`cleans temporary resources after ${stage} failure`, t => {
    const options = fixture(t)
    let object, infoPath
    const run = (_command, args) => {
      object = args[args.indexOf('-out') + 1]
      infoPath = args[args.indexOf('-info') + 1]
      if (stage === 'generate') throw new Error('generation failed')
    }
    assert.throws(() => withWindowsResources({ ...options, run }, () => { throw new Error('build failed') }), /failed/)
    assert.equal(existsSync(object), false)
    assert.equal(existsSync(infoPath), false)
  })
}

test('does not overwrite or delete a resource object it did not create', t => {
  const options = fixture(t)
  const object = join(options.root, 'cmd', 'excaligo', 'wails_windows_amd64.syso')
  mkdirSync(join(options.root, 'cmd', 'excaligo'), { recursive: true })
  writeFileSync(object, 'existing')
  assert.throws(() => withWindowsResources(options, () => {}), /already exists/)
  assert.equal(readFileSync(object, 'utf8'), 'existing')
  assert.throws(() => withWindowsResources({ ...options, arch: '../bad' }, () => {}), /Unsupported/)
})
