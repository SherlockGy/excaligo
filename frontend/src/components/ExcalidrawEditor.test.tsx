import { useEffect } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { ExcalidrawEditor } from './ExcalidrawEditor'
import { mockInvoke } from '../test/setup'
import { DocumentModeButton } from './DocumentModeButton'
import { executeMenuCommand } from '../hooks/useMenuHandler'
import { fireEvent, waitFor } from '@testing-library/react'

const editor = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn(), props: vi.fn(),
  api: { scrollToContent: vi.fn(), refresh: vi.fn(), getAppState: vi.fn(), updateScene: vi.fn() } }))
vi.mock('@excalidraw/excalidraw', () => ({
  CaptureUpdateAction: { NEVER: 'NEVER' },
  Excalidraw: (props: Record<string, unknown>) => {
    editor.props(props)
    useEffect(() => {
      editor.mounted()
      ;(props.excalidrawAPI as (api: unknown) => void)(editor.api)
      return editor.unmounted
    }, [])
    return <div data-testid="editor-stub">{String(props.theme)}<canvas data-testid="canvas-stub" /><button>Editor menu</button></div>
  },
}))
const initial = useStore.getState()
beforeEach(() => {
  editor.api.updateScene.mockReset()
  editor.api.getAppState.mockReturnValue({ scrollX: 10, scrollY: 20, zoom: { value: 1 },
    offsetLeft: 200, offsetTop: 60, height: 600, cursorButton: 'up' })
  useStore.setState(initial, true)
  const tab = { name: 'test.excalidraw', path: '/work/test.excalidraw', modified: true,
    cachedContent: 'unsaved', cachedScene: { elements: [], appState: {}, files: {} }, contentHash: '', sceneVersion: 0 }
  useStore.setState({ activeFile: tab, openTabs: [tab], fileContent: 'unsaved', isDirty: true })
})
afterEach(cleanup)

it('updates the editor theme but leaves its language and mounted scene unchanged', () => {
  render(<ExcalidrawEditor />)
  const mounted = editor.mounted.mock.calls.length
  act(() => { useStore.setState({ preferences: { ...initial.preferences, language: 'zh', theme: 'dark' } }) })
  expect(screen.getByTestId('editor-stub')).toHaveTextContent('dark')
  expect(editor.props.mock.lastCall?.[0]).not.toHaveProperty('langCode')
  expect(editor.mounted).toHaveBeenCalledTimes(mounted)
  expect(editor.unmounted).not.toHaveBeenCalled()
  expect(useStore.getState().fileContent).toBe('unsaved')
  expect(useStore.getState().isDirty).toBe(true)
  act(() => { useStore.setState({ preferences: { ...initial.preferences, theme: 'light' } }) })
  expect(screen.getByTestId('editor-stub')).toHaveTextContent('light')
  expect(editor.mounted).toHaveBeenCalledTimes(mounted)
})

function prepareDocument() {
  const content = JSON.stringify({ type: 'excalidraw', version: 2, elements: [],
    appState: { viewBackgroundColor: '#ffffff', scrollX: 10, scrollY: 20, zoom: { value: 1 } }, files: {} })
  const tab = { ...useStore.getState().openTabs[0], modified: false, cachedContent: content, cachedScene: JSON.parse(content) }
  useStore.setState({ activeFile: tab, openTabs: [tab], fileContent: content, isDirty: false })
  return content
}
function change(elements: unknown[], appState: Record<string, unknown> = {}) {
  act(() => { editor.props.mock.lastCall![0].onChange(elements, { viewBackgroundColor: '#ffffff', ...appState }, {}) })
}

