import { t } from './useTranslation'
import { useEffect, useRef } from 'react'
import { ask, invoke, listen } from '../lib/backend'
import { TIMING } from '../constants'
import { openDocumentsUnchanged, useStore } from '../store/useStore'
import { parentDirectory } from '../lib/fileMove'

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
        const dir = parentDirectory(path)
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
          if (useStore.getState().fileMutationPath) return
          const directory = useStore.getState().currentDirectory
          if (!directory) return
          await useStore.getState().loadFileTree(directory)
          const state = useStore.getState()
          if (state.currentDirectory !== directory || state.fileMutationPath) return
          const paths = new Set(state.files.map(file => file.path))
          // An external deletion must not discard an unsaved canvas.
          const missingInWorkspace = (path: string) =>
            (path.startsWith(`${directory.replace(/[\\/]+$/, '')}/`) ||
              path.startsWith(`${directory.replace(/[\\/]+$/, '')}\\`)) && !paths.has(path)
          const missing = state.activeFile && missingInWorkspace(state.activeFile.path)
          useStore.setState({
            // Read-only reload keeps the last valid scene through a transient
            // remove/recreate save and reports an unavailable external file.
            openTabs: state.openTabs.filter(tab => !missingInWorkspace(tab.path) || tab.modified ||
              (state.readOnly && tab.path === state.activeFile?.path)),
            ...(missing && !state.isDirty && !state.readOnly ? { activeFile: null, fileContent: null, activeFileLoadSource: null } : {}),
          })
        } while (refreshAgain && !disposed)
      } finally { refreshing = false }
    }

    const close = async () => {
      if (closing) return
      closing = true
      try {
        const state = useStore.getState()
        const isCurrent = () => openDocumentsUnchanged(state) && !useStore.getState().fileMutationPath &&
          !useStore.getState().savingBeforeReadOnly
        if (!isCurrent()) return
        if (state.isDirty || state.openTabs.some(tab => tab.modified)) {
          const save = await ask(t('Do you want to save your changes before closing?'), {
            title: t('Unsaved Changes'), kind: 'warning', okLabel: t('Save & Close'), cancelLabel: t("Don't Save"),
          })
          if (!isCurrent()) return
          if (save) {
            if (state.isDirty) await state.saveCurrentFile()
            for (const tab of state.openTabs.filter(tab => tab.modified && tab.path !== state.activeFile?.path)) {
              if (!isCurrent()) return
              await state.saveTab(tab.path)
            }
            const latest = useStore.getState()
            if (latest.isDirty || latest.openTabs.some(tab => tab.modified)) return
          } else if (!await ask(t('Close without saving your changes?'), {
            title: t('Confirm Close'), kind: 'warning', okLabel: t('Close Without Saving'), cancelLabel: t('Cancel'),
          })) return
        }
        if (!isCurrent()) return
        await invoke('force_close_app')
      } catch (error) { console.error(logPrefix, error) }
      finally { closing = false; await invoke('cancel_close').catch(() => {}) }
    }

    const listeners = [
      listen('file-system-change', refresh),
      listen('check-unsaved-before-close', close),
      listen('open-files', openPending),
    ]
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (previous.fileMutationPath && !state.fileMutationPath && !disposed) {
        void refresh().catch(error => console.error(logPrefix, error))
      }
    })
    void openPending().catch(error => console.error(logPrefix, error))
    const timer = setInterval(() => {
      const state = useStore.getState()
      if (state.isDirty && !state.readOnly && !state.savingBeforeReadOnly && !state.fileMutationPath && !closing &&
        !state.openTabs.find(tab => tab.path === state.activeFile?.path)?.externalConflict) {
        void state.saveCurrentFile().catch(error => console.error(logPrefix, error))
      }
    }, TIMING.AUTO_SAVE_INTERVAL)
    return () => {
      disposed = true
      clearInterval(timer)
      unsubscribe()
      for (const listener of listeners) void listener.then(off => off())
    }
  }, [])
}
