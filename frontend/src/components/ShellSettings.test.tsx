import { act, fireEvent, render, renderHook, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ShellSettings } from './ShellSettings'
import { Sidebar } from './Sidebar'
import { useTheme } from '../hooks/useTheme'
import { useStore } from '../store/useStore'
import { mockInvoke } from '../test/setup'
import installed from '../../node_modules/@excalidraw/excalidraw/package.json'

const initial = useStore.getState()
beforeEach(() => {
  useStore.setState(initial, true)
  mockInvoke.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); document.documentElement.classList.remove('dark') })

it('switches shell theme and language immediately and persists both without changing the canvas', async () => {
  useStore.setState({ fileContent: 'unsaved canvas', isDirty: true })
  renderHook(useTheme)
  render(<><Sidebar /><ShellSettings /></>)
  fireEvent.click(screen.getByTitle('Settings'))
  fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
  expect(document.documentElement).toHaveClass('dark')
  fireEvent.change(screen.getByLabelText('App language'), { target: { value: 'zh' } })
  expect(screen.getByText('选择目录')).toBeVisible()
  expect(screen.getByText('新建文件')).toBeVisible()
  expect(screen.getByLabelText('应用语言')).toHaveValue('zh')
  await waitFor(() => expect(mockInvoke).toHaveBeenLastCalledWith('save_preferences', {
    preferences: expect.objectContaining({ theme: 'dark', language: 'zh' }),
  }))
  expect(useStore.getState().fileContent).toBe('unsaved canvas')
  expect(useStore.getState().isDirty).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '亮色' }))
  expect(document.documentElement).not.toHaveClass('dark')
  await waitFor(() => expect(mockInvoke).toHaveBeenLastCalledWith('save_preferences', {
    preferences: expect.objectContaining({ theme: 'light', language: 'zh' }),
  }))
})

it('follows system theme changes only in system mode and removes the subscription', async () => {
  let change!: () => void
  const media = { matches: false, addEventListener: vi.fn((_event, listener) => { change = listener }), removeEventListener: vi.fn() }
  const mockMedia = vi.spyOn(window, 'matchMedia').mockReturnValue(media as unknown as MediaQueryList)
  const { result, unmount } = renderHook(useTheme)
  act(() => { media.matches = true; change() })
  expect(result.current).toBe('dark')
  await act(async () => { await useStore.getState().updateAppearance({ theme: 'light' }) })
  expect(result.current).toBe('light')
  act(() => { media.matches = false; change(); media.matches = true; change() })
  expect(result.current).toBe('light')
  unmount()
  expect(media.removeEventListener).toHaveBeenCalledWith('change', change)
  mockMedia.mockRestore()
})

it('rolls back a failed preference selection and reports the error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockRejectedValue(new Error('read-only config'))
  await useStore.getState().updateAppearance({ language: 'zh', theme: 'dark' })
  expect(useStore.getState().preferences).toEqual(initial.preferences)
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('保存设置失败'))
})

it('restores saved language and theme at startup', async () => {
  mockInvoke.mockResolvedValue({ language: 'zh', theme: 'dark', recent_directories: [], sidebar_visible: true, show_decorations: true })
  await useStore.getState().loadPreferences()
  render(<ShellSettings />)
  fireEvent.click(screen.getByTitle('设置'))
  expect(screen.getByLabelText('应用语言')).toHaveValue('zh')
  expect(screen.getByRole('button', { name: '暗色' })).toHaveAttribute('aria-pressed', 'true')
})

it('shows the actual installed Excalidraw version, rather than an independently maintained label', () => {
  render(<ShellSettings />)
  fireEvent.click(screen.getByTitle('Settings'))
  expect(screen.getByText('Excalidraw version')).toBeVisible()
  expect(screen.getByText(installed.version)).toBeVisible()
})
