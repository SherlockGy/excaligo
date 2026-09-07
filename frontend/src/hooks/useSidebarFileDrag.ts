import { useEffect, useRef, useState, type PointerEvent, type DragEvent, type MouseEvent } from 'react'
import { useStore } from '../store/useStore'
import { canDropFile, findTreeNode } from '../lib/fileMove'

// Pointer capture keeps internal moves independent of WKWebView/WebView2's
// native HTML drag sessions and prevents them from becoming canvas imports.
export function useSidebarFileDrag() {
  const rootRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ path: string; x: number; y: number; pointerId: number } | null>(null)
  const draggingRef = useRef(false)
  const suppressClickUntil = useRef(0)
  const [draggedFilePath, setDraggedFilePath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)

  const clear = () => {
    const pointerId = startRef.current?.pointerId
    startRef.current = null
    draggingRef.current = false
    setDraggedFilePath(null)
    setDropTargetPath(null)
    setPosition(null)
    if (pointerId !== undefined && rootRef.current?.hasPointerCapture?.(pointerId)) rootRef.current.releasePointerCapture(pointerId)
  }

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }
    document.addEventListener('keydown', cancel)
    window.addEventListener('blur', clear)
    return () => {
      document.removeEventListener('keydown', cancel)
      window.removeEventListener('blur', clear)
    }
  }, [])

  const destinationAt = (event: PointerEvent): string | null => {
    const target = document.elementFromPoint(event.clientX, event.clientY)
    if (!target || !rootRef.current?.contains(target) || target.closest('[data-file-path]')) return null
    return target.closest<HTMLElement>('[data-drop-directory]')?.dataset.dropDirectory || null
  }

  return {
    rootRef, draggedFilePath, dropTargetPath, position,
    handlers: {
      onDragStart: (event: DragEvent) => event.preventDefault(),
      onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        const target = event.target
        const state = useStore.getState()
        const row = target instanceof Element ? target.closest<HTMLElement>('[data-file-draggable="true"]') : null
        const path = row?.dataset.filePath
        const node = path && findTreeNode(state.fileTree, path)
        if (!node || node.is_directory || state.movingFilePath || state.savingBeforeReadOnly ||
          (target instanceof Element && target.closest('button, input'))) return
        startRef.current = { path: node.path, x: event.clientX, y: event.clientY, pointerId: event.pointerId }
      },
      onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
        const start = startRef.current
        if (!start || event.pointerId !== start.pointerId) return
        if (!(event.buttons & 1)) { clear(); return }
        if (!draggingRef.current) {
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 5) return
          draggingRef.current = true
          event.currentTarget.setPointerCapture?.(event.pointerId)
          setDraggedFilePath(start.path)
        }
        event.preventDefault()
        const directory = destinationAt(event)
        setDropTargetPath(canDropFile(start.path, directory) ? directory : null)
        setPosition({ x: event.clientX + 12, y: event.clientY + 12 })
      },
      onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
        const start = startRef.current
        if (!start || event.pointerId !== start.pointerId) return
        const wasDragging = draggingRef.current
        const directory = wasDragging ? destinationAt(event) : null
        clear()
        if (!wasDragging) return
        event.preventDefault()
        suppressClickUntil.current = performance.now() + 250
        if (directory && canDropFile(start.path, directory)) void useStore.getState().moveFile(start.path, directory)
      },
      onPointerCancel: clear,
      onLostPointerCapture: clear,
      onClickCapture: (event: MouseEvent) => {
        if (performance.now() < suppressClickUntil.current) {
          event.preventDefault()
          event.stopPropagation()
        }
      },
    },
  }
}
