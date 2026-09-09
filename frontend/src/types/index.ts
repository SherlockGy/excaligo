export interface ExcalidrawFile {
  name: string
  path: string
  modified: boolean
}

export interface CachedExcalidrawScene {
  elements: readonly any[]
  appState: Record<string, any>
  files?: Record<string, any>
}

export interface OpenTab extends ExcalidrawFile {
  // Session-only identity: renaming a path must not discard editor undo state.
  editorKey?: string
  cachedContent: string
  contentHash: string
  cachedScene: CachedExcalidrawScene
  sceneVersion: number
  // null hash means the external file is currently unavailable. Local edits
  // remain in cachedContent until the user explicitly resolves the conflict.
  externalConflict?: { contentHash: string | null }
}

export interface FileTreeNode {
  name: string
  path: string
  is_directory: boolean
  modified: boolean
  children?: FileTreeNode[]
}

export interface AppState {
  currentDirectory: string | null
  files: ExcalidrawFile[]
  activeFile: ExcalidrawFile | null
  recentDirectories: string[]
}

export interface Preferences {
  language: 'en' | 'zh'
  lastDirectory: string | null
  recentDirectories: string[]
  theme: 'light' | 'dark' | 'system'
  sidebarVisible: boolean
  showDecorations: boolean
  readOnlyWheelZoom: boolean
}
