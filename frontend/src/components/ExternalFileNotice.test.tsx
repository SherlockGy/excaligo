import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ExternalFileNotice } from './ExternalFileNotice'
import { DocumentModeButton } from './DocumentModeButton'
import { useStore } from '../store/useStore'
import { mockInvoke, mockListen } from '../test/setup'

const initial = useStore.getState()
const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
const tab = { name: 'long-name-设计.excalidraw', path: '/work/long-name-设计.excalidraw', modified: false,
  cachedContent: content, cachedScene: JSON.parse(content), contentHash: 'old', sceneVersion: 0 }
beforeEach(() => {
  useStore.setState({ ...initial, activeFile: tab, openTabs: [tab], fileContent: content }, true)
  mockInvoke.mockResolvedValue('old')
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(cleanup)
async function event() {
  await act(async () => { await mockListen.mock.calls.find(([name]) => name === 'file-system-change')![1]({ payload: tab.path }) })
}

it('uses a single non-modal notice that updates continuously and follows the shell language', async () => {
  render(<ExternalFileNotice />)
  await event()
  let hash = 'second'
  mockInvoke.mockImplementation(async command => command === 'hash_file_content' ? hash : { content, content_hash: hash })
  await event()
  expect(screen.getByRole('complementary', { name: 'External file update' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  hash = 'third'; await event()
  expect(screen.getAllByRole('complementary')).toHaveLength(1)
  expect(screen.getByText('Reloaded 2 times')).toBeInTheDocument()
  act(() => useStore.setState({ preferences: { ...initial.preferences, language: 'zh', theme: 'dark' } }))
  expect(screen.getByText('已重载 2 次')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  await event()
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
})

it('dismisses a conflict without resolving it and reopens it from the mode button', async () => {
  const resolve = vi.fn()
  useStore.setState({ readOnly: false, isDirty: true, fileConflictPath: tab.path, resolveFileConflict: resolve,
    openTabs: [{ ...tab, modified: true, externalConflict: { contentHash: 'old' } }] })
  render(<><DocumentModeButton /><ExternalFileNotice /></>)
  await event()
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  expect(useStore.getState().openTabs[0].externalConflict).toBeDefined()
  expect(resolve).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Save conflict: Review save conflict' }))
  expect(screen.getByRole('complementary', { name: 'Save conflict' })).toBeInTheDocument()
  mockInvoke.mockResolvedValue('newer')
  await event()
  expect(screen.getByText('The external version changed again. Please review your choice.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Overwrite with local edits' }))
  expect(resolve).toHaveBeenCalledWith(tab.path, 'overwrite', 'newer')
})

it('disables resolution while applying a choice', async () => {
  useStore.setState({ readOnly: false, isDirty: true, fileConflictPath: tab.path, fileMutationPath: tab.path,
    openTabs: [{ ...tab, modified: true, externalConflict: { contentHash: 'old' } }] })
  render(<ExternalFileNotice />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Overwrite with local edits' })).toBeDisabled())
  expect(screen.getByRole('button', { name: 'Reload external version' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeDisabled()
})