it('uses public view mode and ignores all read-only callbacks without dirtying or saving the file', async () => {
  const content = prepareDocument()
  render(<ExcalidrawEditor />)
  expect(editor.props.mock.lastCall![0].viewModeEnabled).toBe(true)
  change([], { scrollX: 400, scrollY: 200, zoom: { value: 2 }, viewModeEnabled: true, theme: 'dark' })
  // Also defend against an unexpected core mutation while in view mode.
  change([{ id: 'unexpected' }], { viewBackgroundColor: '#000000' })
  await useStore.getState().saveCurrentFile()
  expect(useStore.getState()).toMatchObject({ fileContent: content, isDirty: false })
  expect(useStore.getState().openTabs[0]).toMatchObject({ modified: false, cachedContent: content })
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('switches with the shell button, saves edits, and keeps subsequent viewing transient', async () => {
  const content = prepareDocument()
  mockInvoke.mockResolvedValue('saved')
  render(<><DocumentModeButton /><ExcalidrawEditor /></>)
  const mounted = editor.mounted.mock.calls.length
  fireEvent.click(screen.getByRole('button', { name: 'Read-only: Switch to edit mode' }))
  expect(editor.props.mock.lastCall![0].viewModeEnabled).toBe(false)
  change([], { scrollX: 900, zoom: { value: 4 } })
  expect(useStore.getState().fileContent).toBe(content)
  change([{ id: 'new', type: 'rectangle' }], { scrollX: 900, zoom: { value: 4 } })
  expect(useStore.getState().isDirty).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Editing: Save and switch to read-only' }))
  expect(screen.getByRole('button', { name: 'Saving...: Save and switch to read-only' })).toBeDisabled()
  expect(editor.props.mock.lastCall![0].viewModeEnabled).toBe(true)
  await waitFor(() => expect(useStore.getState().readOnly).toBe(true))
  const saved = useStore.getState().fileContent
  expect(JSON.parse(saved!).appState).toMatchObject({ scrollX: 10, scrollY: 20, zoom: { value: 1 } })
  change([{ id: 'new', type: 'rectangle' }], { scrollX: 500, zoom: { value: 5 } })
  await useStore.getState().saveCurrentFile()
  expect(mockInvoke).toHaveBeenCalledOnce()
  expect(useStore.getState()).toMatchObject({ fileContent: saved, isDirty: false })
  expect(editor.mounted).toHaveBeenCalledTimes(mounted)
})

it('disables the shell mode button when no document is open and translates it with the shell', () => {
  useStore.setState({ activeFile: null, preferences: { ...initial.preferences, language: 'zh' } })
  render(<DocumentModeButton />)
  expect(screen.getByRole('button', { name: '只读: 切换为编辑模式' })).toBeDisabled()
})

it('keeps presentation in view mode even if the document is editable', () => {
  prepareDocument()
  useStore.setState({ readOnly: false, presentationMode: true })
  render(<ExcalidrawEditor />)
  expect(editor.props.mock.lastCall![0].viewModeEnabled).toBe(true)
  change([{ id: 'ignored-in-presentation' }])
  expect(useStore.getState().isDirty).toBe(false)
})

it('keeps the editor instance and undo history when the tab path changes', () => {
  prepareDocument()
  useStore.setState({ openTabs: [{ ...useStore.getState().openTabs[0], editorKey: 'stable-session' }] })
  render(<ExcalidrawEditor />)
  const mounted = editor.mounted.mock.calls.length
  act(() => {
    const state = useStore.getState()
    const renamed = { ...state.openTabs[0], name: 'renamed.excalidraw', path: '/work/renamed.excalidraw' }
    useStore.setState({ activeFile: renamed, openTabs: [renamed] })
  })
  expect(editor.mounted).toHaveBeenCalledTimes(mounted)
  expect(editor.unmounted).not.toHaveBeenCalled()
})

function enableWheelZoom() {
  useStore.setState({ preferences: { ...initial.preferences, readOnlyWheelZoom: true } })
}

it('remounts an external scene with the live viewport and ignores callbacks from the old scene', () => {
  prepareDocument()
  render(<ExcalidrawEditor />)
  change([], { scrollX: 321, scrollY: -123, zoom: { value: 2.5 } })
  const oldChange = editor.props.mock.lastCall![0].onChange
  const mounted = editor.mounted.mock.calls.length
  const external = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'external' }],
    appState: { scrollX: 999, scrollY: 999, zoom: { value: 8 }, viewBackgroundColor: '#ffffff' }, files: {} })
  act(() => {
    const tab = useStore.getState().openTabs[0]
    useStore.setState({ fileContent: external, openTabs: [{ ...tab, cachedContent: external,
      cachedScene: JSON.parse(external), contentHash: 'external-hash', sceneVersion: tab.sceneVersion + 1 }] })
  })
  expect(editor.mounted).toHaveBeenCalledTimes(mounted + 1)
  expect(editor.props.mock.lastCall![0].initialData.appState).toMatchObject({ scrollX: 321, scrollY: -123, zoom: { value: 2.5 } })
  expect(editor.api.scrollToContent).not.toHaveBeenCalled()
  act(() => {
    useStore.setState({ readOnly: false })
    oldChange([{ id: 'stale-scene' }], { viewBackgroundColor: '#ffffff' }, {})
  })
  expect(useStore.getState()).toMatchObject({ fileContent: external, isDirty: false })
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('finishes focused input on conflict and includes final callbacks in Save As without remounting', async () => {
  prepareDocument()
  useStore.setState({ readOnly: false })
  render(<ExcalidrawEditor />)
  const mounted = editor.mounted.mock.calls.length
  const input = document.createElement('textarea')
  screen.getByTestId('editor-stub').append(input)
  input.addEventListener('blur', () => {
    editor.props.mock.lastCall![0].onChange([{ id: 'text', type: 'text', text: 'Final input' }],
      { viewBackgroundColor: '#ffffff' }, {})
    input.remove()
  })
  input.focus()
  expect(document.activeElement).toBe(input)
  act(() => {
    const tab = useStore.getState().openTabs[0]
    useStore.setState({ isDirty: true,
      openTabs: [{ ...tab, modified: true, externalConflict: { contentHash: 'external' } }] })
  })
  expect(editor.props.mock.lastCall![0].viewModeEnabled).toBe(true)
  expect(input).not.toBeInTheDocument()
  // Also retain a delayed final callback after view mode has already rendered.
  change([{ id: 'text', type: 'text', text: 'Final input and composition' }])
  const saved = useStore.getState().fileContent!
  expect(JSON.parse(saved).elements[0].text).toBe('Final input and composition')
  expect(useStore.getState().openTabs[0].cachedContent).toBe(saved)
  expect(useStore.getState().isDirty).toBe(true)
  expect(editor.mounted).toHaveBeenCalledTimes(mounted)
  mockInvoke.mockResolvedValueOnce('/work/copy.excalidraw').mockResolvedValueOnce({ content: saved, content_hash: 'copy' })
  await act(async () => { await executeMenuCommand('save_as') })
  expect(mockInvoke).toHaveBeenCalledWith('save_file_as', { content: saved })
  expect(useStore.getState()).toMatchObject({ fileContent: saved, isDirty: false })
  expect(useStore.getState().openTabs).toHaveLength(1)
})

