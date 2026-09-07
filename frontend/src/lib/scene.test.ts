import { expect, it } from 'vitest'
import { sceneFingerprint } from './scene'

it('tracks background and image changes without marking viewport movement dirty', () => {
  const scene = { elements: [], appState: { viewBackgroundColor: '#fff' }, files: {} }
  const baseline = sceneFingerprint(scene)
  expect(sceneFingerprint({ ...scene, appState: { ...scene.appState, scrollX: 100, zoom: { value: 2 } } })).toBe(baseline)
  expect(sceneFingerprint({ ...scene, appState: { viewBackgroundColor: '#000' } })).not.toBe(baseline)
  expect(sceneFingerprint({ ...scene, files: { image: { dataURL: 'data:image/png;base64,AA==' } } })).not.toBe(baseline)
})
