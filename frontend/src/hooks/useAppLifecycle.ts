import { useEffect, useRef } from 'react'
import { ask, invoke, listen } from '../lib/backend'
import { TIMING } from '../constants'
import { useStore } from '../store/useStore'

export function useAppLifecycle() {
  const initialization = useRef<Promise<void> | null>(null)
  useEffect(() => {
    const logPrefix = '[useAppLifecycle 管理应用生命周期][app=excaligo]'
    let disposed = false
    let closing = false
    let refreshing = false
    let refreshAgain = false
    initialization.current ??= useStore.getState().loadPreferences()

    const openPending = async () => {
      await initialization.current
      if (disposed) return
      const paths = await invoke<string[]>('pending_open_files')
      for (const path of paths || []) {
        const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
        if (useStore.getState().currentDirectory !== dir) await useStore.getState().loadDirectory(dir)
        if (useStore.getState().currentDirectory !== dir) return
        await useStore.getState().loadFile({ name: path.split(/[\\/]/).pop() || path, path, modified: false })
      }
    }

    const refresh = async () => {
      if (refreshing) { refreshAgain = true; return }
      refreshing = true
      try {
        do {
          refreshAgain = false
          const directory = useStore.getState().currentDirectory
          if (!directory) return
          await useStore.getState().loadFileTree(directory)
          const state = useStore.getState()
          if (state.currentDirectory !== directory) return
          const paths = new Set(state.files.map(file => file.path))
          // An external deletion must not discard an unsaved canvas.
          const missingInWorkspace = (path: string) =>
            (path.startsWith(`${directory.replace(/[\\/]+$/, '')}/`) ||
              path.startsWith(`${directory.replace(/[\\/]+$/, '')}\\`)) && !paths.has(path)
          const missing = state.activeFile && missingInWorkspace(state.activeFile.path)
          useStore.setState({
            openTabs: state.openTabs.filter(tab => !missingInWorkspace(tab.path) || tab.modified),
            ...(missing && !state.isDirty ? { activeFile: null, fileContent: null, activeFileLoadSource: null } : {}),
          })
        } while (refreshAgain && !disposed)
      } finally { refreshing = false }
    }

    const close = async () => {
      if (closing) return
      closing = true
      try {
        const state = useStore.getState()
        if (state.isDirty) {
          const save = await ask('Do you want to save your changes before closing?', {
            title: 'Unsaved Changes', kind: 'warning', okLabel: 'Save & Close', cancelLabel: "Don't Save",
          })
          if (save) {
            await state.saveCurrentFile()
            if (useStore.getState().isDirty) return
          } else if (!await ask('Close without saving your changes?', {
            title: 'Confirm Close', kind: 'warning', okLabel: 'Close Without Saving', cancelLabel: 'Cancel',
          })) return
        }
        await invoke('force_close_app')
      } catch (error) { console.error(logPrefix, error) }
      finally { closing = false; await invoke('cancel_close').catch(() => {}) }
    }

    const listeners = [
      listen('file-system-change', refresh),
      listen('check-unsaved-before-close', close),
      listen('open-files', openPending),
    ]
    void openPending().catch(error => console.error(logPrefix, error))
    const timer = setInterval(() => {
      const state = useStore.getState()
      if (state.isDirty && !closing) void state.saveCurrentFile().catch(error => console.error(logPrefix, error))
    }, TIMING.AUTO_SAVE_INTERVAL)
    return () => {
      disposed = true
      clearInterval(timer)
      for (const listener of listeners) void listener.then(off => off())
    }
  }, [])
}