it('captures plain wheel input once, accumulates rapid steps and never dirties or saves the drawing', async () => {
  const content = prepareDocument()
  enableWheelZoom()
  let flush!: FrameRequestCallback
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { flush = callback; return 42 })
  const original = editor.api.getAppState()
  editor.api.updateScene.mockImplementation(({ appState }) => { change([], appState) })
  render(<ExcalidrawEditor />)
  const mounted = editor.mounted.mock.calls.length
  const canvas = screen.getByTestId('canvas-stub')
  const coreWheel = vi.fn()
  canvas.addEventListener('wheel', coreWheel)
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: 500, clientY: 300 })
  act(() => { canvas.dispatchEvent(event); canvas.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaY: -100, clientX: 500, clientY: 300,
  })) })
  expect(event.defaultPrevented).toBe(true)
  expect(coreWheel).not.toHaveBeenCalled()
  expect(window.requestAnimationFrame).toHaveBeenCalledOnce()
  act(() => { flush(0) })
  expect(editor.api.updateScene).toHaveBeenCalledOnce()
  const update = editor.api.updateScene.mock.lastCall![0]
  expect(update.captureUpdate).toBe('NEVER')
  expect(Object.keys(update.appState).sort()).toEqual(['scrollX', 'scrollY', 'zoom'])
  expect(update.appState.zoom.value).toBeCloseTo(Math.exp(0.4))
  expect(300 / update.appState.zoom.value - update.appState.scrollX).toBeCloseTo(300 - original.scrollX)
  await useStore.getState().saveCurrentFile()
  expect(useStore.getState()).toMatchObject({ fileContent: content, isDirty: false })
  expect(useStore.getState().openTabs[0]).toMatchObject({ modified: false, cachedContent: content })
  expect(mockInvoke).not.toHaveBeenCalled()
  expect(editor.mounted).toHaveBeenCalledTimes(mounted)
  vi.restoreAllMocks()
})

it.each(['disabled', 'editing', 'presentation', 'saving', 'moving', 'inactive'])(
  'leaves the engine wheel behavior unchanged when %s', (mode) => {
    prepareDocument()
    enableWheelZoom()
    if (mode === 'disabled') useStore.setState({ preferences: initial.preferences })
    if (mode === 'editing') useStore.setState({ readOnly: false })
    if (mode === 'presentation') useStore.setState({ presentationMode: true })
    if (mode === 'saving') useStore.setState({ savingBeforeReadOnly: true })
    if (mode === 'moving') useStore.setState({ fileMutationPath: '/work/test.excalidraw' })
    if (mode === 'inactive') {
      const other = { ...useStore.getState().openTabs[0], path: '/work/other.excalidraw' }
      useStore.setState({ openTabs: [...useStore.getState().openTabs, other], activeFile: other })
    }
    render(<ExcalidrawEditor />)
    const canvas = screen.getAllByTestId('canvas-stub')[0]
    const coreWheel = vi.fn()
    canvas.addEventListener('wheel', coreWheel)
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 })
    act(() => { canvas.dispatchEvent(event) })
    expect(coreWheel).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(false)
    expect(editor.api.updateScene).not.toHaveBeenCalled()
  },
)

