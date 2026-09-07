import type { CachedExcalidrawScene } from '../types'

// Viewport movement and selections are transient. Canvas background, grid,
// elements and embedded images affect the saved drawing.
export function sceneFingerprint(scene: CachedExcalidrawScene): string {
  return JSON.stringify([
    scene.elements || [], scene.appState.gridSize ?? null,
    scene.appState.viewBackgroundColor ?? '#ffffff', scene.files || {},
  ])
}
