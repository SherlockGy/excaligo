import { create } from 'zustand'
import { invoke } from '../lib/backend'
import { CachedExcalidrawScene, ExcalidrawFile, FileTreeNode, OpenTab, Preferences } from '../types'
import { convertPreferencesFromBackend, convertPreferencesToBackend } from '../lib/preferences'
import { ask } from '../lib/backend'
import { translate, type MessageKey, type Parameters } from '../lib/i18n'

type UnsavedChangesDecision = 'save' | 'discard' | 'cancel'
type FileLoadSource = 'cache' | 'disk' | null
const savingFiles = new Map<string, Promise<string>>()
let fileLoadGeneration = 0
let directoryLoadGeneration = 0
let directoryWatch: Promise<unknown> = Promise.resolve()
let preferenceWrites: Promise<unknown> = Promise.resolve()
let appearanceGeneration = 0

function t(key: MessageKey, parameters?: Parameters): string {
  return translate(useStore.getState().preferences.language, key, parameters)
}

interface FileContentResult {
  content: string
  content_hash: string
}

function parseSceneFromContent(content: string): CachedExcalidrawScene {
  const data = JSON.parse(content)

  return {
    elements: data.elements || [],
    appState: data.appState || {},
    files: data.files || {},
  }
}

function toOpenTab(
  file: ExcalidrawFile,
  content: string,
  contentHash: string,
  sceneVersion = 0
): OpenTab {
  return {
    ...file,
    cachedContent: content,
    contentHash,
    cachedScene: parseSceneFromContent(content),
    sceneVersion,
  }
}

function toExcalidrawFile(tab: OpenTab): ExcalidrawFile {
  return {
    name: tab.name,
    path: tab.path,
    modified: tab.modified,
  }
}

async function readOpenTabFromDisk(file: ExcalidrawFile, sceneVersion = 0): Promise<OpenTab> {
  const { content, content_hash: contentHash } = await invoke<FileContentResult>(
    'read_file_with_hash',
    { filePath: file.path }
  )

  return toOpenTab({ ...file, modified: false }, content, contentHash, sceneVersion)
}

async function confirmUnsavedChanges(
  fileName: string,
  actionDescription: string
): Promise<UnsavedChangesDecision> {
  const shouldSave = await ask(
    t('Do you want to save changes to "{name}" before {action}?', { name: fileName, action: actionDescription }),
    {
      title: t('Unsaved Changes'),
      kind: 'warning',
      okLabel: t('Save'),
      cancelLabel: t("Don't Save"),
    }
  )

  if (shouldSave) {
    return 'save'
  }

  const shouldDiscard = await ask(
    t('Discard unsaved changes to "{name}"?', { name: fileName }),
    {
      title: t('Discard Unsaved Changes'),
      kind: 'warning',
      okLabel: t("Don't Save"),
      cancelLabel: t('Cancel'),
    }
  )

  return shouldDiscard ? 'discard' : 'cancel'
}

function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`) || path.startsWith(`${directory}\\`)
}

function replacePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) {
    return newPrefix
  }

  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`
  }

  return path
}

interface AppStore {
  // State
  currentDirectory: string | null
  files: ExcalidrawFile[]
  fileTree: FileTreeNode[]
  activeFile: ExcalidrawFile | null
  fileContent: string | null
  activeFileLoadSource: FileLoadSource
  preferences: Preferences
  sidebarVisible: boolean
  isDirty: boolean
  presentationMode: boolean
  openTabs: OpenTab[]

  // Actions
  setCurrentDirectory: (dir: string | null) => void
  setFiles: (files: ExcalidrawFile[]) => void
  setFileTree: (tree: FileTreeNode[]) => void
  setActiveFile: (file: ExcalidrawFile | null) => void
  setFileContent: (content: string | null) => void
  updateTabScene: (filePath: string, scene: CachedExcalidrawScene) => void
  setPreferences: (prefs: Preferences) => void
  setSidebarVisible: (visible: boolean) => void
  setIsDirty: (dirty: boolean) => void
  markFileAsModified: (filePath: string, modified: boolean) => void
  markTreeNodeAsModified: (filePath: string, modified: boolean) => void
  togglePresentationMode: () => void
  closeTab: (filePath: string) => Promise<void>
  toggleDecorations: () => void

