import { useEffect } from 'react'
import { listen, invoke, getCurrentWindow } from '../lib/backend'
import { useStore } from '../store/useStore'
import { promptForName } from '../lib/namePrompt'

interface MenuCommand { command: string; data?: unknown }
let globalExcalidrawAPI: any = null

export function setGlobalExcalidrawAPI(api: any) { globalExcalidrawAPI = api }

export async function executeMenuCommand(command: string, data?: unknown): Promise<void> {
  const state = useStore.getState()
  switch (command) {
    case 'open_directory': {
      const selected = await invoke<string | null>('select_directory')
      if (selected) await state.loadDirectory(selected)
      return
    }
    case 'new_file':
    case 'new_folder': {
      if (!state.currentDirectory) {
        const selected = await invoke<string | null>('select_directory')
        if (!selected) return
        await state.loadDirectory(selected)
        if (useStore.getState().currentDirectory !== selected) return
      }
      const folder = command === 'new_folder'
      const name = await promptForName({
        title: folder ? 'Folder name' : 'File name',
        defaultValue: folder ? 'New Folder' : 'Untitled.excalidraw', confirmLabel: 'Create',
      })
      if (name) {
        if (folder) await useStore.getState().createNewFolder(name)
        else await useStore.getState().createNewFile(name)
      }
      return
    }
    case 'save': await state.saveCurrentFile(); return
    case 'save_as': {
      if (!state.activeFile || !state.fileContent) return
      const original = state.activeFile
      const path = await invoke<string | null>('save_file_as', { content: state.fileContent })
      if (!path) return
      const saved = await invoke<{ content: string; content_hash: string }>('read_file_with_hash', { filePath: path })
      const scene = JSON.parse(saved.content)
      const tab = {
        name: path.split(/[\\/]/).pop() || original.name, path, modified: false,
        cachedContent: saved.content, contentHash: saved.content_hash, sceneVersion: 0,
        cachedScene: { elements: scene.elements, appState: scene.appState || {}, files: scene.files || {} },
      }
      const latest = useStore.getState()
      const originalTab = latest.openTabs.find(item => item.path === original.path)
      const destination = latest.openTabs.find(item => item.path === path)
      // The native dialog and disk write are asynchronous. Do not discard a
      // newer canvas or a dirty destination tab when their result arrives.
      if (latest.activeFile?.path !== original.path || originalTab?.cachedContent !== state.fileContent ||
        (path !== original.path && destination?.modified)) {
        if (!destination) useStore.setState({ openTabs: [...latest.openTabs, tab] })
        return
      }
      useStore.setState(current => ({
        activeFile: tab, fileContent: saved.content, isDirty: false, activeFileLoadSource: 'disk',
        openTabs: [...current.openTabs.filter(item => item.path !== path && item.path !== original.path), tab],
      }))
      state.markFileAsModified(original.path, false)
      state.markTreeNodeAsModified(original.path, false)
      if (state.currentDirectory) await useStore.getState().loadFileTree(state.currentDirectory)
      return
    }
    case 'quit':
    case 'close_window': await getCurrentWindow().close(); return
    case 'close_tab': if (state.activeFile) await state.closeTab(state.activeFile.path); return
    case 'next_tab':
    case 'previous_tab': {
      if (state.openTabs.length < 2 || !state.activeFile) return
      const index = state.openTabs.findIndex(tab => tab.path === state.activeFile?.path)
      const step = command === 'next_tab' ? 1 : -1
      await state.loadFile(state.openTabs[(index + step + state.openTabs.length) % state.openTabs.length])
      return
    }
    case 'clear_recent':
      state.setPreferences({ ...state.preferences, recentDirectories: [] })
      await useStore.getState().savePreferences()
      return
    case 'toggle_sidebar': state.toggleSidebar(); return
    case 'presentation': state.togglePresentationMode(); return
    case 'exit_presentation': if (state.presentationMode) state.togglePresentationMode(); return
    case 'toggle_decorations': state.toggleDecorations(); return
    case 'theme':
      if (data === 'light' || data === 'dark' || data === 'system') {
        state.setPreferences({ ...state.preferences, theme: data })
        await useStore.getState().savePreferences()
      }
      return
    case 'zoom_in':
    case 'zoom_out': {
      if (!globalExcalidrawAPI) return
      const current = globalExcalidrawAPI.getAppState().zoom.value
      globalExcalidrawAPI.updateScene({ appState: {
        zoom: { value: command === 'zoom_in' ? Math.min(current * 1.1, 30) : Math.max(current * 0.9, 0.1) },
      } })
      return
    }
    case 'reset_zoom': {
      if (!globalExcalidrawAPI) return
      const elements = globalExcalidrawAPI.getSceneElements()
      if (elements.length) globalExcalidrawAPI.scrollToContent(elements, { fitToContent: true })
      else globalExcalidrawAPI.updateScene({ appState: { zoom: { value: 1 }, scrollX: 0, scrollY: 0 } })
      return
    }
    case 'fullscreen': {
      const window = getCurrentWindow()
      await window.setFullscreen(!await window.isFullscreen())
      const api = globalExcalidrawAPI
      setTimeout(() => { if (api === globalExcalidrawAPI) api?.refresh() }, 300)
      return
    }
    case 'minimize': await getCurrentWindow().minimize(); return
    case 'keyboard_shortcuts':
      alert(`Keyboard Shortcuts:

File:
  Open Directory: Cmd/Ctrl+O
  New File: Cmd/Ctrl+N
  New Folder: Cmd/Ctrl+Shift+N
  Save: Cmd/Ctrl+S
  Save As: Cmd/Ctrl+Shift+S
  Quit: Cmd/Ctrl+Q

View:
  Toggle Sidebar: Cmd/Ctrl+B
  Zoom: Cmd/Ctrl++ / Cmd/Ctrl+-
  Reset Zoom: Cmd/Ctrl+0
  Fullscreen: F11 (Ctrl+Cmd+F on Mac)
  Presentation Mode: F5 (Escape to exit)
  Window Decorations: Cmd/Ctrl+Shift+D

Tabs:
  Close Tab: Cmd/Ctrl+W
  Switch Tabs: Cmd/Ctrl+Tab / Cmd/Ctrl+Shift+Tab

Editing shortcuts are handled by Excalidraw.`)
      return
    default:
      if (/^recent_dir_\d+$/.test(command) && data && typeof data === 'object' &&
        'directory' in data && typeof data.directory === 'string') await state.loadDirectory(data.directory)
  }
}

export function useMenuHandler() {
  useEffect(() => {
    let disposed = false
    let cleanup: (() => void) | undefined
    void listen<MenuCommand>('menu-command', event => executeMenuCommand(event.payload.command, event.payload.data))
      .then(off => { if (disposed) off(); else cleanup = off })
    return () => { disposed = true; cleanup?.() }
  }, [])
}
