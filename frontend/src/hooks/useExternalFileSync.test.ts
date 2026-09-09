import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { useExternalFileSync } from './useExternalFileSync'
import { mockInvoke, mockListen } from '../test/setup'

const initial = useStore.getState()
const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
const tab = { name: 'a.excalidraw', path: '/work/a.excalidraw', modified: false, editorKey: 'session-a',
  cachedContent: content, cachedScene: JSON.parse(content), contentHash: 'old', sceneVersion: 0 }
let disk = { content, content_hash: 'old' }
beforeEach(() => {
  disk = { content, content_hash: 'old' }
  useStore.setState({ ...initial, activeFile: tab, openTabs: [tab], fileContent: content }, true)
  mockInvoke.mockImplementation(async command => command === 'hash_file_content' ? disk.content_hash : { ...disk })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.useRealTimers() })
async function event() {
  await act(async () => { await mockListen.mock.calls.find(([name]) => name === 'file-system-change')![1]({ payload: tab.path }) })
}
function updateDisk(hash: string) { disk = { content: content.replace('[]', `[{"id":"${hash}"}]`), content_hash: hash } }

it('reloads repeated external changes without requiring the previous notice to be dismissed or writing to disk', async () => {
  const { result } = renderHook(useExternalFileSync)
  await event()
  updateDisk('second'); await event()
  expect(useStore.getState()).toMatchObject({ readOnly: true, isDirty: false, fileContent: disk.content, activeFileLoadSource: 'disk' })
  expect(useStore.getState().openTabs[0]).toMatchObject({ sceneVersion: 1, editorKey: tab.editorKey, contentHash: 'second', modified: false })
  updateDisk('third'); await event()
  expect(result.current.notice).toMatchObject({ kind: 'reloaded', count: 2 })
  expect(useStore.getState().fileContent).toBe(disk.content)
  act(() => result.current.dismiss())
  await event()
  expect(result.current.notice).toBeNull()
  expect(mockInvoke.mock.calls.every(([command]) => command === 'hash_file_content' || command === 'read_file_with_hash')).toBe(true)
})

