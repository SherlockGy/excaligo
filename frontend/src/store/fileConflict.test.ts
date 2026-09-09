import { beforeEach, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import { FileConflictError, savedContentHash } from '../lib/fileSync'
import { mockInvoke, mockAsk } from '../test/setup'

const initial = useStore.getState()
const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'local' }], appState: {}, files: {} })
const external = content.replace('local', 'external')
const tab = { name: 'a.excalidraw', path: '/work/a.excalidraw', editorKey: 'session-a', modified: true,
  cachedContent: content, cachedScene: JSON.parse(content), contentHash: 'original', sceneVersion: 0 }
beforeEach(() => {
  useStore.setState({ ...initial, activeFile: tab, openTabs: [tab], fileContent: content, isDirty: true, readOnly: false }, true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
function conflict(hash: string | null = 'external') {
  useStore.setState({ openTabs: [{ ...tab, externalConflict: { contentHash: hash } }], fileConflictPath: tab.path })
}

it('converts the typed backend conflict result without treating its hash as a successful save', () => {
  expect(savedContentHash({ conflict: false, content_hash: 'saved' })).toBe('saved')
  expect(() => savedContentHash({ conflict: true, content_hash: 'external' })).toThrow(FileConflictError)
})

it('pauses stale saves, keeps local edits, and does not retry silently after dismissal', async () => {
  mockInvoke.mockRejectedValue(new FileConflictError('external'))
  await expect(useStore.getState().saveCurrentFile()).rejects.toThrow(FileConflictError)
  expect(mockInvoke).toHaveBeenCalledWith('save_file', { filePath: tab.path, content, expectedHash: 'original' })
  expect(useStore.getState()).toMatchObject({ isDirty: true, fileContent: content, fileConflictPath: tab.path })
  expect(useStore.getState().openTabs[0]).toMatchObject({ modified: true, contentHash: 'original', externalConflict: { contentHash: 'external' } })
  useStore.setState({ fileConflictPath: null })
  await expect(useStore.getState().saveCurrentFile()).rejects.toThrow(FileConflictError)
  expect(mockInvoke).toHaveBeenCalledOnce()
  expect(useStore.getState().fileConflictPath).toBe(tab.path)
  expect(window.alert).not.toHaveBeenCalled()
})

it('reads the latest external version only after the explicit reload decision', async () => {
  conflict()
  mockInvoke.mockResolvedValue({ content: external, content_hash: 'newest-external' })
  await useStore.getState().resolveFileConflict(tab.path, 'reload', 'external')
  expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('read_file_with_hash', { filePath: tab.path })
  expect(useStore.getState()).toMatchObject({ isDirty: false, readOnly: true, fileContent: external, fileConflictPath: null, fileMutationPath: null })
  expect(useStore.getState().openTabs[0]).toMatchObject({ editorKey: tab.editorKey, sceneVersion: 1, contentHash: 'newest-external', modified: false })
  expect(useStore.getState().openTabs[0].externalConflict).toBeUndefined()
})

it('uses the displayed external version for an explicit overwrite', async () => {
  conflict()
  mockInvoke.mockResolvedValue('saved-local')
  await useStore.getState().resolveFileConflict(tab.path, 'overwrite', 'external')
  expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('save_file', { filePath: tab.path, content, expectedHash: 'external' })
  expect(useStore.getState()).toMatchObject({ isDirty: false, fileContent: content, readOnly: false, fileConflictPath: null })
  expect(useStore.getState().openTabs[0].externalConflict).toBeUndefined()
})

it('requires another choice when the external version changes after clicking overwrite', async () => {
  conflict()
  mockInvoke.mockRejectedValue(new FileConflictError('newer'))
  await useStore.getState().resolveFileConflict(tab.path, 'overwrite', 'external')
  expect(useStore.getState()).toMatchObject({ isDirty: true, fileContent: content, fileConflictPath: tab.path, fileMutationPath: null })
  expect(useStore.getState().openTabs[0].externalConflict?.contentHash).toBe('newer')
  await useStore.getState().resolveFileConflict(tab.path, 'overwrite', 'external')
  expect(mockInvoke).toHaveBeenCalledOnce()
  expect(window.alert).not.toHaveBeenCalled()
})

it('retains final input delivered during an explicit overwrite as unsaved content', async () => {
  conflict()
  let finish!: (hash: string) => void
  mockInvoke.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
  const resolving = useStore.getState().resolveFileConflict(tab.path, 'overwrite', 'external')
  await Promise.resolve(); await Promise.resolve()
  expect(mockInvoke).toHaveBeenCalledWith('save_file', { filePath: tab.path, content, expectedHash: 'external' })
  const latest = content.replace('local', 'final-input')
  useStore.getState().setFileContent(latest)
  finish('saved-local'); await resolving
  expect(useStore.getState()).toMatchObject({ fileContent: latest, isDirty: true, fileMutationPath: null })
  expect(useStore.getState().openTabs[0]).toMatchObject({ cachedContent: latest, modified: true, contentHash: 'saved-local' })
  expect(useStore.getState().openTabs[0].externalConflict).toBeUndefined()
  mockInvoke.mockResolvedValue('saved-final')
  await useStore.getState().saveCurrentFile()
  expect(mockInvoke).toHaveBeenLastCalledWith('save_file', { filePath: tab.path, content: latest, expectedHash: 'saved-local' })
})

it('keeps the conflict unresolved if final input arrives during the external reload', async () => {
  conflict()
  let finish!: (value: { content: string; content_hash: string }) => void
  mockInvoke.mockReturnValue(new Promise(resolve => { finish = resolve }))
  const resolving = useStore.getState().resolveFileConflict(tab.path, 'reload', 'external')
  await Promise.resolve(); await Promise.resolve()
  const latest = content.replace('local', 'final-input')
  useStore.getState().setFileContent(latest)
  finish({ content: external, content_hash: 'newest' }); await resolving
  expect(useStore.getState()).toMatchObject({ fileContent: latest, isDirty: true, fileConflictPath: tab.path, fileMutationPath: null })
  expect(useStore.getState().openTabs[0]).toMatchObject({ cachedContent: latest, sceneVersion: 0, externalConflict: { contentHash: 'external' } })
})

it.each(['reload', 'overwrite'] as const)('retains the local canvas on %s failure', async choice => {
  conflict()
  mockInvoke.mockRejectedValue(new Error('permission denied'))
  await useStore.getState().resolveFileConflict(tab.path, choice, 'external')
  expect(useStore.getState()).toMatchObject({ isDirty: true, fileContent: content, fileMutationPath: null, fileConflictPath: tab.path })
  expect(useStore.getState().openTabs[0].externalConflict).toBeDefined()
})

it('blocks navigation, repeated resolution and ordinary saves while a decision is being applied', async () => {
  conflict()
  let finish!: (value: string) => void
  mockInvoke.mockReturnValue(new Promise<string>(resolve => { finish = resolve }))
  const resolving = useStore.getState().resolveFileConflict(tab.path, 'overwrite', 'external')
  await Promise.resolve(); await Promise.resolve()
  expect(await useStore.getState().loadDirectory('/other')).toBe(false)
  await useStore.getState().closeTab(tab.path)
  await useStore.getState().saveCurrentFile()
  await useStore.getState().resolveFileConflict(tab.path, 'reload', 'external')
  expect(mockInvoke).toHaveBeenCalledOnce()
  finish('saved'); await resolving
})

it('does not close a conflicting tab or enter read-only after a Save decision', async () => {
  conflict()
  mockAsk.mockResolvedValue(true)
  await useStore.getState().closeTab(tab.path)
  await useStore.getState().toggleReadOnly()
  expect(useStore.getState()).toMatchObject({ readOnly: false, isDirty: true, fileConflictPath: tab.path })
  expect(useStore.getState().openTabs).toHaveLength(1)
  expect(mockInvoke).not.toHaveBeenCalled()
})

it.each(['file', 'directory', 'new file'])(
  'aborts %s navigation on a conflict without an additional modal', async action => {
    conflict()
    mockAsk.mockResolvedValue(true)
    if (action === 'file') await useStore.getState().loadFile({ ...tab, path: '/work/b.excalidraw' })
    if (action === 'directory') expect(await useStore.getState().loadDirectory('/other')).toBe(false)
    if (action === 'new file') await useStore.getState().createNewFile('new')
    expect(useStore.getState()).toMatchObject({ activeFile: tab, isDirty: true, fileContent: content, fileConflictPath: tab.path, pendingFileLoad: null })
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  },
)

it('resolves a background conflict without replacing the active file', async () => {
  conflict()
  const active = { ...tab, path: '/work/b.excalidraw', editorKey: 'session-b', modified: false }
  useStore.setState({ activeFile: active, openTabs: [...useStore.getState().openTabs, active], isDirty: false, readOnly: true })
  mockInvoke.mockResolvedValue({ content: external, content_hash: 'newest' })
  await useStore.getState().resolveFileConflict(tab.path, 'reload', 'external')
  expect(useStore.getState().activeFile).toEqual(active)
  expect(useStore.getState().fileContent).toBe(content)
  expect(useStore.getState().openTabs[0].cachedContent).toBe(external)
})
