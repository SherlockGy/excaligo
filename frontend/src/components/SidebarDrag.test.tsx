import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { useStore } from '../store/useStore'
import { canDropFile, moveTreeFile } from '../lib/fileMove'

const initial = useStore.getState()
const file = { name: 'Sketch.excalidraw', path: '/work/Sketch.excalidraw', modified: true, is_directory: false }
const folder = { name: 'Design', path: '/work/Design', modified: false, is_directory: true, children: [] }
const move = vi.fn().mockResolvedValue(true)
const atPoint = vi.fn()
function row(name: string) { return screen.getAllByText(name).find(item => item.closest('.tree-node'))!.closest('.tree-node')! }
function beginDrag() { fireEvent.pointerDown(row('Sketch'), { button: 0, buttons: 1, pointerId: 1, clientX: 20, clientY: 200 }) }
function hover(target: Element) {
  atPoint.mockReturnValue(target)
  fireEvent.pointerMove(row('Sketch'), { buttons: 1, pointerId: 1, clientX: 100, clientY: 100 })
}
function drop() { fireEvent.pointerUp(row('Sketch'), { button: 0, pointerId: 1, clientX: 100, clientY: 100 }) }
beforeEach(() => {
  useStore.setState({ ...initial, currentDirectory: '/work', fileTree: [folder, file], files: [file], moveFile: move }, true)
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: atPoint })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

it('moves an internal file onto a highlighted directory and clears the drag state', () => {
  render(<Sidebar />)
  beginDrag(); hover(row('Design'))
  expect(row('Design')).toHaveClass('file-drop-target')
  drop()
  expect(move).toHaveBeenCalledWith(file.path, folder.path)
  expect(row('Design')).not.toHaveClass('file-drop-target')
  expect(row('Sketch')).not.toHaveClass('file-dragging')
})

it('moves a nested file back to the workspace header', () => {
  const nested = { ...file, path: `${folder.path}/${file.name}` }
  useStore.setState({ fileTree: [{ ...folder, children: [nested] }], files: [nested] })
  render(<Sidebar />)
  beginDrag()
  const root = screen.getByRole('button', { name: 'work' })
  hover(root)
  expect(root).toHaveClass('file-drop-target')
  drop()
  expect(move).toHaveBeenCalledWith(nested.path, '/work')
})

it('rejects external payloads, folder dragging, same-parent drops, and file-row drops', () => {
  render(<Sidebar />)
  fireEvent.drop(row('Design'), { dataTransfer: { getData: () => file.path } })
  expect(move).not.toHaveBeenCalled()
  expect(row('Design')).not.toHaveAttribute('data-file-draggable')
  fireEvent.pointerDown(row('Design'), { button: 0, pointerId: 1 })
  hover(screen.getByRole('button', { name: 'work' })); drop()
  beginDrag(); hover(screen.getByRole('button', { name: 'work' }))
  expect(screen.getByRole('button', { name: 'work' })).not.toHaveClass('file-drop-target')
  drop()
  beginDrag(); hover(row('Sketch')); drop()
  expect(move).not.toHaveBeenCalled()
})

it('cancels a drop over the canvas and cancels Escape without moving the file', () => {
  render(<><Sidebar /><div>Canvas area</div></>)
  beginDrag(); hover(screen.getByText('Canvas area')); drop()
  expect(move).not.toHaveBeenCalled()
  expect(row('Sketch')).not.toHaveClass('file-dragging')
  beginDrag(); hover(row('Design'))
  fireEvent.keyDown(document, { key: 'Escape' })
  drop()
  expect(move).not.toHaveBeenCalled()
  expect(row('Design')).not.toHaveClass('file-drop-target')
})

it('expands a collapsed directory after hovering and preserves its children', () => {
  vi.useFakeTimers()
  useStore.setState({ fileTree: [{ ...folder, children: [{ ...file, name: 'Child.excalidraw', path: '/work/Design/Child.excalidraw' }] }, file] })
  render(<Sidebar />)
  fireEvent.click(screen.getByText('Design'))
  expect(screen.queryByText('Child')).not.toBeInTheDocument()
  beginDrag(); hover(row('Design'))
  act(() => { vi.advanceTimersByTime(600) })
  expect(screen.getByText('Child')).toBeVisible()
  fireEvent.pointerCancel(row('Sketch'))
  expect(row('Design')).not.toHaveClass('file-drop-target')
})

it('disables dragging while moving and while renaming', () => {
  render(<Sidebar />)
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${file.name}` }))
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
  expect(screen.getByRole('textbox').closest('.tree-node')).not.toHaveAttribute('data-file-draggable')
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
  act(() => { useStore.setState({ movingFilePath: file.path }) })
  expect(row('Sketch')).not.toHaveAttribute('data-file-draggable')
  expect(screen.getByRole('status')).toHaveTextContent('Moving file...')
})

it('preserves ordinary clicks and ignores movements below the drag threshold', () => {
  const load = vi.fn()
  useStore.setState({ loadFileFromTree: load })
  render(<Sidebar />)
  beginDrag()
  fireEvent.pointerMove(row('Sketch'), { buttons: 1, pointerId: 1, clientX: 22, clientY: 200 })
  fireEvent.pointerUp(row('Sketch'), { button: 0, pointerId: 1 })
  fireEvent.click(screen.getByText('Sketch'))
  expect(load).toHaveBeenCalledWith(file)
  expect(move).not.toHaveBeenCalled()
})

it('normalizes Windows paths and relocates a nested node to root without changing its status', () => {
  expect(canDropFile('C:\\work\\Sketch.excalidraw', 'C:\\work\\')).toBe(false)
  expect(canDropFile('C:\\Sketch.excalidraw', 'C:\\')).toBe(false)
  expect(canDropFile('C:\\work\\Sketch.excalidraw', 'C:\\work\\Design')).toBe(true)
  const nested = { ...file, path: '/work/Design/Sketch.excalidraw' }
  expect(moveTreeFile([{ ...folder, children: [nested] }], nested.path, file.path, '/work', '/work')).toEqual([folder, file])
})
