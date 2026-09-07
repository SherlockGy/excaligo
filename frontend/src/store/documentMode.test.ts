import { beforeEach, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { useStore } from './useStore'
import { mockInvoke } from '../test/setup'

const initial = useStore.getState()
const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
const tab = { name: 'a.excalidraw', path: '/work/a.excalidraw', modified: false,
  cachedContent: content, contentHash: 'old', cachedScene: JSON.parse(content), sceneVersion: 0 }
beforeEach(() => {
  useStore.setState({ ...initial, activeFile: tab, openTabs: [tab], fileContent: content }, true)
  mockInvoke.mockResolvedValue('saved')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

it('starts read-only and blocks every ordinary save, even with explicit content', async () => {
  expect(useStore.getState().readOnly).toBe(true)
  useStore.setState({ isDirty: true }) // Defence against an unexpected callback.
  await useStore.getState().saveCurrentFile()
  await useStore.getState().saveCurrentFile(content)
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('enters edit mode explicitly and returns to read-only without rewriting a clean file', async () => {
  await useStore.getState().toggleReadOnly()
  expect(useStore.getState().readOnly).toBe(false)
  await useStore.getState().toggleReadOnly()
  expect(useStore.getState().readOnly).toBe(true)
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('saves edits before entering read-only and blocks repeated toggles and navigation while saving', async () => {
  useStore.setState({ readOnly: false, isDirty: true })
  let resolve!: (hash: string) => void
  mockInvoke.mockReturnValue(new Promise<string>(done => { resolve = done }))
  const switching = useStore.getState().toggleReadOnly()
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith('save_file', { filePath: tab.path, content }))
  expect(useStore.getState()).toMatchObject({ readOnly: false, savingBeforeReadOnly: true, isDirty: true })
  await useStore.getState().toggleReadOnly()
  await useStore.getState().loadFile({ ...tab, path: '/work/b.excalidraw' })
  await useStore.getState().closeTab(tab.path)
  expect(await useStore.getState().loadDirectory('/other')).toBe(false)
  expect(mockInvoke).toHaveBeenCalledOnce()
  resolve('saved')
  await switching
  expect(useStore.getState()).toMatchObject({ readOnly: true, savingBeforeReadOnly: false, isDirty: false })
})

it('retains editing mode and unsaved contents after save failure, and supports retry', async () => {
  useStore.setState({ readOnly: false, isDirty: true })
  mockInvoke.mockRejectedValueOnce(new Error('disk full'))
  await useStore.getState().toggleReadOnly()
  expect(useStore.getState()).toMatchObject({ readOnly: false, savingBeforeReadOnly: false, isDirty: true, fileContent: content })
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  await useStore.getState().toggleReadOnly()
  expect(useStore.getState()).toMatchObject({ readOnly: true, isDirty: false })
})

it('drains a pending autosave and writes any final changes before making the document read-only', async () => {
  useStore.setState({ readOnly: false, isDirty: true })
  let resolve!: (hash: string) => void
  mockInvoke.mockReturnValueOnce(new Promise<string>(done => { resolve = done })).mockResolvedValue('newest')
  const autosave = useStore.getState().saveCurrentFile()
  const switching = useStore.getState().toggleReadOnly()
  const newest = content.replace('"elements":[]', '"elements":[{"id":"last"}]')
  useStore.getState().setFileContent(newest)
  resolve('older')
  await Promise.all([autosave, switching])
  expect(mockInvoke).toHaveBeenLastCalledWith('save_file', { filePath: tab.path, content: newest })
  expect(useStore.getState()).toMatchObject({ readOnly: true, isDirty: false, fileContent: newest })
})

it('saves changes that arrive during the transition write instead of losing them', async () => {
  useStore.setState({ readOnly: false, isDirty: true })
  let resolve!: (hash: string) => void
  mockInvoke.mockReturnValueOnce(new Promise<string>(done => { resolve = done })).mockResolvedValue('latest')
  const switching = useStore.getState().toggleReadOnly()
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledOnce())
  const newest = content.replace('"elements":[]', '"elements":[{"id":"last"}]')
  useStore.getState().setFileContent(newest)
  resolve('first')
  await switching
  expect(mockInvoke).toHaveBeenCalledTimes(2)
  expect(mockInvoke).toHaveBeenLastCalledWith('save_file', { filePath: tab.path, content: newest })
  expect(useStore.getState()).toMatchObject({ readOnly: true, isDirty: false })
})

it('opens both disk and cached tabs in read-only, without restoring a previous edit session', async () => {
  await useStore.getState().toggleReadOnly()
  mockInvoke.mockResolvedValueOnce({ content, content_hash: 'other' }).mockResolvedValueOnce('old')
  await useStore.getState().loadFile({ ...tab, path: '/work/b.excalidraw' })
  expect(useStore.getState().readOnly).toBe(true)
  await useStore.getState().toggleReadOnly()
  await useStore.getState().loadFile(tab)
  expect(useStore.getState()).toMatchObject({ readOnly: true, activeFileLoadSource: 'cache' })
})

it('does not change the mode of another file if the active document changes during a save', async () => {
  useStore.setState({ readOnly: false, isDirty: true })
  let resolve!: (hash: string) => void
  mockInvoke.mockReturnValue(new Promise<string>(done => { resolve = done }))
  const switching = useStore.getState().toggleReadOnly()
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledOnce())
  useStore.setState({ activeFile: { ...tab, path: '/work/new.excalidraw' }, readOnly: false, isDirty: true })
  resolve('saved')
  await switching
  expect(useStore.getState()).toMatchObject({ readOnly: false, isDirty: true, savingBeforeReadOnly: false })
})
