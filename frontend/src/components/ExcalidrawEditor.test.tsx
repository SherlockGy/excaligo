import { useEffect } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore'
import { ExcalidrawEditor } from './ExcalidrawEditor'

const editor = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn(), props: vi.fn() }))
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: Record<string, unknown>) => {
    editor.props(props)
    useEffect(() => { editor.mounted(); return editor.unmounted }, [])
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
})
