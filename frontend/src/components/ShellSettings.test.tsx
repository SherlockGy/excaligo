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

it('defaults wheel zoom off and persists the translated shell switch without changing the drawing', async () => {
  useStore.setState({ fileContent: 'untouched drawing', isDirty: false })
  render(<ShellSettings />)
  fireEvent.click(screen.getByTitle('Settings'))
  const toggle = screen.getByRole('switch', { name: 'Wheel zoom in read-only mode' })
  expect(toggle).not.toBeChecked()
  fireEvent.click(toggle)
  expect(toggle).toBeChecked()
  await waitFor(() => expect(mockInvoke).toHaveBeenLastCalledWith('save_preferences', {
    preferences: expect.objectContaining({ read_only_wheel_zoom: true }),
  }))
  act(() => { useStore.setState({ preferences: { ...useStore.getState().preferences, language: 'zh' } }) })
  expect(screen.getByRole('switch', { name: '只读时滚轮缩放' })).toBeChecked()
  fireEvent.click(screen.getByRole('switch', { name: '只读时滚轮缩放' }))
  await waitFor(() => expect(mockInvoke).toHaveBeenLastCalledWith('save_preferences', {
    preferences: expect.objectContaining({ read_only_wheel_zoom: false }),
  }))
  expect(useStore.getState()).toMatchObject({ fileContent: 'untouched drawing', isDirty: false })
})

it('restores wheel zoom at startup and leaves it off for older settings', async () => {
  mockInvoke.mockResolvedValue({ read_only_wheel_zoom: true })
  await useStore.getState().loadPreferences()
  expect(useStore.getState().preferences.readOnlyWheelZoom).toBe(true)
  mockInvoke.mockResolvedValue({ theme: 'light' })
  await useStore.getState().loadPreferences()
  expect(useStore.getState().preferences.readOnlyWheelZoom).toBe(false)
})

it('rolls back a failed wheel-zoom preference without rolling back other settings', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockRejectedValue(new Error('read-only config'))
  await useStore.getState().setReadOnlyWheelZoom(true)
  expect(useStore.getState().preferences).toEqual(initial.preferences)
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to save preferences'))
})

it.each([false, true])('restores the last persisted wheel setting after rapid toggles (first save succeeds: %s)', async (firstSucceeds) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  if (firstSucceeds) mockInvoke.mockResolvedValueOnce(undefined)
  mockInvoke.mockRejectedValue(new Error('read-only config'))
  const first = useStore.getState().setReadOnlyWheelZoom(true)
  const second = useStore.getState().setReadOnlyWheelZoom(false)
  useStore.setState({ preferences: { ...useStore.getState().preferences, theme: 'dark' } })
  await Promise.all([first, second])
  expect(useStore.getState().preferences).toMatchObject({ readOnlyWheelZoom: firstSucceeds, theme: 'dark' })
})

it.each(['wheel-first', 'theme-first'])('does not persist a failed setting through another queued update (%s)', async (order) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let disk: Record<string, unknown> = {}
  mockInvoke.mockRejectedValueOnce(new Error('first write failed')).mockImplementation(async (_command, { preferences }) => {
    disk = structuredClone(preferences)
  })
  const actions = order === 'wheel-first'
    ? [() => useStore.getState().setReadOnlyWheelZoom(true), () => useStore.getState().updateAppearance({ theme: 'dark' })]
    : [() => useStore.getState().updateAppearance({ theme: 'dark' }), () => useStore.getState().setReadOnlyWheelZoom(true)]
  await Promise.all(actions.map(action => action()))
  const expected = { readOnlyWheelZoom: order === 'theme-first', theme: order === 'wheel-first' ? 'dark' : 'system' }
  expect(useStore.getState().preferences).toMatchObject(expected)
  expect(disk).toMatchObject({ read_only_wheel_zoom: expected.readOnlyWheelZoom, theme: expected.theme })
})

it('keeps later selections visible while older writes settle and matches the final saved state', async () => {
  let finish!: () => void
  let disk: Record<string, unknown> = {}
  mockInvoke.mockImplementationOnce((_command, { preferences }) => new Promise<void>(resolve => {
    finish = () => { disk = structuredClone(preferences); resolve() }
  })).mockImplementation(async (_command, { preferences }) => { disk = structuredClone(preferences) })
  const first = useStore.getState().updateAppearance({ theme: 'dark' })
  const second = useStore.getState().updateAppearance({ theme: 'light' })
  const third = useStore.getState().setReadOnlyWheelZoom(true)
  const fourth = useStore.getState().updateAppearance({ language: 'zh' })
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledOnce())
  expect(useStore.getState().preferences).toMatchObject({ theme: 'light', language: 'zh', readOnlyWheelZoom: true })
  finish()
  await first
  expect(useStore.getState().preferences).toMatchObject({ theme: 'light', language: 'zh', readOnlyWheelZoom: true })
  await Promise.all([second, third, fourth])
  expect(disk).toMatchObject({ theme: 'light', language: 'zh', read_only_wheel_zoom: true })
})

it('does not persist a failed wheel choice when saving sidebar visibility', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockRejectedValueOnce(new Error('first write failed')).mockResolvedValue(undefined)
  const wheel = useStore.getState().setReadOnlyWheelZoom(true)
  useStore.getState().toggleSidebar()
  await wheel
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(2))
  expect(mockInvoke).toHaveBeenLastCalledWith('save_preferences', {
    preferences: expect.objectContaining({ read_only_wheel_zoom: false, sidebar_visible: false }),
  })
})

it.each([0, 1, 2, 3, 4, 5, 6, 7])('keeps disk and UI consistent across mixed save outcomes %s', async (outcomes) => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  let disk = { read_only_wheel_zoom: false, theme: 'system' }
  let index = 0
  mockInvoke.mockImplementation(async (_command, { preferences }) => {
    if (!(outcomes & (1 << index++))) throw new Error('simulated write failure')
    disk = structuredClone(preferences)
  })
  await Promise.all([
    useStore.getState().setReadOnlyWheelZoom(true),
    useStore.getState().updateAppearance({ theme: 'dark' }),
    useStore.getState().setReadOnlyWheelZoom(false),
  ])
  expect(useStore.getState().preferences).toMatchObject({
    readOnlyWheelZoom: disk.read_only_wheel_zoom, theme: disk.theme,
  })
  expect(disk.read_only_wheel_zoom).toBe(!(outcomes & 4) && !!(outcomes & 1))
  expect(disk.theme).toBe(outcomes & 2 ? 'dark' : 'system')
})

it('restores both sidebar state and its preference when saving fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockRejectedValue(new Error('write failed'))
  useStore.getState().toggleSidebar()
  expect(useStore.getState().sidebarVisible).toBe(false)
  await waitFor(() => expect(useStore.getState().sidebarVisible).toBe(true))
  expect(useStore.getState().preferences.sidebarVisible).toBe(true)
})

it('restores native decorations after their preference cannot be saved', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockInvoke.mockImplementation(async command => {
    if (command === 'save_preferences') throw new Error('write failed')
  })
  useStore.getState().toggleDecorations()
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledTimes(3))
  expect(mockInvoke).toHaveBeenNthCalledWith(1, 'set_decorations', { visible: false })
  expect(mockInvoke).toHaveBeenLastCalledWith('set_decorations', { visible: true })
  expect(useStore.getState().preferences.showDecorations).toBe(true)
})