  // Async actions
  loadDirectory: (dir: string) => Promise<boolean>
  loadFileTree: (dir: string) => Promise<void>
  loadFile: (file: ExcalidrawFile) => Promise<void>
  loadFileFromTree: (node: FileTreeNode) => Promise<void>
  saveCurrentFile: (content?: string) => Promise<void>
  createNewFile: (fileName?: string, directory?: string) => Promise<void>
  createNewFolder: (folderName?: string, directory?: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  renameFolder: (oldPath: string, newName: string) => Promise<void>
  deleteFile: (filePath: string) => Promise<boolean>
  deleteFolder: (folderPath: string) => Promise<boolean>
  loadPreferences: () => Promise<void>
  savePreferences: () => Promise<boolean>
  updateAppearance: (updates: Partial<Pick<Preferences, 'theme' | 'language'>>) => Promise<void>
  toggleSidebar: () => void
}

export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  currentDirectory: null,
  files: [],
  fileTree: [],
  activeFile: null,
  fileContent: null,
  activeFileLoadSource: null,
  preferences: {
    lastDirectory: null,
    recentDirectories: [],
    theme: 'system',
    language: 'en',
    sidebarVisible: true,
    showDecorations: true,
  },
  sidebarVisible: true,
  isDirty: false,
  presentationMode: false,
  openTabs: [],

  // Basic setters
  setCurrentDirectory: (dir) => set({ currentDirectory: dir }),
  setFiles: (files) => set({ files }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setActiveFile: (file) => set({ activeFile: file }),
  setFileContent: (content) => set((state) => ({
    fileContent: content,
    openTabs:
      content && state.activeFile
        ? state.openTabs.map((tab) =>
            tab.path === state.activeFile?.path
              ? { ...tab, cachedContent: content }
              : tab
          )
        : state.openTabs,
  })),
  updateTabScene: (filePath, scene) => set((state) => ({
    openTabs: state.openTabs.map((tab) =>
      tab.path === filePath ? { ...tab, cachedScene: scene } : tab
    ),
  })),
  setPreferences: (prefs) => set({ preferences: prefs }),
  setSidebarVisible: (visible) => set({ sidebarVisible: visible }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),

  markFileAsModified: (filePath, modified) => {
    set((state) => ({
      files: state.files.map((f) =>
        f.path === filePath ? { ...f, modified } : f
      ),
      openTabs: state.openTabs.map((f) =>
        f.path === filePath ? { ...f, modified } : f
      ),
    }))
  },

  markTreeNodeAsModified: (filePath, modified) => {
    const updateNode = (nodes: FileTreeNode[]): FileTreeNode[] => {
      return nodes.map(node => {
        if (node.path === filePath) {
          return { ...node, modified }
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) }
        }
        return node
      })
    }

