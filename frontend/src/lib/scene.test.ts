import { expect, it } from 'vitest'
import { sceneFingerprint, serializeScene } from './scene'

it('tracks background and image changes without marking viewport movement dirty', () => {
  const scene = { elements: [], appState: { viewBackgroundColor: '#fff' }, files: {} }
  const baseline = sceneFingerprint(scene)
  expect(sceneFingerprint({ ...scene, appState: { ...scene.appState, scrollX: 100, zoom: { value: 2 } } })).toBe(baseline)
  expect(sceneFingerprint({ ...scene, appState: { viewBackgroundColor: '#000' } })).not.toBe(baseline)
  expect(sceneFingerprint({ ...scene, files: { image: { dataURL: 'data:image/png;base64,AA==' } } })).not.toBe(baseline)
})

it('preserves the original viewport and metadata when saving real edits after viewing', () => {
  const original = { type: 'excalidraw', version: 2, source: 'original', custom: { retained: true },
    appState: { scrollX: 4, scrollY: 8, zoom: { value: 0.5 }, viewBackgroundColor: '#fff' } }
  const result = JSON.parse(serializeScene(JSON.stringify(original), { elements: [{ id: 'edit' }], files: {},
    appState: { scrollX: 900, scrollY: 700, zoom: { value: 3 }, viewModeEnabled: true,
      theme: 'dark', selectedElementIds: { edit: true }, viewBackgroundColor: '#000' } }))
  expect(result).toEqual({ ...original, elements: [{ id: 'edit' }], files: {},
    appState: { ...original.appState, viewBackgroundColor: '#000' } })
})
