import { expect, it } from 'vitest'
import type { AppState } from '@excalidraw/excalidraw/types'
import { viewportForWheel } from './wheelZoom'

const state = { scrollX: 20, scrollY: -40, zoom: { value: 2 as AppState['zoom']['value'] },
  offsetLeft: 240, offsetTop: 72, height: 800 }
const wheel = { clientX: 700, clientY: 400, deltaY: -100, deltaMode: 0 }

it('zooms in and out around the cursor with sidebar and toolbar offsets', () => {
  const before = { x: (wheel.clientX - state.offsetLeft) / state.zoom.value - state.scrollX,
    y: (wheel.clientY - state.offsetTop) / state.zoom.value - state.scrollY }
  const next = viewportForWheel(state, wheel)!
  expect(next.zoom.value).toBeGreaterThan(state.zoom.value)
  expect((wheel.clientX - state.offsetLeft) / next.zoom.value - next.scrollX).toBeCloseTo(before.x)
  expect((wheel.clientY - state.offsetTop) / next.zoom.value - next.scrollY).toBeCloseTo(before.y)
  const restored = viewportForWheel({ ...state, ...next }, { ...wheel, deltaY: 100 })!
  expect(restored.zoom.value).toBeCloseTo(state.zoom.value)
  expect(restored.scrollX).toBeCloseTo(state.scrollX)
  expect(restored.scrollY).toBeCloseTo(state.scrollY)
})

it('normalizes pixel, line and page wheel units and bounds large deltas', () => {
  const pixels = viewportForWheel(state, { ...wheel, deltaY: -16 })
  expect(viewportForWheel(state, { ...wheel, deltaY: -1, deltaMode: 1 })).toEqual(pixels)
  expect(viewportForWheel(state, { ...wheel, deltaY: -0.02, deltaMode: 2 })).toEqual(pixels)
  expect(viewportForWheel(state, { ...wheel, deltaY: -10000 })).toEqual(viewportForWheel(state, wheel))
})

it.each([0.1, 30])('clamps zoom to the supported range at %s without shifting the viewport', (limit) => {
  const atLimit = { ...state, zoom: { value: limit as AppState['zoom']['value'] } }
  const deltaY = limit === 30 ? -100 : 100
  expect(viewportForWheel(atLimit, { ...wheel, deltaY })).toBeNull()
  const nearLimit = { ...state, zoom: { value: (limit === 30 ? 29 : 0.11) as AppState['zoom']['value'] } }
  expect(viewportForWheel(nearLimit, { ...wheel, deltaY })?.zoom.value).toBe(limit)
})

it.each([0, NaN, Infinity])('ignores invalid or zero vertical delta %s', (deltaY) => {
  expect(viewportForWheel(state, { ...wheel, deltaY })).toBeNull()
})
