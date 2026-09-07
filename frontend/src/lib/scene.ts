import type { CachedExcalidrawScene } from '../types'

// Viewport movement and selections are transient. Canvas background, grid,
// elements and embedded images affect the saved drawing.
export function sceneFingerprint(scene: CachedExcalidrawScene): string {
  return JSON.stringify([
    scene.elements || [], scene.appState.gridSize ?? null,
    scene.appState.viewBackgroundColor ?? '#ffffff', scene.files || {},
  ])
}

// Preserve document metadata and its original viewport. Never copy the live
// viewport, theme, selection or viewing mode into the drawing file.
export function serializeScene(content: string, scene: CachedExcalidrawScene): string {
  const document = JSON.parse(content)
  const appState = { ...document.appState }
  for (const key of [
    'gridSize', 'viewBackgroundColor', 'currentItemFontFamily', 'currentItemFontSize',
    'currentItemStrokeColor', 'currentItemBackgroundColor', 'currentItemFillStyle',
    'currentItemStrokeWidth', 'currentItemRoughness', 'currentItemOpacity', 'currentItemTextAlign',
  ]) {
    if (scene.appState[key] !== undefined) appState[key] = scene.appState[key]
  }
  return JSON.stringify({ ...document, elements: scene.elements, appState, files: scene.files || {} }, null, 2)
}
