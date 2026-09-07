import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAppLifecycle } from './useAppLifecycle'
import { useStore } from '../store/useStore'
import { mockInvoke, mockListen, mockAsk } from '../test/setup'

const initial = useStore.getState()
beforeEach(() => {
  useStore.setState({ ...initial, loadPreferences: vi.fn().mockResolvedValue(undefined) }, true)
  mockInvoke.mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers() })

it('retains save-as tabs outside the watched workspace while removing deleted local tabs', async () => {
  const external = { name: 'copy.excalidraw', path: '/elsewhere/copy.excalidraw', modified: false,
    cachedContent: '{}', contentHash: '', sceneVersion: 0, cachedScene: { elements: [], appState: {}, files: {} } }
  useStore.setState({ currentDirectory: '/work', activeFile: external, openTabs: [external,
    { ...external, path: '/work/deleted.excalidraw' }], loadFileTree: vi.fn().mockResolvedValue(undefined) })
  const { unmount } = renderHook(useAppLifecycle)
  const callback = mockListen.mock.calls.find(([name]) => name === 'file-system-change')![1]
  await act(async () => { await callback({ payload: '/work/another.excalidraw' }) })
  expect(useStore.getState().openTabs).toEqual([external])
  expect(useStore.getState().activeFile).toEqual(external)
  unmount()
})

it('autosaves dirty content after 30 seconds and cleans up the timer', async () => {
  vi.useFakeTimers()
  const save = vi.fn().mockResolvedValue(undefined)
  useStore.setState({ isDirty: true, saveCurrentFile: save })
  const { unmount } = renderHook(useAppLifecycle)
  await act(async () => { await vi.advanceTimersByTimeAsync(29999) })
  expect(save).not.toHaveBeenCalled()
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
  expect(save).toHaveBeenCalledOnce()
  unmount()
  await vi.advanceTimersByTimeAsync(60000)
  expect(save).toHaveBeenCalledOnce()
})

it('does not force quit after a failed save and releases the close guard', async () => {
  useStore.setState({ isDirty: true, saveCurrentFile: vi.fn().mockRejectedValue(new Error('disk full')) })
  mockAsk.mockResolvedValue(true)
  const { unmount } = renderHook(useAppLifecycle)
  await waitFor(() => expect(mockListen).toHaveBeenCalledWith('check-unsaved-before-close', expect.any(Function)))
  const callback = mockListen.mock.calls.find(([name]) => name === 'check-unsaved-before-close')![1]
  await act(async () => { await callback({ payload: null }) })
  expect(mockInvoke).not.toHaveBeenCalledWith('force_close_app')
  expect(mockInvoke).toHaveBeenCalledWith('cancel_close')
  unmount()
})
