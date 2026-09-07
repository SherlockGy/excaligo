import { beforeEach, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import { mockInvoke } from '../test/setup'
import type { FileTreeNode, OpenTab } from '../types'

const initial = useStore.getState()
const content = JSON.stringify({ type: 'excalidraw', elements: [{ id: 'unsaved' }], appState: { scrollX: 12 }, files: {} })
const file = { name: '草图.excalidraw', path: '/work/草图.excalidraw', modified: true }
const folder: FileTreeNode = { name: '设计', path: '/work/设计', modified: false, is_directory: true, children: [] }
const newPath = `${folder.path}/${file.name}`
const tab: OpenTab = { ...file, cachedContent: content, cachedScene: JSON.parse(content), contentHash: 'disk-hash', sceneVersion: 4 }
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  useStore.setState({ ...initial, currentDirectory: '/work', files: [file], fileTree: [folder, { ...file, is_directory: false }],
    activeFile: file, openTabs: [tab], fileContent: content, isDirty: true, readOnly: false }, true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockImplementation(async command => {
    if (command === 'move_file') return newPath
    if (command === 'get_file_tree') return [{ ...folder, children: [{ ...file, path: newPath, is_directory: false }] }]
    if (command === 'list_excalidraw_files') return [{ ...file, path: newPath }]
    if (command === 'save_file') return 'saved-hash'
    throw new Error(`Unexpected command ${command}`)
  })
})

it('moves an unsaved tab without rewriting the drawing and saves later at the new path', async () => {
  expect(await useStore.getState().moveFile(file.path, folder.path)).toBe(true)
  const state = useStore.getState()
  expect(state.activeFile).toEqual({ ...file, path: newPath })
  expect(state.openTabs[0]).toEqual({ ...tab, path: newPath })
  expect(state.openTabs[0].cachedScene).toBe(tab.cachedScene)
  expect(state.isDirty).toBe(true)
  expect(state.readOnly).toBe(false)
  expect(state.fileContent).toBe(content)
  expect(mockInvoke).not.toHaveBeenCalledWith('save_file', expect.anything())
  await state.saveCurrentFile()
  expect(mockInvoke).toHaveBeenCalledWith('save_file', { filePath: newPath, content })
  expect(useStore.getState().isDirty).toBe(false)
})

it('retains read-only mode and disk hash when moving a clean file', async () => {
  useStore.setState({ readOnly: true, isDirty: false, activeFile: { ...file, modified: false }, openTabs: [{ ...tab, modified: false }] })
  expect(await useStore.getState().moveFile(file.path, folder.path)).toBe(true)
  expect(useStore.getState().readOnly).toBe(true)
  expect(useStore.getState().isDirty).toBe(false)
  expect(useStore.getState().openTabs[0].contentHash).toBe('disk-hash')
  expect(mockInvoke.mock.calls.map(([command]) => command)).not.toContain('save_file')
})

it('waits for an existing save, blocks conflicting operations, and updates the final saved tab', async () => {
  const writing = deferred<string>()
  mockInvoke.mockImplementationOnce(() => writing.promise)
  const saving = useStore.getState().saveCurrentFile()
  const moving = useStore.getState().moveFile(file.path, folder.path)
  expect(useStore.getState().movingFilePath).toBe(file.path)
  await useStore.getState().saveCurrentFile()
  await useStore.getState().closeTab(file.path)
  await useStore.getState().renameFile(file.path, 'other')
  await useStore.getState().deleteFile(file.path)
  expect(await useStore.getState().loadDirectory('/other')).toBe(false)
  expect(await useStore.getState().moveFile(file.path, folder.path)).toBe(false)
  expect(mockInvoke).toHaveBeenCalledTimes(1)
  writing.resolve('new-disk-hash')
  await saving
  expect(await moving).toBe(true)
  expect(useStore.getState().isDirty).toBe(false)
  expect(useStore.getState().openTabs[0].contentHash).toBe('new-disk-hash')
  expect(useStore.getState().movingFilePath).toBeNull()
})

it('keeps edits received while the move is pending', async () => {
  const operation = deferred<string>()
  mockInvoke.mockImplementationOnce(() => operation.promise)
  const moving = useStore.getState().moveFile(file.path, folder.path)
  await Promise.resolve()
  const latest = content.replace('unsaved', 'newer')
  useStore.getState().setFileContent(latest)
  useStore.getState().updateTabScene(file.path, JSON.parse(latest))
  operation.resolve(newPath)
  await moving
  expect(useStore.getState().fileContent).toBe(latest)
  expect(useStore.getState().openTabs[0].cachedContent).toBe(latest)
  expect(useStore.getState().openTabs[0].cachedScene.elements[0].id).toBe('newer')
})

it('retains original paths and unsaved content when the backend refuses a collision', async () => {
  mockInvoke.mockRejectedValueOnce(new Error('a file or folder with that name already exists'))
  expect(await useStore.getState().moveFile(file.path, folder.path)).toBe(false)
  expect(useStore.getState().activeFile).toEqual(file)
  expect(useStore.getState().openTabs).toEqual([tab])
  expect(useStore.getState().fileContent).toBe(content)
  expect(useStore.getState().isDirty).toBe(true)
  expect(useStore.getState().movingFilePath).toBeNull()
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('already exists'))
})

it('ignores a stale directory refresh that started before the move', async () => {
  const stale = deferred<FileTreeNode[]>()
  mockInvoke.mockImplementationOnce(() => stale.promise)
  const refreshing = useStore.getState().loadFileTree('/work')
  await useStore.getState().moveFile(file.path, folder.path)
  stale.resolve([folder, { ...file, is_directory: false }])
  await refreshing
  expect(useStore.getState().files[0].path).toBe(newPath)
  expect(useStore.getState().fileTree[0].children?.[0].path).toBe(newPath)
})

it('rejects folders, unknown or same-directory targets, and an existing destination tab', async () => {
  for (const [source, target] of [[file.path, '/work'], [file.path, '/outside'], [folder.path, '/work'], ['/work/missing', folder.path]]) {
    expect(await useStore.getState().moveFile(source, target)).toBe(false)
  }
  useStore.setState({ openTabs: [tab, { ...tab, path: newPath }] })
  expect(await useStore.getState().moveFile(file.path, folder.path)).toBe(false)
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('moves a background file without changing the active canvas', async () => {
  const active = { ...tab, path: '/work/active.excalidraw' }
  useStore.setState({ activeFile: active, openTabs: [active, tab] })
  await useStore.getState().moveFile(file.path, folder.path)
  expect(useStore.getState().activeFile).toBe(active)
  expect(useStore.getState().openTabs[0]).toBe(active)
  expect(useStore.getState().openTabs[1].path).toBe(newPath)
})
