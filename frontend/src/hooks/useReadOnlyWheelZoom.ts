import { useEffect, type RefObject } from 'react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { AppState, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { viewportForWheel } from '../lib/wheelZoom'
import { useStore } from '../store/useStore'

function viewportSnapshot(state: AppState) {
  return {
    zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY,
    offsetLeft: state.offsetLeft, offsetTop: state.offsetTop, width: state.width, height: state.height,
  }
}

function viewportUnchanged(state: AppState, baseline: ReturnType<typeof viewportSnapshot>) {
  const current = viewportSnapshot(state)
  return (Object.keys(baseline) as (keyof typeof baseline)[]).every(key => current[key] === baseline[key])
}

// Left-button panning is already provided by public viewModeEnabled. Only
// plain wheel input is adapted here; never patch engine handlers or source.
export function useReadOnlyWheelZoom(
  container: RefObject<HTMLDivElement | null>,
  api: RefObject<ExcalidrawImperativeAPI | null>,
  path: string,
  enabled: boolean,
) {
  useEffect(() => {
    const element = container.current
    if (!enabled || !element) return
    let pending: ReturnType<typeof viewportForWheel> = null
    let baseline: ReturnType<typeof viewportSnapshot> | null = null
    let frame: number | null = null
    const canZoom = () => {
      const state = useStore.getState()
      return state.activeFile?.path === path && state.readOnly && state.preferences.readOnlyWheelZoom &&
        !state.presentationMode && !state.savingBeforeReadOnly && state.fileMutationPath === null
    }
    const wheel = (event: WheelEvent) => {
      // Restrict to the canvas, leaving menus, inputs, links and sidebars alone.
      // Modified wheel events (including trackpad pinch) stay with the engine.
      if (!canZoom() || !(event.target instanceof HTMLCanvasElement) || !api.current) return
      if (event.ctrlKey || event.metaKey) {
        pending = null
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const state = api.current.getAppState()
      if (state.cursorButton === 'down' || event.buttons !== 0) {
        pending = null
        return
      }
      // A native pan/zoom or resize invalidates an older absolute viewport.
      // Read-only panning does not reliably set cursorButton to "down".
      if (baseline && !viewportUnchanged(state, baseline)) pending = null
      if (!pending) baseline = viewportSnapshot(state)
      const next = viewportForWheel({ ...state, ...pending }, event)
      if (!next) return
      pending = next
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null
          const current = api.current?.getAppState()
          if (canZoom() && pending && current && baseline && current.cursorButton !== 'down' && viewportUnchanged(current, baseline)) {
            api.current?.updateScene({ appState: pending, captureUpdate: CaptureUpdateAction.NEVER })
          }
          pending = null
        })
      }
    }
    // Native non-passive capture prevents both page scrolling and the core's
    // React wheel handler from acting on the same event.
    element.addEventListener('wheel', wheel, { capture: true, passive: false })
    return () => {
      element.removeEventListener('wheel', wheel, true)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [container, api, path, enabled])
}