it.each(['success', 'failure', 'local edit'])(
  'suspends the old canvas refresh while switching tabs, then handles %s safely', async outcome => {
    const other = { name: 'b.excalidraw', path: '/work/b.excalidraw', modified: false }
    const otherDisk = { content: content.replace('[]', '[{"id":"b"}]'), content_hash: 'b' }
    let finish!: (value: typeof disk) => void
    let fail!: (error: Error) => void
    mockInvoke.mockImplementation(async (command, args) => {
      if (args?.filePath === other.path) {
        if (command === 'hash_file_content') return otherDisk.content_hash
        return new Promise<typeof disk>((resolve, reject) => { finish = resolve; fail = reject })
      }
      return command === 'hash_file_content' ? disk.content_hash : { ...disk }
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(useExternalFileSync)
    await event()
    let switching!: Promise<void>
    act(() => { switching = useStore.getState().loadFile(other) })
    await waitFor(() => expect(finish).toBeDefined())
    updateDisk('external'); await event()
    expect(useStore.getState().fileContent).toBe(content)
    const edited = content.replace('[]', '[{"id":"local"}]')
    await act(async () => {
      if (outcome === 'local edit') {
        useStore.setState({ readOnly: false, isDirty: true })
        useStore.getState().setFileContent(edited)
        useStore.getState().markFileAsModified(tab.path, true)
      }
      if (outcome === 'failure') fail(new Error('read failed'))
      else finish(otherDisk)
      await switching
    })
    expect(useStore.getState().pendingFileLoad).toBeNull()
    if (outcome === 'success') {
      expect(useStore.getState().activeFile?.path).toBe(other.path)
      expect(useStore.getState().fileContent).toBe(otherDisk.content)
    } else if (outcome === 'failure') {
      await waitFor(() => expect(useStore.getState().fileContent).toBe(disk.content))
      expect(useStore.getState().activeFile?.path).toBe(tab.path)
    } else {
      expect(useStore.getState()).toMatchObject({ fileContent: edited, isDirty: true })
      expect(useStore.getState().activeFile?.path).toBe(tab.path)
    }
  },
)

it('invalidates a read already in flight when a tab switch starts', async () => {
  updateDisk('external')
  let finish!: (value: typeof disk) => void
  const other = { ...tab, name: 'b.excalidraw', path: '/work/b.excalidraw', editorKey: 'session-b' }
  mockInvoke.mockImplementation(async (command, args) => {
    if (args?.filePath === other.path) return command === 'hash_file_content' ? 'old' : { content, content_hash: 'old' }
    return command === 'hash_file_content' ? disk.content_hash : new Promise<typeof disk>(resolve => { finish = resolve })
  })
  useStore.setState({ openTabs: [tab, other] })
  renderHook(useExternalFileSync)
  await waitFor(() => expect(finish).toBeDefined())
  await act(async () => {
    const switching = useStore.getState().loadFile(other)
    finish(disk)
    await switching
  })
  expect(useStore.getState()).toMatchObject({ fileContent: content, pendingFileLoad: null })
  expect(useStore.getState().activeFile?.path).toBe(other.path)
  expect(useStore.getState().openTabs[0].cachedContent).toBe(content)
})

it('does not resume the old canvas refresh when an older switch finishes before the latest request', async () => {
  const b = { ...tab, path: '/work/b.excalidraw' }
  const c = { ...tab, path: '/work/c.excalidraw' }
  const finish = new Map<string, (value: typeof disk) => void>()
  mockInvoke.mockImplementation(async (command, args) => {
    if (args?.filePath !== tab.path && command === 'read_file_with_hash') {
      return new Promise<typeof disk>(resolve => { finish.set(args.filePath, resolve) })
    }
    return command === 'hash_file_content' ? disk.content_hash : { ...disk }
  })
  renderHook(useExternalFileSync)
  await event()
  let first!: Promise<void>
  let second!: Promise<void>
  act(() => {
    first = useStore.getState().loadFile(b)
    second = useStore.getState().loadFile(c)
  })
  const pending = useStore.getState().pendingFileLoad
  await act(async () => { finish.get(b.path)!(disk); await first })
  expect(useStore.getState().pendingFileLoad).toBe(pending)
  updateDisk('external'); await event()
  expect(useStore.getState().fileContent).toBe(content)
  await act(async () => { finish.get(c.path)!({ content, content_hash: 'c' }); await second })
  expect(useStore.getState().activeFile?.path).toBe(c.path)
  expect(useStore.getState().pendingFileLoad).toBeNull()
})

it.each(['editing', 'dirty', 'modified', 'saving', 'moving'])(
  'does not reload or write when %s', async mode => {
    if (mode === 'editing') useStore.setState({ readOnly: false })
    if (mode === 'dirty') useStore.setState({ isDirty: true })
    if (mode === 'modified') useStore.setState({ openTabs: [{ ...tab, modified: true }] })
    if (mode === 'saving') useStore.setState({ savingBeforeReadOnly: true })
    if (mode === 'moving') useStore.setState({ fileMutationPath: tab.path })
    updateDisk('external')
    renderHook(useExternalFileSync)
    await event()
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(useStore.getState().fileContent).toBe(content)
  },
)

it('retains the scene through an invalid partial write, retries and replaces the same notice after recovery', async () => {
  const { result } = renderHook(useExternalFileSync)
  await event()
  disk = { content: '{broken', content_hash: 'partial' }
  await event()
  expect(useStore.getState().fileContent).toBe(content)
  expect(result.current.notice?.kind).toBe('unavailable')
  act(() => result.current.dismiss())
  await event()
  expect(result.current.notice).toBeNull()
  expect(console.warn).toHaveBeenCalledOnce()
  updateDisk('recovered'); await event()
  expect(useStore.getState().fileContent).toBe(disk.content)
  expect(result.current.notice?.kind).toBe('reloaded')
  expect(window.alert).not.toHaveBeenCalled()
})

it('polls files outside the watched directory and stops on unmount', async () => {
  vi.useFakeTimers()
  useStore.setState({ currentDirectory: '/elsewhere' })
  const { unmount } = renderHook(useExternalFileSync)
  await act(async () => { await Promise.resolve() })
  updateDisk('polled')
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  expect(useStore.getState().fileContent).toBe(disk.content)
  unmount()
  const calls = mockInvoke.mock.calls.length
  await vi.advanceTimersByTimeAsync(4000)
  expect(mockInvoke).toHaveBeenCalledTimes(calls)
})

it.each(['edit', 'switch', 'close', 'unmount'])(
  'ignores an in-flight read after %s', async transition => {
    let finish!: (value: typeof disk) => void
    updateDisk('stale')
    mockInvoke.mockImplementation(async command => command === 'hash_file_content' ? 'stale'
      : new Promise<typeof disk>(resolve => { finish = resolve }))
    const { unmount } = renderHook(useExternalFileSync)
    await waitFor(() => expect(finish).toBeDefined())
    await act(async () => {
      if (transition === 'edit') useStore.setState({ readOnly: false })
      if (transition === 'switch') useStore.setState({ activeFile: { ...tab, path: '/work/b.excalidraw' }, fileContent: 'other' })
      if (transition === 'close') useStore.setState({ activeFile: null, openTabs: [] })
      if (transition === 'unmount') unmount()
      finish(disk)
    })
    expect(useStore.getState().fileContent).toBe(transition === 'switch' ? 'other' : content)
  },
)

it('coalesces events arriving during a slow read and finishes with the newest disk version', async () => {
  let finish!: (value: typeof disk) => void
  updateDisk('second')
  const second = { ...disk }
  let reads = 0
  mockInvoke.mockImplementation(async command => {
    if (command === 'hash_file_content') return disk.content_hash
    if (++reads === 1) return new Promise<typeof disk>(resolve => { finish = resolve })
    return { ...disk }
  })
  renderHook(useExternalFileSync)
  await waitFor(() => expect(finish).toBeDefined())
  updateDisk('third'); await event()
  await act(async () => { finish(second) })
  await waitFor(() => expect(useStore.getState().fileContent).toBe(disk.content))
  expect(reads).toBe(2)
})

it('keeps local conflict content while tracking newer external hashes, even after dismissal', async () => {
  useStore.setState({ readOnly: false, isDirty: true, fileConflictPath: null,
    openTabs: [{ ...tab, modified: true, externalConflict: { contentHash: 'older-external' } }] })
  updateDisk('newer-external')
  renderHook(useExternalFileSync)
  await event()
  expect(useStore.getState().openTabs[0]).toMatchObject({ cachedContent: content, contentHash: 'old', externalConflict: { contentHash: 'newer-external' } })
  expect(useStore.getState()).toMatchObject({ fileContent: content, isDirty: true, fileConflictPath: null })
  expect(mockInvoke.mock.calls.every(([command]) => command === 'hash_file_content')).toBe(true)
})

it('disables overwrite while a conflicting external file is missing, then resumes version checks', async () => {
  useStore.setState({ readOnly: false, isDirty: true, openTabs: [{ ...tab, modified: true, externalConflict: { contentHash: 'external' } }] })
  mockInvoke.mockRejectedValue(new Error('not found'))
  renderHook(useExternalFileSync)
  await event()
  expect(useStore.getState().openTabs[0].externalConflict?.contentHash).toBeNull()
  mockInvoke.mockResolvedValue('recreated')
  await event()
  expect(useStore.getState().openTabs[0].externalConflict?.contentHash).toBe('recreated')
  expect(useStore.getState().fileContent).toBe(content)
})
