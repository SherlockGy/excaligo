import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TreeView } from './TreeView'
import { TabBar } from './TabBar'
import { useStore } from '../store/useStore'
import { mockAsk, mockInvoke } from '../test/setup'
import type { FileTreeNode, OpenTab } from '../types'

const initial = useStore.getState()
const file: FileTreeNode = {
  name: 'Sketch.excalidraw', path: '/workspace/Sketch.excalidraw', is_directory: false, modified: true,
}
const tab: OpenTab = {
  ...file, cachedContent: '{}', contentHash: '', cachedScene: { elements: [], appState: {} }, sceneVersion: 0,
}

beforeEach(() => { useStore.setState(initial, true) })
afterEach(cleanup)

it('keeps the unsaved indicator before the filename when selection changes, without a file chevron', () => {
  const onFileClick = vi.fn()
  const { rerender } = render(<TreeView nodes={[file]} onFileClick={onFileClick} />)
  const name = screen.getByText('Sketch')
  const indicator = screen.getByRole('img', { name: 'Unsaved Changes' })
  const label = name.closest('.tree-node-label')
  const row = name.closest('.tree-node')
  expect(label).toContainElement(indicator)
  expect(name.previousElementSibling).toBe(indicator)
  expect(label).not.toContainElement(screen.getByRole('button', { name: `Actions for ${file.name}` }))
  fireEvent.click(name)
  expect(onFileClick).toHaveBeenCalledWith(file)

  rerender(<TreeView nodes={[file]} onFileClick={onFileClick} activeFilePath={file.path} />)
  expect(row).toHaveClass('active')
  expect(name.previousElementSibling).toBe(indicator)
  expect(row?.querySelector('.lucide-chevron-right')).toBeNull()
})

it('removes the indicator and its space after saving without changing the filename weight or action placement', () => {
  const { rerender } = render(<TreeView nodes={[file]} onFileClick={vi.fn()} activeFilePath={file.path} />)
  const name = screen.getByText('Sketch')
  const row = name.closest('.tree-node')
  const actions = screen.getByRole('button', { name: `Actions for ${file.name}` })
  const rowClasses = row?.className
  rerender(<TreeView nodes={[{ ...file, modified: false }]} onFileClick={vi.fn()} activeFilePath={file.path} />)
  expect(screen.queryByRole('img', { name: 'Unsaved Changes' })).not.toBeInTheDocument()
  expect(screen.getByText('Sketch')).toBe(name)
  expect(name.previousElementSibling).toBeNull()
  expect(row?.className).toBe(rowClasses)
  expect(name.closest('.tree-node-label')?.nextElementSibling).toBe(actions)
})

it('allows long filenames to truncate independently of the indicator and exposes their full name', () => {
  const name = '架构设计与详细交互流程评审记录-Architecture-and-interaction-review.excalidraw'
  render(<TreeView nodes={[{ ...file, name }]} onFileClick={vi.fn()} />)
  const filename = screen.getByTitle(name)
  expect(filename).toHaveClass('truncate', 'min-w-0')
  expect(filename).not.toHaveClass('flex-1')
  expect(filename.previousElementSibling).toBe(screen.getByRole('img', { name: 'Unsaved Changes' }))
  expect(screen.getByRole('button', { name: `Actions for ${name}` })).toHaveClass('shrink-0')
})

it('preserves folder expand and collapse chevrons', () => {
  const folder: FileTreeNode = {
    name: 'Drawings', path: '/workspace', is_directory: true, modified: false, children: [file],
  }
  render(<TreeView nodes={[folder]} onFileClick={vi.fn()} activeFilePath={file.path} />)
  const name = screen.getByText('Drawings')
  const row = name.closest('.tree-node')
  expect(row?.querySelector('.modified-dot')).toBeNull()
  expect(row?.querySelector('.lucide-chevron-down')).not.toBeNull()
  expect(screen.getByText('Sketch')).toBeVisible()
  fireEvent.click(name)
  expect(row?.querySelector('.lucide-chevron-right')).not.toBeNull()
  expect(screen.queryByText('Sketch')).not.toBeInTheDocument()
  fireEvent.click(name)
  expect(screen.getByText('Sketch')).toBeVisible()
})

