import { t } from './useTranslation'
import { useEffect } from 'react'
import { listen, invoke, getCurrentWindow } from '../lib/backend'
import { createEditorKey, useStore } from '../store/useStore'
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
        title: folder ? t('Folder name') : t('File name'),
        defaultValue: folder ? t('New Folder') : t('Untitled.excalidraw'), confirmLabel: t('Create'),
      })
      if (name) {
        if (folder) await useStore.getState().createNewFolder(name)
        else await useStore.getState().createNewFile(name)
      }
      return
    }
    case 'save': await state.saveCurrentFile(); return
    case 'save_as': {
      if (state.savingBeforeReadOnly || state.fileMutationPath) return
      if (!state.activeFile || !state.fileContent) return
      if (state.readOnly) {
        alert(t('Switch to edit mode before saving a drawing.'))
        return
      }
      const original = state.activeFile
      const path = await invoke<string | null>('save_file_as', { content: state.fileContent })
      if (!path) return
      const saved = await invoke<{ content: string; content_hash: string }>('read_file_with_hash', { filePath: path })
      const scene = JSON.parse(saved.content)
      const tab = {
        editorKey: createEditorKey(),
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
        activeFile: tab, fileContent: saved.content, isDirty: false, activeFileLoadSource: 'disk', readOnly: true,
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
      await state.savePreferences({ recentDirectories: [] })
      return
    case 'toggle_sidebar': state.toggleSidebar(); return
    case 'presentation': state.togglePresentationMode(); return
    case 'exit_presentation': if (state.presentationMode) state.togglePresentationMode(); return
    case 'toggle_decorations': state.toggleDecorations(); return
    case 'theme':
      if (data === 'light' || data === 'dark' || data === 'system') {
        await state.updateAppearance({ theme: data })
      }
      return
    case 'language':
      if (data === 'en' || data === 'zh') await state.updateAppearance({ language: data })
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
      alert([
        t('Keyboard Shortcuts'), '',
        t('Open Directory') + ': Cmd/Ctrl+O',
        t('New File') + ': Cmd/Ctrl+N',
        t('New Folder') + ': Cmd/Ctrl+Shift+N',
        t('Save') + ': Cmd/Ctrl+S',
        t('Save As...') + ': Cmd/Ctrl+Shift+S',
        t('Quit') + ': Cmd/Ctrl+Q', '',
        t('Toggle Sidebar') + ': Cmd/Ctrl+B',
        t('Zoom In') + ' / ' + t('Zoom Out') + ': Cmd/Ctrl++ / Cmd/Ctrl+-',
        t('Reset Zoom') + ': Cmd/Ctrl+0',
        t('Toggle Fullscreen') + ': F11 / Ctrl+Cmd+F (Mac)',
        t('Presentation Mode') + ': F5', t('Exit presentation: Escape'),
        t('Toggle Window Decorations') + ': Cmd/Ctrl+Shift+D', '',
        t('Close Tab') + ': Cmd/Ctrl+W', t('Switch Tabs: Cmd/Ctrl+Tab / Cmd/Ctrl+Shift+Tab'), '',
        t('Editing shortcuts are handled by Excalidraw.'),
      ].join('\n'))
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
