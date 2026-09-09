import { beforeEach, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import { mockAsk, mockInvoke } from '../test/setup'
import type { OpenTab } from '../types'

const initial = useStore.getState()
const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
const tab = (name: string): OpenTab => ({ name, path: `/work/${name}`, modified: false,
  cachedContent: content, cachedScene: JSON.parse(content), contentHash: 'old', sceneVersion: 0 })
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const a = tab('a.excalidraw'), b = tab('b.excalidraw')
beforeEach(() => {
  useStore.setState({ ...initial, currentDirectory: '/work', activeFile: a, openTabs: [a],
    fileContent: content, readOnly: false }, true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockResolvedValue([])
})

it('does not hide new edits when a previously clean tab finishes loading another file', async () => {
  const disk = deferred<unknown>()
  mockInvoke.mockReturnValueOnce(disk.promise)
  const loading = useStore.getState().loadFile(b)
  const latest = content.replace('[]', '[{"id":"new"}]')
  useStore.getState().setFileContent(latest)
  useStore.getState().setIsDirty(true)
  useStore.getState().markFileAsModified(a.path, true)
  disk.resolve({ content, content_hash: 'new' })
  await loading
  expect(useStore.getState().activeFile?.path).toBe(a.path)
  expect(useStore.getState().fileContent).toBe(latest)
  expect(useStore.getState().isDirty).toBe(true)
})

it('ignores an obsolete discard read after another file becomes active', async () => {
  useStore.setState({ isDirty: true, openTabs: [{ ...a, modified: true }] })
  mockAsk.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const disk = deferred<unknown>()
  mockInvoke.mockReturnValueOnce(disk.promise)
  const loading = useStore.getState().loadFile(b)
  await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('read_file_with_hash', { filePath: a.path }))
  const c = tab('c.excalidraw')
  useStore.setState({ activeFile: c, fileContent: 'newer canvas', isDirty: true, openTabs: [a, c] })
  disk.resolve({ content, content_hash: 'discarded' })
  await loading
  expect(useStore.getState().activeFile?.path).toBe(c.path)
  expect(useStore.getState().fileContent).toBe('newer canvas')
})

it('does not switch directories after another same-content file becomes active', async () => {
  const listing = deferred<unknown[]>()
  mockInvoke.mockReturnValue(listing.promise)
  const loading = useStore.getState().loadDirectory('/other')
  useStore.setState({ activeFile: b, openTabs: [a, b] })
  listing.resolve([])
  expect(await loading).toBe(false)
  expect(useStore.getState().activeFile?.path).toBe(b.path)
  expect(mockInvoke).not.toHaveBeenCalledWith('watch_directory', expect.anything())
})

it('waits for the pending save before renaming and preserves the resulting disk hash', async () => {
  const writing = deferred<string>()
  useStore.setState({ isDirty: true, openTabs: [{ ...a, modified: true }] })
  mockInvoke.mockImplementation(async command => {
    if (command === 'save_file') return writing.promise
    if (command === 'rename_file') return '/work/safe_name.excalidraw'
    return []
  })
  const saving = useStore.getState().saveCurrentFile()
  const renaming = useStore.getState().renameFile(a.path, 'safe/name')
  await Promise.resolve()
  expect(mockInvoke).not.toHaveBeenCalledWith('rename_file', expect.anything())
  expect(await useStore.getState().loadDirectory('/other')).toBe(false)
  writing.resolve('saved')
  await Promise.all([saving, renaming])
  expect(useStore.getState().activeFile?.name).toBe('safe_name.excalidraw')
  expect(useStore.getState().openTabs[0].contentHash).toBe('saved')
  expect(useStore.getState().isDirty).toBe(false)
})

it('invalidates an in-flight disk read before deleting its target', async () => {
  const disk = deferred<unknown>()
  mockInvoke.mockImplementation(async command => command === 'read_file_with_hash' ? disk.promise : [])
  const loading = useStore.getState().loadFile(b)
  await useStore.getState().deleteFile(b.path)
  disk.resolve({ content, content_hash: 'deleted' })
  await loading
  expect(useStore.getState().activeFile?.path).toBe(a.path)
  expect(useStore.getState().openTabs.some(item => item.path === b.path)).toBe(false)
})

it('can discard and close an externally deleted dirty tab without rereading it', async () => {
  useStore.setState({ isDirty: true, openTabs: [{ ...a, modified: true }] })
  mockAsk.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  mockInvoke.mockRejectedValue(new Error('file not found'))
  await useStore.getState().closeTab(a.path)
  expect(useStore.getState().openTabs).toEqual([])
  expect(useStore.getState().activeFile).toBeNull()
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('keeps a background dirty tab if closing is cancelled and saves it without changing the active canvas', async () => {
  useStore.setState({ openTabs: [a, { ...b, modified: true }] })
  mockAsk.mockResolvedValue(false)
  await useStore.getState().closeTab(b.path)
  expect(useStore.getState().openTabs).toHaveLength(2)
  mockAsk.mockResolvedValue(true)
  mockInvoke.mockResolvedValue('saved-background')
  await useStore.getState().closeTab(b.path)
  expect(mockInvoke).toHaveBeenCalledWith('save_file', { filePath: b.path, content, expectedHash: b.contentHash })
  expect(useStore.getState().openTabs).toEqual([a])
  expect(useStore.getState().activeFile).toBe(a)
  expect(useStore.getState().isDirty).toBe(false)
})

it('keeps all tabs if a background dirty document cancels directory switching', async () => {
  useStore.setState({ openTabs: [a, { ...b, modified: true }] })
  mockAsk.mockResolvedValue(false)
  expect(await useStore.getState().loadDirectory('/other')).toBe(false)
  expect(useStore.getState().openTabs).toHaveLength(2)
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('loads an unsaved background tab from memory without replacing it with changed disk data', async () => {
  const dirty = { ...b, modified: true, cachedContent: 'unsaved memory' }
  useStore.setState({ openTabs: [a, dirty] })
  mockInvoke.mockRejectedValue(new Error('file not found'))
  await useStore.getState().loadFile(b)
  expect(useStore.getState()).toMatchObject({ fileContent: 'unsaved memory', isDirty: true, readOnly: false })
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('does not close after new edits arrive during the discard confirmation', async () => {
  const confirmation = deferred<boolean>()
  useStore.setState({ isDirty: true, openTabs: [{ ...a, modified: true }] })
  mockAsk.mockReturnValueOnce(confirmation.promise).mockResolvedValueOnce(true)
  const closing = useStore.getState().closeTab(a.path)
  useStore.getState().setFileContent('newer edits')
  confirmation.resolve(false)
  await closing
  expect(useStore.getState().fileContent).toBe('newer edits')
  expect(useStore.getState().openTabs).toHaveLength(1)
})

it('does not restore obsolete discarded content during new-file creation', async () => {
  useStore.setState({ isDirty: true, openTabs: [{ ...a, modified: true }] })
  mockAsk.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  const disk = deferred<unknown>()
  mockInvoke.mockReturnValueOnce(disk.promise)
  const creating = useStore.getState().createNewFile('new')
  await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('read_file_with_hash', { filePath: a.path }))
  useStore.getState().setFileContent('latest drawing')
  disk.resolve({ content, content_hash: 'discarded' })
  await creating
  expect(useStore.getState().fileContent).toBe('latest drawing')
  expect(mockInvoke).not.toHaveBeenCalledWith('create_new_file', expect.anything())
})

it.each(['renameFolder', 'deleteFolder'] as const)('%s waits for writes under the folder and releases its guard', async action => {
  const writing = deferred<string>()
  useStore.setState({ isDirty: true, openTabs: [{ ...a, modified: true }] })
  mockInvoke.mockImplementation(async command => {
    if (command === 'save_file') return writing.promise
    if (command === 'rename_folder') return '/renamed'
    return []
  })
  const saving = useStore.getState().saveCurrentFile()
  const mutation = action === 'renameFolder'
    ? useStore.getState().renameFolder('/work', 'renamed')
    : useStore.getState().deleteFolder('/work')
  expect(useStore.getState().fileMutationPath).toBe('/work')
  expect(mockInvoke).toHaveBeenCalledOnce()
  writing.resolve('saved')
  await Promise.all([saving, mutation])
  expect(useStore.getState().fileMutationPath).toBeNull()
  expect(mockInvoke).toHaveBeenCalledWith(action === 'renameFolder' ? 'rename_folder' : 'delete_folder', expect.anything())
})

it('releases the mutation guard after a failed rename without losing memory', async () => {
  mockInvoke.mockRejectedValue(new Error('collision'))
  await useStore.getState().renameFile(a.path, 'taken')
  expect(useStore.getState().fileMutationPath).toBeNull()
  expect(useStore.getState().activeFile).toBe(a)
  expect(useStore.getState().openTabs).toEqual([a])
})

it.each([
  ['file', '/work/safe_name.excalidraw', 'safe/name'],
  ['folder', '/safe_name/dirty.excalidraw', 'safe/name'],
])('does not rename a %s onto a cached destination whose disk file was deleted', async (kind, destination, name) => {
  useStore.setState({ openTabs: [a, { ...b, path: destination, modified: true }] })
  if (kind === 'file') await useStore.getState().renameFile(a.path, name)
  else await useStore.getState().renameFolder('/work', name)
  expect(mockInvoke).not.toHaveBeenCalled()
  expect(useStore.getState().openTabs).toHaveLength(2)
  expect(useStore.getState().fileMutationPath).toBeNull()
})

it('restores the current watcher if edits arrive during directory watcher installation', async () => {
  const watching = deferred<unknown>()
  mockInvoke.mockImplementation(async (command, args) =>
    command === 'watch_directory' && args?.directory === '/other' ? watching.promise : [])
  const loading = useStore.getState().loadDirectory('/other')
  await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('watch_directory', { directory: '/other' }))
  useStore.getState().setFileContent('newer edits')
  watching.resolve(undefined)
  expect(await loading).toBe(false)
  expect(useStore.getState().currentDirectory).toBe('/work')
  expect(mockInvoke).toHaveBeenLastCalledWith('watch_directory', { directory: '/work' })
})