    set((state) => ({
      fileTree: updateNode(state.fileTree)
    }))
  },

  // Load directory and list files
  loadDirectory: async (dir) => {
    const logPrefix = `[loadDirectory 加载工作目录][directory=${dir}]`
    const generation = ++directoryLoadGeneration
    fileLoadGeneration++
    try {
      const state = get()
      if (state.isDirty && state.activeFile) {
        const decision = await confirmUnsavedChanges(state.activeFile.name, t('switching directories'))
        if (decision === 'cancel') return false
        if (decision === 'save') {
          await state.saveCurrentFile()
          if (get().isDirty) return false
        }
      }
      const [files, fileTree] = await Promise.all([
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir })
      ])
      if (generation !== directoryLoadGeneration || get().fileContent !== state.fileContent) return false
      // Serialize watcher replacement as Wails service calls may run concurrently.
      directoryWatch = directoryWatch.catch(() => {}).then(() => {
        if (generation === directoryLoadGeneration) return invoke('watch_directory', { directory: dir })
      })
      await directoryWatch
      if (generation !== directoryLoadGeneration || get().fileContent !== state.fileContent) return false

      if (state.presentationMode && state.preferences.showDecorations) {
        await invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu before loading directory:', error)
        })
      }

      set({
        currentDirectory: dir,
        files,
        fileTree,
        activeFile: null,
        fileContent: null,
        activeFileLoadSource: null,
        isDirty: false,
        presentationMode: false,
        openTabs: [],
      })
      fileLoadGeneration++

      // Update preferences with recent directory
      const prefs = get().preferences
      // Ensure recentDirectories is always an array
      const currentRecentDirs = prefs.recentDirectories || []
      const recentDirs = currentRecentDirs.filter((d) => d !== dir)
      recentDirs.unshift(dir)
      if (recentDirs.length > 10) {
        recentDirs.pop()
      }

      const newPrefs: Preferences = {
        ...prefs,
        lastDirectory: dir,
        recentDirectories: recentDirs,
      }

      set({ preferences: newPrefs })
      await get().savePreferences()

      return true
    } catch (error) {
      console.error(logPrefix, error)
      // Show user-friendly error message
      alert(t("Failed to load directory: {error}", { error: String(error) }))
      return false
    }
  },

  // Load file tree only
  loadFileTree: async (dir) => {
    try {
      const [fileTree, files] = await Promise.all([
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir }),
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
      ])
      if (get().currentDirectory !== dir) return
      const modified = new Set(get().openTabs.filter(tab => tab.modified).map(tab => tab.path))
      const mark = (nodes: FileTreeNode[]): FileTreeNode[] => nodes.map(node => ({
        ...node, modified: modified.has(node.path),
        children: node.children ? mark(node.children) : undefined,
      }))
      set({ fileTree: mark(fileTree), files: files.map(file => ({ ...file, modified: modified.has(file.path) })) })
    } catch (error) {
      console.error('Failed to load file tree:', error)
    }
  },

  // Load file content
  loadFile: async (file) => {
    const state = get()

    // If clicking the same file that's already active, do nothing
    if (state.activeFile?.path === file.path) {
      return
    }
    const generation = ++fileLoadGeneration

    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, t('switching files'))

      if (decision === 'save') {
        await state.saveCurrentFile()
        if (get().isDirty) return
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(t("Failed to discard unsaved changes: {error}", { error: String(error) }))
          return
        }
      }
    }

    try {
      if (generation !== fileLoadGeneration) return
      const latestState = get()
      const existingTab = latestState.openTabs.find(t => t.path === file.path)

      if (existingTab) {
        const diskHash = await invoke<string>('hash_file_content', {
          filePath: file.path,
        })
        if (generation !== fileLoadGeneration) return

        if (diskHash === existingTab.contentHash) {
          set({
            activeFile: toExcalidrawFile(existingTab),
            fileContent: existingTab.cachedContent,
            activeFileLoadSource: 'cache',
            isDirty: existingTab.modified,
          })
          return
        }
      }

      const updatedTab = await readOpenTabFromDisk(
        file,
        existingTab ? existingTab.sceneVersion + 1 : 0
      )
      if (generation !== fileLoadGeneration) return
      const updatedFile = toExcalidrawFile(updatedTab)
      const openTabs = existingTab
        ? get().openTabs.map((tab) => (tab.path === file.path ? updatedTab : tab))
        : [...get().openTabs, updatedTab]

      set({
        activeFile: updatedFile,
        fileContent: updatedTab.cachedContent,
        activeFileLoadSource: 'disk',
        isDirty: false,
        openTabs,
      })

      state.markFileAsModified(file.path, false)
      state.markTreeNodeAsModified(file.path, false)
    } catch (error) {
      console.error('Failed to load file:', error)

      // If file doesn't exist, refresh the tree and show error
      if (String(error).includes('No such file') || String(error).includes('not found')) {
        alert(t('File not found: {name}\n\nThe file may have been deleted or moved. Refreshing file list...', { name: file.name }))

        // Clear active file if it's the one that failed
        if (state.activeFile?.path === file.path) {
          set({
            activeFile: null,
            fileContent: null,
            activeFileLoadSource: null,
            isDirty: false,
          })
        }

        // Refresh the file tree
        if (state.currentDirectory) {
          await state.loadFileTree(state.currentDirectory)
        }
      } else {
        // Other errors
        alert(t("Failed to load file: {error}", { error: String(error) }))
      }
    }
  },

  // Load file from tree node
  loadFileFromTree: async (node) => {
    if (node.is_directory) return

    await get().loadFile({
      name: node.name,
      path: node.path,
      modified: node.modified,
    })
  },

  // Save current file
  saveCurrentFile: async (content) => {
    const state = get()
    const { activeFile, fileContent, isDirty } = state

    const pending = activeFile && savingFiles.get(activeFile.path)
    if (pending) {
      await pending
      if (get().activeFile?.path === activeFile?.path) await get().saveCurrentFile(content)
      return
    }

    if (!activeFile) {
      return
    }

    // Only save if file is dirty
    if (!isDirty && !content) {
      return
    }

    const contentToSave = content || fileContent
    if (!contentToSave) {
      return
    }

    // Validate JSON before saving
    try {
      const parsed = JSON.parse(contentToSave)
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid Excalidraw JSON structure')
      }
    } catch (jsonError) {
      console.error('[saveCurrentFile] Invalid JSON, not saving:', jsonError)
      throw jsonError
    }

    try {
      const operation = invoke<string>('save_file', {
        filePath: activeFile.path,
        content: contentToSave,
      })
      savingFiles.set(activeFile.path, operation)
      const contentHash = await operation

      // Keep edits made during the filesystem write marked as unsaved.
      const changedDuringSave = get().openTabs.find(tab => tab.path === activeFile.path)?.cachedContent !== fileContent
      state.markFileAsModified(activeFile.path, changedDuringSave)
      state.markTreeNodeAsModified(activeFile.path, changedDuringSave)
      set((currentState) => ({
        isDirty: currentState.activeFile?.path === activeFile.path ? changedDuringSave : currentState.isDirty,
        activeFile: currentState.activeFile?.path === activeFile.path ? { ...activeFile, modified: changedDuringSave } : currentState.activeFile,
        fileContent: currentState.activeFile?.path === activeFile.path && !changedDuringSave ? contentToSave : currentState.fileContent,
        openTabs: currentState.openTabs.map((tab) =>
          tab.path === activeFile.path
            ? {
                ...tab,
                cachedContent: changedDuringSave ? tab.cachedContent : contentToSave,
                contentHash,
                modified: changedDuringSave,
              }
            : tab
        ),
      }))
    } catch (error) {
      console.error('[saveCurrentFile] Failed to save file:', error)
      alert(t("Failed to save file: {error}", { error: String(error) }))
      throw error
    } finally {
      savingFiles.delete(activeFile.path)
    }
  },

  // Create new file
  createNewFile: async (fileName, directory) => {
    const state = get()
    let { currentDirectory } = state

    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, t('creating a new file'))

      if (decision === 'save') {
        await state.saveCurrentFile()
        if (get().isDirty) return
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(t("Failed to discard unsaved changes: {error}", { error: String(error) }))
          return
        }
      }
    }

    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }
        // Load the selected directory
        if (!await state.loadDirectory(dir)) return
        currentDirectory = dir
      } catch (error) {
        console.error('Failed to select directory:', error)
        alert(t("Failed to select directory: {error}", { error: String(error) }))
        return
      }
    }

    // Generate default filename if not provided
    const finalFileName = fileName || `Untitled-${Date.now()}.excalidraw`
    const requestedFileName = finalFileName.endsWith('.excalidraw')
      ? finalFileName
      : `${finalFileName}.excalidraw`
    const targetDirectory = directory || currentDirectory

    try {
      // Create the new file
      const filePath = await invoke<string>('create_new_file', {
        directory: targetDirectory,
        fileName: requestedFileName,
      })

      // Reload the file tree to show the new file
      await state.loadFileTree(currentDirectory)

      // Create an ExcalidrawFile object for the new file
      const file: ExcalidrawFile = {
        name: fileNameFromPath(filePath),
        path: filePath,
        modified: false,
      }

      // Load the new file immediately
      await state.loadFile(file)
    } catch (error) {
      console.error('Failed to create new file:', error)
      alert(t("Failed to create file: {error}", { error: String(error) }))
    }
  },

  // Create new folder
  createNewFolder: async (folderName, directory) => {
    const state = get()
    let { currentDirectory } = state

    // Check if a directory is selected
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!dir) {
          return
        }
        // Load the selected directory
        if (!await state.loadDirectory(dir)) return
        currentDirectory = dir
      } catch (error) {
        console.error('[createNewFolder] Failed to select directory:', error)
        alert(t("Failed to select directory: {error}", { error: String(error) }))
        return
      }
    }

    // Generate default folder name if not provided
    const finalFolderName = folderName || `New Folder-${Date.now()}`
    const targetDirectory = directory || currentDirectory

    try {
      await invoke<string>('create_new_folder', {
        directory: targetDirectory,
        folderName: finalFolderName,
      })

      // Reload the file tree to show the new folder
      await state.loadFileTree(currentDirectory)
    } catch (error) {
      console.error('[createNewFolder] Failed to create folder:', error)
      alert(t("Failed to create folder: {error}", { error: String(error) }))
    }
  },

  // Rename file
  renameFile: async (oldPath, newName) => {
    try {
      // Ensure the new name has .excalidraw extension
      const finalName = newName.endsWith('.excalidraw')
        ? newName
        : `${newName}.excalidraw`

      const newPath = await invoke<string>('rename_file', {
        oldPath,
        newName: finalName,
      })

      const state = get()
      const renamedFile = {
        name: finalName,
        path: newPath,
        modified: state.activeFile?.path === oldPath ? state.isDirty : false,
      }

      set({
        activeFile: state.activeFile?.path === oldPath ? renamedFile : state.activeFile,
        openTabs: state.openTabs.map((tab) =>
          tab.path === oldPath ? { ...tab, name: finalName, path: newPath } : tab
        ),
      })

      // Reload the file tree
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename file:', error)
      alert(t("Failed to rename file: {error}", { error: String(error) }))
    }
  },

  // Rename folder
  renameFolder: async (oldPath, newName) => {
    try {
      const newPath = await invoke<string>('rename_folder', {
        oldPath,
        newName,
      })

      const state = get()
      const updatedTabs = state.openTabs.map((tab) => {
        if (!isPathInsideDirectory(tab.path, oldPath)) {
          return tab
        }

        const nextPath = replacePathPrefix(tab.path, oldPath, newPath)
        return {
          ...tab,
          path: nextPath,
          name: fileNameFromPath(nextPath),
        }
      })

      const activeFile = state.activeFile && isPathInsideDirectory(state.activeFile.path, oldPath)
        ? {
            ...state.activeFile,
            path: replacePathPrefix(state.activeFile.path, oldPath, newPath),
            name: fileNameFromPath(replacePathPrefix(state.activeFile.path, oldPath, newPath)),
          }
        : state.activeFile

      set({
        activeFile,
        openTabs: updatedTabs,
      })

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error('Failed to rename folder:', error)
      alert(t("Failed to rename folder: {error}", { error: String(error) }))
    }
  },

  // Delete file
  // NOTE: Confirmation should be handled by the caller
  deleteFile: async (filePath) => {
    try {
      await invoke('delete_file', { filePath })
      const state = get()
      const openTabs = state.openTabs.filter((tab) => tab.path !== filePath)

      if (state.activeFile?.path === filePath) {
        set({
          openTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      } else {
        set({ openTabs })
      }

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }

      return true
    } catch (error) {
      console.error('[deleteFile] Failed to delete file:', error)
      throw error
    }
  },

  // Delete folder
  // NOTE: Confirmation should be handled by the caller
  deleteFolder: async (folderPath) => {
    try {
      await invoke('delete_folder', { folderPath })
      const state = get()
      const openTabs = state.openTabs.filter((tab) => !isPathInsideDirectory(tab.path, folderPath))

      if (state.activeFile && isPathInsideDirectory(state.activeFile.path, folderPath)) {
        set({
          openTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      } else {
        set({ openTabs })
      }

      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }

      return true
    } catch (error) {
      console.error('[deleteFolder] Failed to delete folder:', error)
      throw error
    }
  },

  // Load preferences
  loadPreferences: async () => {
    try {
      // The Go backend returns snake_case fields
      const prefs = await invoke<any>('get_preferences')

      // Convert snake_case from Go to camelCase for TypeScript
      const safePrefs = convertPreferencesFromBackend(prefs)

      set({
        preferences: safePrefs,
        sidebarVisible: safePrefs.sidebarVisible,
      })

      // Apply decorations preference
      if (safePrefs.showDecorations === false) {
        invoke('set_decorations', { visible: false })
      }

      // Apply theme
      const root = document.documentElement
      if (safePrefs.theme === 'dark') {
        root.classList.add('dark')
      } else if (safePrefs.theme === 'light') {
        root.classList.remove('dark')
      } else {
        // System theme
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
        if (prefersDark) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }

      // Auto-load last directory if it exists
      if (safePrefs.lastDirectory) {
        try {
          if (!await get().loadDirectory(safePrefs.lastDirectory)) throw new Error('Directory was not opened')
        } catch (dirError) {
          console.error('Failed to auto-load last directory:', dirError)
          // Clear the invalid lastDirectory from preferences
          const newPrefs = { ...safePrefs, lastDirectory: null }
          set({ preferences: newPrefs })
          await get().savePreferences()
        }
      }
    } catch (error) {
      console.error('Failed to load preferences:', error)
      // Set default preferences if loading fails
      const defaultPrefs: Preferences = {
        lastDirectory: null,
        recentDirectories: [],
        theme: 'system',
        language: 'en',
        sidebarVisible: true,
        showDecorations: true,
      }
      set({
        preferences: defaultPrefs,
        sidebarVisible: true,
      })
    }
  },

  // Save preferences
  savePreferences: async () => {
    const logPrefix = '[savePreferences 保存应用设置][app=excaligo]'
    const { preferences } = get()
    try {
      // Convert camelCase to snake_case for Go backend
      const prefsToSave = convertPreferencesToBackend(preferences)
      preferenceWrites = preferenceWrites.catch(() => {}).then(() => invoke('save_preferences', { preferences: prefsToSave }))
      await preferenceWrites
      return true
    } catch (error) {
      console.error(logPrefix, error)
      alert(t('Failed to save preferences: {error}', { error: String(error) }))
      return false
    }
  },

  updateAppearance: async (updates) => {
    const generation = ++appearanceGeneration
    const previous = get().preferences
    const next = { ...previous, ...updates }
    set({ preferences: next })
    if (!await get().savePreferences()) {
      if (generation !== appearanceGeneration) return
      // Roll back only this failed selection, never a subsequent user choice.
      set(state => {
        const rollback: Partial<Preferences> = {}
        if (updates.theme && state.preferences.theme === updates.theme) rollback.theme = previous.theme
        if (updates.language && state.preferences.language === updates.language) rollback.language = previous.language
        return { preferences: { ...state.preferences, ...rollback } }
      })
    }
  },

  // Toggle sidebar
  toggleSidebar: () => {
    const state = get()
    const newVisible = !state.sidebarVisible
    set({ sidebarVisible: newVisible })

    // Update preferences
    const newPrefs = { ...state.preferences, sidebarVisible: newVisible }
    set({ preferences: newPrefs })
    state.savePreferences()
  },

  // Toggle presentation mode
  togglePresentationMode: () => {
    const state = get()
    const entering = !state.presentationMode
    set({ presentationMode: entering })

    if (entering) {
      invoke('set_menu_visible', { visible: false }).catch((error) => {
        console.error('Failed to hide menu for presentation mode:', error)
        set({ presentationMode: false })
      })
    } else {
      if (state.preferences.showDecorations) {
        invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu after presentation mode:', error)
        })
      }
    }
  },

  // Toggle decorations
  toggleDecorations: () => {
    const state = get()
    const newVisible = !state.preferences.showDecorations
    invoke('set_decorations', { visible: newVisible })
      .then(() => {
        const newPrefs = { ...state.preferences, showDecorations: newVisible }
        set({ preferences: newPrefs })
        get().savePreferences()
      })
      .catch((error) => {
        console.error('Failed to toggle window decorations:', error)
        alert(t("Failed to toggle window decorations: {error}", { error: String(error) }))
      })
  },

  // Close tab
  closeTab: async (filePath) => {
    const state = get()
    const tabIndex = state.openTabs.findIndex(t => t.path === filePath)
    if (tabIndex === -1) return

    const tab = state.openTabs[tabIndex]

    // Check for unsaved changes if this is the active file
    if (state.activeFile?.path === filePath && state.isDirty) {
      const decision = await confirmUnsavedChanges(tab.name, t('closing'))

      if (decision === 'save') {
        await state.saveCurrentFile()
        if (get().isDirty) return
      } else if (decision === 'cancel') {
        return
      } else {
        try {
          const existingTab = get().openTabs.find((tab) => tab.path === state.activeFile?.path)
          const cleanTab = await readOpenTabFromDisk(
            state.activeFile,
            (existingTab?.sceneVersion || 0) + 1
          )

          set((currentState) => ({
            activeFile: toExcalidrawFile(cleanTab),
            fileContent: cleanTab.cachedContent,
            activeFileLoadSource: 'disk',
            isDirty: false,
            openTabs: currentState.openTabs.map((tab) =>
              tab.path === cleanTab.path ? cleanTab : tab
            ),
          }))
          state.markFileAsModified(cleanTab.path, false)
          state.markTreeNodeAsModified(cleanTab.path, false)
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(t("Failed to discard unsaved changes: {error}", { error: String(error) }))
          return
        }
      }
    }

    const newTabs = get().openTabs.filter(t => t.path !== filePath)

    if (state.activeFile?.path === filePath) {
      // Switch to adjacent tab
      if (newTabs.length > 0) {
        const newIndex = Math.min(tabIndex, newTabs.length - 1)
        const newActiveTab = newTabs[newIndex]
        set({ openTabs: newTabs, activeFile: null, fileContent: null, activeFileLoadSource: null, isDirty: false })
        await get().loadFile(newActiveTab)
      } else {
        set({
          openTabs: newTabs,
          activeFile: null,
          fileContent: null,
          activeFileLoadSource: null,
          isDirty: false,
        })
      }
    } else {
      set({ openTabs: newTabs })
    }
  },

}))
