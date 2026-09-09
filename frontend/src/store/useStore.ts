import { create } from 'zustand'
import { invoke } from '../lib/backend'
import { CachedExcalidrawScene, ExcalidrawFile, FileTreeNode, OpenTab, Preferences } from '../types'
import { convertPreferencesFromBackend, convertPreferencesToBackend } from '../lib/preferences'
import { ask } from '../lib/backend'
import { translate, type MessageKey, type Parameters } from '../lib/i18n'
import { canDropFile, findTreeNode, moveTreeFile, normalizeFilePath, renameDestination } from '../lib/fileMove'
import { FileConflictError } from '../lib/fileSync'

type UnsavedChangesDecision = 'save' | 'discard' | 'cancel'
type FileLoadSource = 'cache' | 'disk' | null
const savingFiles = new Map<string, Promise<string>>()
let fileLoadGeneration = 0
let directoryLoadGeneration = 0
let directoryWatch: Promise<unknown> = Promise.resolve()
let preferenceWrites: Promise<unknown> = Promise.resolve()
let confirmedPreferences: Preferences | null = null
const pendingPreferenceWrites: Partial<Preferences>[] = []
let fileTreeGeneration = 0
let editorSequence = 0

// Local identity only; no secure-context browser API or persistent ID is needed.
export function createEditorKey(): string { return `editor-${++editorSequence}` }

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
    editorKey: createEditorKey(),
    cachedContent: content,
    contentHash,
    cachedScene: parseSceneFromContent(content),
    sceneVersion,
    externalConflict: undefined,
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

