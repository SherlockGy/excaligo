import { beforeEach, expect, it } from 'vitest'
import { executeMenuCommand } from './useMenuHandler'
import { useStore } from '../store/useStore'
import { mockInvoke } from '../test/setup'

const initial = useStore.getState()
const content = '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}'
beforeEach(() => {
  useStore.setState(initial, true)
  const tab = { name: 'original.excalidraw', path: '/work/original.excalidraw', modified: true,
    cachedContent: content, contentHash: 'old', sceneVersion: 0, cachedScene: JSON.parse(content) }
  useStore.setState({ activeFile: tab, fileContent: content, openTabs: [tab], isDirty: true, readOnly: false })
})

it('save-as replaces the original tab with a clean, fully populated tab', async () => {
  mockInvoke.mockResolvedValueOnce('/work/copy.excalidraw').mockResolvedValueOnce({ content, content_hash: 'new' })
  await executeMenuCommand('save_as')
  expect(useStore.getState().openTabs).toHaveLength(1)
  expect(useStore.getState().openTabs[0]).toMatchObject({ path: '/work/copy.excalidraw', contentHash: 'new', modified: false })
  expect(useStore.getState().isDirty).toBe(false)
})

it('save-as cancellation preserves the original dirty tab', async () => {
  mockInvoke.mockResolvedValue(null)
  await executeMenuCommand('save_as')
  expect(useStore.getState().activeFile?.path).toBe('/work/original.excalidraw')
  expect(useStore.getState().isDirty).toBe(true)
})

it('blocks manual save and save-as in read-only mode', async () => {
  useStore.setState({ readOnly: true })
  await executeMenuCommand('save')
  await executeMenuCommand('save_as')
  expect(mockInvoke).not.toHaveBeenCalled()
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Switch to edit mode'))
})

it('preserves edits made while the save-as dialog is open', async () => {
  let resolve!: (path: string) => void
  mockInvoke.mockReturnValueOnce(new Promise(done => { resolve = done }))
    .mockResolvedValueOnce({ content, content_hash: 'saved' })
  const saving = executeMenuCommand('save_as')
  const edited = content.replace('"elements":[]', '"elements":[{"id":"new"}]')
  useStore.getState().setFileContent(edited)
  resolve('/work/copy.excalidraw')
  await saving
  expect(useStore.getState().activeFile?.path).toBe('/work/original.excalidraw')
  expect(useStore.getState().fileContent).toBe(edited)
  expect(useStore.getState().isDirty).toBe(true)
  expect(useStore.getState().openTabs).toHaveLength(2)
})

it('clears recent directories through the settings queue without reverting other settings', async () => {
  useStore.setState({ preferences: { ...initial.preferences, recentDirectories: ['/work'] } })
  mockInvoke.mockResolvedValue(undefined)
  await Promise.all([
    useStore.getState().setReadOnlyWheelZoom(true),
    executeMenuCommand('clear_recent'),
  ])
  expect(useStore.getState().preferences).toMatchObject({ recentDirectories: [], readOnlyWheelZoom: true })
  expect(mockInvoke).toHaveBeenLastCalledWith('save_preferences', {
    preferences: expect.objectContaining({ recent_directories: [], read_only_wheel_zoom: true }),
  })
})