it('keeps file actions and inline rename usable without triggering file selection', () => {
  const onFileClick = vi.fn()
  render(<TreeView nodes={[file]} onFileClick={onFileClick} />)
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${file.name}` }))
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
  const input = screen.getByRole('textbox')
  expect(input).toHaveFocus()
  expect(input).toHaveValue('Sketch')
  expect(input.parentElement).toContainElement(screen.getByRole('img', { name: 'Unsaved Changes' }))
  fireEvent.change(input, { target: { value: 'Cancelled name' } })
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.getByText('Sketch')).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(onFileClick).not.toHaveBeenCalled()
  expect(mockInvoke).not.toHaveBeenCalled()
})

it('places both unsaved indicators before the filename with translated tooltips and removes their space after saving', () => {
  useStore.setState({ openTabs: [tab], activeFile: tab })
  const { rerender } = render(<><TreeView nodes={[file]} onFileClick={vi.fn()} /><TabBar /></>)
  for (const indicator of screen.getAllByRole('img', { name: 'Unsaved Changes' })) {
    expect(indicator).toHaveAttribute('title', 'Unsaved Changes')
    expect(indicator).toHaveClass('modified-dot')
    expect(indicator.previousElementSibling).toBeNull()
    expect(indicator.nextElementSibling).toHaveTextContent('Sketch')
  }
  act(() => { useStore.setState({ preferences: { ...initial.preferences, language: 'zh' } }) })
  const indicators = screen.getAllByRole('img', { name: '未保存的更改' })
  expect(indicators).toHaveLength(2)
  for (const indicator of indicators) {
    expect(indicator).toHaveAttribute('title', '未保存的更改')
  }
  act(() => { useStore.setState({ openTabs: [{ ...tab, modified: false }] }) })
  rerender(<><TreeView nodes={[{ ...file, modified: false }]} onFileClick={vi.fn()} /><TabBar /></>)
  expect(screen.queryByRole('img', { name: '未保存的更改' })).not.toBeInTheDocument()
  for (const filename of screen.getAllByText('Sketch')) {
    expect(filename.previousElementSibling).toBeNull()
  }
})

it.each([false, true])('keeps the tab indicator before a long filename in presentation mode %s', (presentationMode) => {
  const name = '架构设计与详细交互流程评审记录-Architecture-and-interaction-review.excalidraw'
  const longTab = { ...tab, name }
  useStore.setState({ openTabs: [longTab], activeFile: longTab, presentationMode })
  render(<TabBar />)
  const filename = screen.getByTitle(name)
  const indicator = screen.getByRole('img', { name: 'Unsaved Changes' })
  expect(filename).toHaveClass('truncate', 'min-w-0')
  expect(filename.previousElementSibling).toBe(indicator)
  expect(indicator.previousElementSibling).toBeNull()
  if (presentationMode) {
    expect(filename.nextElementSibling).toBeNull()
  } else {
    expect(filename.nextElementSibling).toBe(screen.getByRole('button', { name: `Close ${name}` }))
  }
  act(() => { useStore.setState({ openTabs: [{ ...longTab, modified: false }] }) })
  expect(screen.queryByRole('img', { name: 'Unsaved Changes' })).not.toBeInTheDocument()
  expect(screen.getByTitle(name).previousElementSibling).toBeNull()
})

it('checks the latest background dirty state before confirming deletion', async () => {
  let resolve!: (value: boolean) => void
  mockAsk.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done })).mockResolvedValueOnce(false)
  useStore.setState({ openTabs: [{ ...tab, modified: false }] })
  render(<TreeView nodes={[file]} onFileClick={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${file.name}` }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await act(async () => {
    useStore.setState({ openTabs: [{ ...tab, modified: true }] })
    resolve(true)
  })
  await waitFor(() => expect(mockAsk).toHaveBeenCalledTimes(2))
  expect(mockAsk).toHaveBeenLastCalledWith(expect.stringContaining('unsaved changes'), expect.anything())
  expect(mockInvoke).not.toHaveBeenCalled()
})