it('preserves modified wheel, editor menu scrolling and native left-button pointer events', () => {
  prepareDocument()
  enableWheelZoom()
  render(<ExcalidrawEditor />)
  const canvas = screen.getByTestId('canvas-stub')
  const menu = screen.getByRole('button', { name: 'Editor menu' })
  for (const [target, options] of [[canvas, { ctrlKey: true }], [canvas, { metaKey: true }], [menu, {}]] as const) {
    const event = new WheelEvent('wheel', { ...options, bubbles: true, cancelable: true, deltaY: -100 })
    const nativeWheel = vi.fn()
    target.addEventListener('wheel', nativeWheel, { once: true })
    fireEvent(target, event)
    expect(nativeWheel).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(false)
  }
  const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
  const nativePointer = vi.fn()
  canvas.addEventListener('pointerdown', nativePointer)
  fireEvent(canvas, pointer)
  expect(nativePointer).toHaveBeenCalledOnce()
  expect(pointer.defaultPrevented).toBe(false)
  expect(editor.props.mock.lastCall![0].viewModeEnabled).toBe(true)
  expect(editor.api.updateScene).not.toHaveBeenCalled()
})

it.each(['editing', 'disabled', 'unmount'])('cancels pending zoom when %s before the next frame', (mode) => {
  prepareDocument()
  enableWheelZoom()
  let flush!: FrameRequestCallback
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { flush = callback; return 42 })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  const { unmount } = render(<ExcalidrawEditor />)
  fireEvent.wheel(screen.getByTestId('canvas-stub'), { deltaY: -100 })
  act(() => {
    if (mode === 'editing') useStore.setState({ readOnly: false })
    if (mode === 'disabled') useStore.setState({ preferences: initial.preferences })
    if (mode !== 'unmount') flush(0)
  })
  if (mode === 'unmount') {
    unmount()
    expect(cancel).toHaveBeenCalledWith(42)
  }
  expect(editor.api.updateScene).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

it.each(['zoom', 'pan', 'offset'])('does not overwrite newer native %s changes with a queued wheel update', (operation) => {
  prepareDocument()
  enableWheelZoom()
  let flush!: FrameRequestCallback
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { flush = callback; return 42 })
  render(<ExcalidrawEditor />)
  const canvas = screen.getByTestId('canvas-stub')
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 })
  const state = editor.api.getAppState()
  const changes = operation === 'zoom' ? { zoom: { value: 2 } }
    : operation === 'pan' ? { scrollX: 100, scrollY: 50 } : { offsetLeft: 0 }
  editor.api.getAppState.mockReturnValue({ ...state, ...changes, cursorButton: 'up' })
  act(() => { flush(0) })
  expect(editor.api.updateScene).not.toHaveBeenCalled()
  // A subsequent wheel step must start from the latest native viewport.
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 })
  act(() => { flush(0) })
  expect(editor.api.updateScene).toHaveBeenCalledOnce()
  expect(editor.api.updateScene.mock.lastCall![0].appState.zoom.value).toBeCloseTo((operation === 'zoom' ? 2 : 1) * Math.exp(0.2))
  vi.restoreAllMocks()
})

it('discards an old wheel batch before accumulating input after a native pan', () => {
  prepareDocument()
  enableWheelZoom()
  let flush!: FrameRequestCallback
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { flush = callback; return 42 })
  render(<ExcalidrawEditor />)
  const canvas = screen.getByTestId('canvas-stub')
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 })
  const latest = { ...editor.api.getAppState(), scrollX: 200, scrollY: 100 }
  editor.api.getAppState.mockReturnValue(latest)
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 })
  act(() => { flush(0) })
  const next = editor.api.updateScene.mock.lastCall![0].appState
  expect(next.zoom.value).toBeCloseTo(Math.exp(0.2))
  expect(300 / next.zoom.value - next.scrollX).toBeCloseTo(300 - latest.scrollX)
  expect(240 / next.zoom.value - next.scrollY).toBeCloseTo(240 - latest.scrollY)
  vi.restoreAllMocks()
})

it.each(['ctrl', 'cmd', 'drag'])('cancels a pending plain-wheel batch when handing control to native %s input', (input) => {
  prepareDocument()
  enableWheelZoom()
  let flush!: FrameRequestCallback
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { flush = callback; return 42 })
  render(<ExcalidrawEditor />)
  const canvas = screen.getByTestId('canvas-stub')
  fireEvent.wheel(canvas, { deltaY: -100, clientX: 500, clientY: 300 })
  fireEvent.wheel(canvas, { deltaY: -100, ctrlKey: input === 'ctrl', metaKey: input === 'cmd', buttons: input === 'drag' ? 1 : 0 })
  act(() => { flush(0) })
  expect(editor.api.updateScene).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})
