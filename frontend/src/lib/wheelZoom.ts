import type { AppState } from '@excalidraw/excalidraw/types'

type Viewport = Pick<AppState, 'scrollX' | 'scrollY' | 'zoom'>
type ZoomState = Viewport & Pick<AppState, 'offsetLeft' | 'offsetTop' | 'height'>
type WheelInput = Pick<WheelEvent, 'clientX' | 'clientY' | 'deltaY' | 'deltaMode'>

// Shell navigation limits match Excalidraw's supported 10%–3000% range.
// No private engine imports: only the public app-state shape is used.
export function viewportForWheel(state: ZoomState, event: WheelInput): Viewport | null {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.height : 1
  const delta = event.deltaY * unit
  const previousZoom = state.zoom.value
  if (!Number.isFinite(delta) || !Number.isFinite(previousZoom) || previousZoom <= 0 || delta === 0) return null
  const value = Math.max(0.1, Math.min(30, previousZoom * Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002)))
  if (value === previousZoom) return null
  const x = event.clientX - state.offsetLeft
  const y = event.clientY - state.offsetTop
  return {
    zoom: { value: value as AppState['zoom']['value'] },
    scrollX: state.scrollX + x / value - x / previousZoom,
    scrollY: state.scrollY + y / value - y / previousZoom,
  }
}
