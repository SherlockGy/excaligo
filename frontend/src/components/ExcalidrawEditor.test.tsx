import { useEffect } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { ExcalidrawEditor } from './ExcalidrawEditor'
import { mockInvoke } from '../test/setup'
import { DocumentModeButton } from './DocumentModeButton'
import { fireEvent, waitFor } from '@testing-library/react'

const editor = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn(), props: vi.fn() }))
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: Record<string, unknown>) => {
    editor.props(props)
    useEffect(() => {
      editor.mounted()
      ;(props.excalidrawAPI as (api: unknown) => void)({ scrollToContent: vi.fn(), refresh: vi.fn() })
      return editor.unmounted
    }, [])
    return <div data-testid="editor-stub">{String(props.theme)}</div>
  },
}))
const initial = useStore.getState()
beforeEach(() => {
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
  expect(screen.getByRole('button')).toBeDisabled()
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