async function saveForTransition(save: () => Promise<void>): Promise<boolean> {
  try {
    await save()
    return true
  } catch (error) {
    // The persistent conflict notice already offers the next action. Abort
    // navigation without a second modal or an unhandled click rejection.
    if (error instanceof FileConflictError) return false
    throw error
  }
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

// Name-changing operations share one guard: watchers must not prune old paths
// until tabs have been updated, and no new save may target those old paths.
function beginFileMutation(path: string) {
  useStore.setState({ fileMutationPath: path })
  fileLoadGeneration++
  directoryLoadGeneration++
  fileTreeGeneration++
}

async function waitForFileWrites(path: string) {
  await Promise.all([...savingFiles].filter(([file]) => isPathInsideDirectory(file, path)).map(([, operation]) => operation))
}

function activeDocumentUnchanged(snapshot: Pick<AppStore, 'activeFile' | 'fileContent'>): boolean {
  const current = useStore.getState()
  return current.activeFile?.path === snapshot.activeFile?.path && current.fileContent === snapshot.fileContent
}

function renameConflictsWithOpenTab(oldPath: string, requestedName: string): boolean {
  const source = normalizeFilePath(oldPath)
  const destination = renameDestination(oldPath, requestedName)
  return useStore.getState().openTabs.some(tab => {
    const path = normalizeFilePath(tab.path)
    return isPathInsideDirectory(path, destination) && !isPathInsideDirectory(path, source)
  })
}

export function openDocumentsUnchanged(snapshot: Pick<AppStore, 'activeFile' | 'fileContent' | 'openTabs'>): boolean {
  const current = useStore.getState()
  return activeDocumentUnchanged(snapshot) && current.openTabs.length === snapshot.openTabs.length &&
    snapshot.openTabs.every(tab => current.openTabs.find(item => item.path === tab.path)?.cachedContent === tab.cachedContent)
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
  readOnly: boolean
  savingBeforeReadOnly: boolean
  fileMutationPath: string | null
  pendingFileLoad: number | null
  presentationMode: boolean
  openTabs: OpenTab[]
  fileConflictPath: string | null

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
  saveTab: (filePath: string, content?: string) => Promise<void>
  toggleReadOnly: () => Promise<void>
  resolveFileConflict: (filePath: string, choice: 'reload' | 'overwrite', expectedHash: string | null) => Promise<void>
  createNewFile: (fileName?: string, directory?: string) => Promise<void>
  createNewFolder: (folderName?: string, directory?: string) => Promise<void>
  renameFile: (oldPath: string, newName: string) => Promise<void>
  renameFolder: (oldPath: string, newName: string) => Promise<void>
  moveFile: (filePath: string, directory: string) => Promise<boolean>
  deleteFile: (filePath: string) => Promise<boolean>
  deleteFolder: (folderPath: string) => Promise<boolean>
  loadPreferences: () => Promise<void>
  savePreferences: (updates: Partial<Preferences>) => Promise<boolean>
  updateAppearance: (updates: Partial<Pick<Preferences, 'theme' | 'language'>>) => Promise<void>
  setReadOnlyWheelZoom: (enabled: boolean) => Promise<void>
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
    readOnlyWheelZoom: false,
  },
  sidebarVisible: true,
  isDirty: false,
  readOnly: true,
  savingBeforeReadOnly: false,
  fileMutationPath: null,
  pendingFileLoad: null,
  presentationMode: false,
  openTabs: [],
  fileConflictPath: null,

  // Basic setters
  setCurrentDirectory: (dir) => set({ currentDirectory: dir }),
  setFiles: (files) => set({ files }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setActiveFile: (file) => set(state => ({ activeFile: file,
    readOnly: state.activeFile?.path === file?.path ? state.readOnly : true })),
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
    if (get().savingBeforeReadOnly || get().fileMutationPath) return false
    const logPrefix = `[loadDirectory 加载工作目录][directory=${dir}]`
    const generation = ++directoryLoadGeneration
    fileLoadGeneration++
    try {
      const state = get()
      const isCurrent = () => generation === directoryLoadGeneration && openDocumentsUnchanged(state)
      if (state.isDirty && state.activeFile) {
        const decision = await confirmUnsavedChanges(state.activeFile.name, t('switching directories'))
        if (!isCurrent()) return false
        if (decision === 'cancel') return false
        if (decision === 'save') {
          if (!await saveForTransition(() => state.saveCurrentFile())) return false
          if (get().isDirty) return false
        }
      }
      for (const tab of state.openTabs.filter(tab => tab.modified && tab.path !== state.activeFile?.path)) {
        if (!isCurrent()) return false
        const decision = await confirmUnsavedChanges(tab.name, t('switching directories'))
        if (!isCurrent() || decision === 'cancel') return false
        if (decision === 'save') {
          if (!await saveForTransition(() => get().saveTab(tab.path))) return false
          if (get().openTabs.find(item => item.path === tab.path)?.modified) return false
        }
      }
      if (!isCurrent()) return false
      const [files, fileTree] = await Promise.all([
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir })
      ])
      if (!isCurrent()) return false
      // Serialize watcher replacement as Wails service calls may run concurrently.
      directoryWatch = directoryWatch.catch(() => {}).then(() => {
        if (isCurrent()) return invoke('watch_directory', { directory: dir })
      })
      await directoryWatch
      if (!isCurrent()) {
        // A slow watcher installation must not leave the old workspace unwatched.
        const currentDirectory = get().currentDirectory
        if (generation === directoryLoadGeneration && currentDirectory && currentDirectory !== dir) {
          directoryWatch = directoryWatch.catch(() => {}).then(() => invoke('watch_directory', { directory: currentDirectory }))
          await directoryWatch
        }
        return false
      }

      if (state.presentationMode && state.preferences.showDecorations) {
        await invoke('set_menu_visible', { visible: true }).catch((error) => {
          console.error('Failed to restore menu before loading directory:', error)
        })
      }

      if (!isCurrent()) return false

      set({
        currentDirectory: dir,
        files,
        fileTree,
        activeFile: null,
        readOnly: true,
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

      await get().savePreferences({
        lastDirectory: dir,
        recentDirectories: recentDirs,
      })

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
    const generation = ++fileTreeGeneration
    try {
      const [fileTree, files] = await Promise.all([
        invoke<FileTreeNode[]>('get_file_tree', { directory: dir }),
        invoke<ExcalidrawFile[]>('list_excalidraw_files', { directory: dir }),
      ])
      if (get().currentDirectory !== dir || generation !== fileTreeGeneration) return
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
    if (get().savingBeforeReadOnly || get().fileMutationPath) return
    const state = get()

    // If clicking the same file that's already active, do nothing
    if (state.activeFile?.path === file.path) {
      return
    }
    const generation = ++fileLoadGeneration
    let snapshot = state
    const isCurrent = () => generation === fileLoadGeneration && activeDocumentUnchanged(snapshot)

    // Suspend refresh of the old active canvas until this request settles.
    // Keep the document snapshot guard intact for actual edits during the read.
    set({ pendingFileLoad: generation })
    try {
      // Check if current file has unsaved changes
      if (state.isDirty && state.activeFile) {
        const decision = await confirmUnsavedChanges(state.activeFile.name, t('switching files'))
        if (!isCurrent()) return

        if (decision === 'save') {
          if (!await saveForTransition(() => state.saveCurrentFile())) return
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

            if (!isCurrent()) return

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
            snapshot = get()
          } catch (error) {
            console.error('Failed to discard unsaved changes:', error)
            alert(t("Failed to discard unsaved changes: {error}", { error: String(error) }))
            return
          }
        }
      }

      try {
        if (!isCurrent()) return
        const latestState = get()
        const existingTab = latestState.openTabs.find(t => t.path === file.path)

        // Unsaved memory is authoritative even if the external file disappeared
        // or changed. Hash-based reloads are only safe for clean tabs.
        if (existingTab?.modified) {
          set({ activeFile: toExcalidrawFile(existingTab), fileContent: existingTab.cachedContent,
            activeFileLoadSource: 'cache', isDirty: true, readOnly: false })
          return
        }

        if (existingTab) {
          const diskHash = await invoke<string>('hash_file_content', {
            filePath: file.path,
          })
          if (!isCurrent()) return

          if (diskHash === existingTab.contentHash) {
            set({
              activeFile: toExcalidrawFile(existingTab),
              fileContent: existingTab.cachedContent,
              activeFileLoadSource: 'cache',
              isDirty: existingTab.modified,
              readOnly: !existingTab.modified,
            })
            return
          }
        }

        const updatedTab = await readOpenTabFromDisk(
          file,
          existingTab ? existingTab.sceneVersion + 1 : 0
        )
        if (!isCurrent()) return
        const updatedFile = toExcalidrawFile(updatedTab)
        const openTabs = existingTab
          ? get().openTabs.map((tab) => (tab.path === file.path ? updatedTab : tab))
          : [...get().openTabs, updatedTab]

        set({
          activeFile: updatedFile,
          readOnly: true,
          fileContent: updatedTab.cachedContent,
          activeFileLoadSource: 'disk',
          isDirty: false,
          openTabs,
        })

        state.markFileAsModified(file.path, false)
        state.markTreeNodeAsModified(file.path, false)
      } catch (error) {
        if (!isCurrent()) return
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
    } finally {
      // An older request must not resume syncing while a newer one is pending.
      if (get().pendingFileLoad === generation) set({ pendingFileLoad: null })
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
    if (state.readOnly || state.fileMutationPath) return
    if (state.activeFile) await get().saveTab(state.activeFile.path, content)
  },

  saveTab: async (filePath, content) => {
    const logPrefix = `[saveTab 保存绘图标签][filePath=${filePath}]`
    const state = get()
    const isActive = state.activeFile?.path === filePath
    if (state.fileMutationPath || (isActive && state.readOnly)) return
    const activeFile = state.openTabs.find(tab => tab.path === filePath)
    const fileContent = isActive ? state.fileContent : activeFile?.cachedContent
    const isDirty = isActive ? state.isDirty : activeFile?.modified

    const pending = activeFile && savingFiles.get(activeFile.path)
    if (pending) {
      await pending
      await get().saveTab(filePath, content)
      return
    }

    if (!activeFile) {
      return
    }

    if (activeFile.externalConflict) {
      set({ fileConflictPath: filePath })
      throw new FileConflictError(activeFile.externalConflict.contentHash || '')
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
      console.error(logPrefix, jsonError)
      throw jsonError
    }

    try {
      const operation = invoke<string>('save_file', {
        filePath: activeFile.path,
        content: contentToSave,
        expectedHash: activeFile.contentHash,
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
      if (error instanceof FileConflictError) {
        set(current => ({ fileConflictPath: filePath, openTabs: current.openTabs.map(tab =>
          tab.path === filePath ? { ...tab, externalConflict: { contentHash: error.contentHash } } : tab) }))
        console.info(logPrefix, 'external version changed; save paused')
        throw error
      }
      console.error(logPrefix, error)
      alert(t("Failed to save file: {error}", { error: String(error) }))
      throw error
    } finally {
      savingFiles.delete(activeFile.path)
    }
  },

  resolveFileConflict: async (filePath, choice, expectedHash) => {
    const logPrefix = `[resolveFileConflict 处理保存冲突][filePath=${filePath}]`
    const state = get()
    const tab = state.openTabs.find(item => item.path === filePath)
    if (!tab?.externalConflict || state.fileMutationPath || state.savingBeforeReadOnly) return
    // The button acts on the version that was displayed, not a newer version
    // discovered after the user clicked. No unconditional overwrite exists.
    if (choice === 'overwrite' && (!expectedHash || tab.externalConflict.contentHash !== expectedHash)) return
    beginFileMutation(filePath)
    try {
      await waitForFileWrites(filePath)
      const snapshot = get().openTabs.find(item => item.path === filePath)
      if (!snapshot || snapshot.editorKey !== tab.editorKey || snapshot.sceneVersion !== tab.sceneVersion) return
      let clean: OpenTab
      if (choice === 'reload') {
        clean = await readOpenTabFromDisk(snapshot, snapshot.sceneVersion + 1)
        clean.editorKey = snapshot.editorKey
        if (get().openTabs.find(item => item.path === filePath)?.cachedContent !== snapshot.cachedContent) {
          console.info(logPrefix, 'local input finished during reload; confirmation still required')
          return
        }
      } else {
        const contentHash = await invoke<string>('save_file', {
          filePath, content: snapshot.cachedContent, expectedHash,
        })
        const latest = get().openTabs.find(item => item.path === filePath)
        if (!latest) return
        // A final core callback may arrive after the write started. Preserve it
        // as unsaved data, just as an ordinary save preserves concurrent edits.
        clean = { ...latest, contentHash, modified: latest.cachedContent !== snapshot.cachedContent, externalConflict: undefined }
      }
      set(current => ({
        openTabs: current.openTabs.map(item => item.path === filePath ? clean : item),
        fileConflictPath: current.fileConflictPath === filePath ? null : current.fileConflictPath,
        ...(current.activeFile?.path === filePath ? {
          activeFile: toExcalidrawFile(clean), fileContent: clean.cachedContent, isDirty: clean.modified,
          ...(choice === 'reload' ? { readOnly: true, activeFileLoadSource: 'disk' as const } : {}),
        } : {}),
      }))
      get().markFileAsModified(filePath, clean.modified)
      get().markTreeNodeAsModified(filePath, clean.modified)
    } catch (error) {
      if (error instanceof FileConflictError) {
        set(current => ({ fileConflictPath: filePath, openTabs: current.openTabs.map(item =>
          item.path === filePath ? { ...item, externalConflict: { contentHash: error.contentHash } } : item) }))
        console.info(logPrefix, 'external version changed again; confirmation required')
      } else {
        console.error(logPrefix, error)
        alert(t(choice === 'reload' ? 'Failed to load file: {error}' : 'Failed to save file: {error}', { error: String(error) }))
      }
    } finally {
      set({ fileMutationPath: null })
    }
  },

  // Application-level policy. Excalidraw stays an unmodified dependency.
  toggleReadOnly: async () => {
    const state = get()
    if (!state.activeFile || state.savingBeforeReadOnly || state.fileMutationPath) return
    if (state.openTabs.find(tab => tab.path === state.activeFile?.path)?.externalConflict) {
      set({ fileConflictPath: state.activeFile.path })
      return
    }
    if (state.readOnly) {
      set({ readOnly: false })
      return
    }
    const path = state.activeFile.path
    const logPrefix = `[toggleReadOnly 保存后只读][filePath=${path}]`
    set({ savingBeforeReadOnly: true })
    try {
      // Let React apply view mode and finish blur callbacks before saving.
      // Continue accepting final onChange events until the write succeeds.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      do {
        if (get().activeFile?.path !== path) return
        await get().saveCurrentFile()
      } while (get().activeFile?.path === path && get().isDirty)
      if (get().activeFile?.path === path) set({ readOnly: true })
    } catch (error) {
      // saveCurrentFile already reports the error; retain editable dirty data.
      console.error(logPrefix, error)
    } finally {
      set({ savingBeforeReadOnly: false })
    }
  },

  // Create new file
  createNewFile: async (fileName, directory) => {
    if (get().savingBeforeReadOnly || get().fileMutationPath) return
    const state = get()
    let generation = ++fileLoadGeneration
    let snapshot = state
    const isCurrent = () => generation === fileLoadGeneration && activeDocumentUnchanged(snapshot)
    let { currentDirectory } = state

    // Check if current file has unsaved changes
    if (state.isDirty && state.activeFile) {
      const decision = await confirmUnsavedChanges(state.activeFile.name, t('creating a new file'))
      if (!isCurrent()) return

      if (decision === 'save') {
        if (!await saveForTransition(() => state.saveCurrentFile())) return
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

          if (!isCurrent()) return
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
          snapshot = get()
        } catch (error) {
          console.error('Failed to discard unsaved changes:', error)
          alert(t("Failed to discard unsaved changes: {error}", { error: String(error) }))
          return
        }
      }
    }

    // Check if a directory is selected
    if (!isCurrent()) return
    if (!currentDirectory) {
      // Prompt to select a directory if none is selected
      try {
        const dir = await invoke<string | null>('select_directory')
        if (!isCurrent()) return
        if (!dir) {
          return
        }
        // Load the selected directory
        if (!await state.loadDirectory(dir)) return
        currentDirectory = dir
        generation = fileLoadGeneration
        snapshot = get()
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
      if (!isCurrent()) return

      // Reload the file tree to show the new file
      await state.loadFileTree(currentDirectory)
      if (!isCurrent()) return

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
    if (get().fileMutationPath) return
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
    if (get().savingBeforeReadOnly || get().fileMutationPath) return
    const logPrefix = `[renameFile 重命名绘图][filePath=${oldPath}]`
    beginFileMutation(oldPath)
    try {
      // Ensure the new name has .excalidraw extension
      const finalName = newName.endsWith('.excalidraw')
        ? newName
        : `${newName}.excalidraw`

      if (renameConflictsWithOpenTab(oldPath, finalName)) {
        alert(t('A file with this name is already open.'))
        return
      }

      await waitForFileWrites(oldPath)
      const newPath = await invoke<string>('rename_file', {
        oldPath,
        newName: finalName,
      })

      const state = get()
      const renamedFile = {
        name: fileNameFromPath(newPath),
        path: newPath,
        modified: state.activeFile?.path === oldPath ? state.isDirty : false,
      }

      set({
        activeFile: state.activeFile?.path === oldPath ? renamedFile : state.activeFile,
        openTabs: state.openTabs.map((tab) =>
          tab.path === oldPath ? { ...tab, name: fileNameFromPath(newPath), path: newPath } : tab
        ),
      })

      // Reload the file tree
      if (state.currentDirectory) {
        await state.loadFileTree(state.currentDirectory)
      }
    } catch (error) {
      console.error(logPrefix, error)
      alert(t("Failed to rename file: {error}", { error: String(error) }))
    } finally {
      set({ fileMutationPath: null })
    }
  },

  // Rename folder
  renameFolder: async (oldPath, newName) => {
    if (get().savingBeforeReadOnly || get().fileMutationPath) return
    const logPrefix = `[renameFolder 重命名目录][directory=${oldPath}]`
    beginFileMutation(oldPath)
    try {
      if (renameConflictsWithOpenTab(oldPath, newName)) {
        alert(t('A file with this name is already open.'))
        return
      }
      await waitForFileWrites(oldPath)
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
      console.error(logPrefix, error)
      alert(t("Failed to rename folder: {error}", { error: String(error) }))
    } finally {
      set({ fileMutationPath: null })
    }
  },

  // Moving changes the path only; unsaved content stays in the existing tab.
  moveFile: async (filePath, directory) => {
    const logPrefix = `[moveFile 移动侧边栏文件][filePath=${filePath}][directory=${directory}]`
    const state = get()
    const source = findTreeNode(state.fileTree, filePath)
    const target = directory === state.currentDirectory || findTreeNode(state.fileTree, directory)?.is_directory
    if (state.fileMutationPath || state.savingBeforeReadOnly || !state.currentDirectory ||
      !source || source.is_directory || !target || !canDropFile(filePath, directory)) return false

    const expectedPath = `${normalizeFilePath(directory).replace(/\/$/, '')}/${source.name}`
    if (state.openTabs.some(tab => normalizeFilePath(tab.path) === expectedPath)) {
      alert(t('A file with this name is already open.'))
      return false
    }

    beginFileMutation(filePath)
    try {
      // Wait for an already-started write, while preventing new writes to the old path.
      await savingFiles.get(filePath)
      const newPath = await invoke<string>('move_file', { filePath, directory })
      set(current => ({
        activeFile: current.activeFile?.path === filePath ? { ...current.activeFile, path: newPath } : current.activeFile,
        openTabs: current.openTabs.map(tab => tab.path === filePath ? { ...tab, path: newPath } : tab),
        files: current.files.map(file => file.path === filePath ? { ...file, path: newPath } : file),
        fileTree: moveTreeFile(current.fileTree, filePath, newPath, directory, state.currentDirectory!),
      }))
      await get().loadFileTree(state.currentDirectory)
      return true
    } catch (error) {
      console.error(logPrefix, error)
      alert(t('Failed to move file: {error}', { error: String(error) }))
      return false
    } finally {
      set({ fileMutationPath: null })
    }
  },

  // Delete file
  // NOTE: Confirmation should be handled by the caller
  deleteFile: async (filePath) => {
    if (get().savingBeforeReadOnly || get().fileMutationPath) return false
    const logPrefix = `[deleteFile 删除绘图][filePath=${filePath}]`
    beginFileMutation(filePath)
    try {
      await waitForFileWrites(filePath)
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
      console.error(logPrefix, error)
      throw error
    } finally {
      set({ fileMutationPath: null })
    }
  },

  // Delete folder
  // NOTE: Confirmation should be handled by the caller
  deleteFolder: async (folderPath) => {
    if (get().savingBeforeReadOnly || get().fileMutationPath) return false
    const logPrefix = `[deleteFolder 删除目录][directory=${folderPath}]`
    beginFileMutation(folderPath)
    try {
      await waitForFileWrites(folderPath)
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
      console.error(logPrefix, error)
      throw error
    } finally {
      set({ fileMutationPath: null })
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
          await get().savePreferences({ lastDirectory: null })
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
        readOnlyWheelZoom: false,
      }
      set({
        preferences: defaultPrefs,
        sidebarVisible: true,
      })
    }
  },

  // Save preferences
  savePreferences: (updates) => {
    const logPrefix = '[savePreferences 保存应用设置][app=excaligo]'
    const request = { ...updates }
    if (pendingPreferenceWrites.length === 0) confirmedPreferences = get().preferences
    pendingPreferenceWrites.push(request)
    set(state => ({
      preferences: { ...state.preferences, ...request },
      sidebarVisible: request.sidebarVisible ?? state.sidebarVisible,
    }))

    const result = preferenceWrites.then(async () => {
      // Construct the full backend payload only when this request runs. Failed
      // optimistic values from earlier requests must never enter later writes.
      const next = { ...confirmedPreferences!, ...request }
      let saved = false
      let errorMessage: string | undefined
      try {
        await invoke('save_preferences', { preferences: convertPreferencesToBackend(next) })
        confirmedPreferences = next
        saved = true
      } catch (error) {
        console.error(logPrefix, error)
        errorMessage = t('Failed to save preferences: {error}', { error: String(error) })
      } finally {
        pendingPreferenceWrites.shift()
        // Reapply newer pending choices, including later edits to the same
        // field. Reconcile before allowing the next queued request to run.
        const visible = pendingPreferenceWrites.reduce((prefs, patch) => ({ ...prefs, ...patch }), confirmedPreferences!)
        const resolved = Object.fromEntries(Object.keys(request).map(key => [key, visible[key as keyof Preferences]]))
        set(state => ({
          preferences: { ...state.preferences, ...resolved },
          sidebarVisible: 'sidebarVisible' in request ? visible.sidebarVisible : state.sidebarVisible,
        }))
      }
      if (errorMessage) alert(errorMessage)
      return saved
    })
    preferenceWrites = result.catch(() => {})
    return result
  },

  updateAppearance: async (updates) => {
    await get().savePreferences(updates)
  },

  setReadOnlyWheelZoom: async (enabled) => {
    const logPrefix = '[setReadOnlyWheelZoom 设置只读滚轮缩放][app=excaligo]'
    if (await get().savePreferences({ readOnlyWheelZoom: enabled })) {
      console.debug(logPrefix, { enabled })
    }
  },

  // Toggle sidebar
  toggleSidebar: () => {
    const state = get()
    const newVisible = !state.sidebarVisible
    void state.savePreferences({ sidebarVisible: newVisible })
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
    const logPrefix = '[toggleDecorations 切换窗口边框][app=excaligo]'
    const state = get()
    const newVisible = !state.preferences.showDecorations
    invoke('set_decorations', { visible: newVisible })
      .then(async () => {
        if (!await get().savePreferences({ showDecorations: newVisible })) {
          await invoke('set_decorations', { visible: get().preferences.showDecorations })
        }
      })
      .catch((error) => {
        console.error(logPrefix, error)
        alert(t("Failed to toggle window decorations: {error}", { error: String(error) }))
      })
  },

  // Close tab
  closeTab: async (filePath) => {
    if (get().savingBeforeReadOnly || get().fileMutationPath) return
    const state = get()
    const tabIndex = state.openTabs.findIndex(t => t.path === filePath)
    if (tabIndex === -1) return

    const tab = state.openTabs[tabIndex]
    const generation = ++fileLoadGeneration
    const isCurrent = () => generation === fileLoadGeneration && activeDocumentUnchanged(state) &&
      get().openTabs.find(item => item.path === filePath)?.cachedContent === tab.cachedContent

    // Background dirty tabs need the same explicit save/discard decision.
    if (tab.modified || (state.activeFile?.path === filePath && state.isDirty)) {
      const decision = await confirmUnsavedChanges(tab.name, t('closing'))
      if (!isCurrent()) return

      if (decision === 'save') {
        if (!await saveForTransition(() => state.activeFile?.path === filePath
          ? state.saveCurrentFile() : state.saveTab(filePath))) return
        if (get().openTabs.find(item => item.path === filePath)?.modified ||
          (get().activeFile?.path === filePath && get().isDirty)) return
      } else if (decision === 'cancel') {
        return
      }
    }

    if (!isCurrent()) return
    state.markFileAsModified(filePath, false)
    state.markTreeNodeAsModified(filePath, false)
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
