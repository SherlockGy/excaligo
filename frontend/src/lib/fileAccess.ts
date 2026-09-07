// Excalidraw uses this browser package for image, document and library exports.
// File imports retain its browser implementation; writes use a native dialog.
export { fileOpen, directoryOpen } from 'browser-fs-access-original'
import { exportBlob } from './backend'

export const supported = false

interface SaveOptions { fileName?: string; extensions?: string[] }
export async function fileSave(input: Blob | Promise<Blob> | Response, options: SaveOptions | SaveOptions[] = {}) {
  const config = Array.isArray(options) ? options[0] : options
  const blob = input instanceof Response ? await input.blob() : await input
  const name = config.fileName || `Untitled${config.extensions?.[0] || '.excalidraw'}`
  try { await exportBlob(name, blob) }
  catch (error) {
    if (String(error).includes('export cancelled')) throw new DOMException('Export cancelled', 'AbortError')
    throw error
  }
  return null
}
