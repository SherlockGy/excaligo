import { useEffect, useState } from 'react'
import { invoke, listen } from '../lib/backend'
import { useStore } from '../store/useStore'
import type { OpenTab } from '../types'
import { TIMING } from '../constants'

type Store = ReturnType<typeof useStore.getState>
export interface ReloadNotice { path: string; name: string; kind: 'reloaded' | 'unavailable'; count: number }

function canReload(state: Store, tab: OpenTab) {
  return state.pendingFileLoad === null && state.activeFile?.path === tab.path && state.readOnly && !state.isDirty && !tab.modified
}

// Mounted once by the shell. Notifications never participate in the I/O queue.
// Only the active clean read-only canvas reloads; conflicts merely track the
// latest disk version until the user chooses how to resolve them.
export function useExternalFileSync() {
  const [notice, setNotice] = useState<ReloadNotice | null>(null)
  useEffect(() => {
    let disposed = false
    let epoch = 0
    let running = false
    let again = false
    const failed = new Set<string>()
    const refresh = async () => {
      if (disposed) return
      if (running) { again = true; return }
      running = true
      try {
        do {
          again = false
          const state = useStore.getState()
          if (disposed || state.fileMutationPath || state.savingBeforeReadOnly) return
          const generation = epoch
          for (const tab of state.openTabs.filter(tab => canReload(state, tab) || tab.externalConflict)) {
            const logPrefix = `[useExternalFileSync 同步外部绘图][filePath=${tab.path}]`
            const isCurrent = () => {
              const current = useStore.getState()
              const latest = current.openTabs.find(item => item.path === tab.path)
              return !disposed && generation === epoch && !current.fileMutationPath && !current.savingBeforeReadOnly &&
                latest?.editorKey === tab.editorKey && latest?.sceneVersion === tab.sceneVersion &&
                latest?.cachedContent === tab.cachedContent && latest?.contentHash === tab.contentHash &&
                (tab.externalConflict ? !!latest?.externalConflict : !!latest && canReload(current, latest))
            }
            try {
              const hash = await invoke<string>('hash_file_content', { filePath: tab.path })
              if (!isCurrent()) continue
              if (tab.externalConflict) {
                if (hash !== tab.externalConflict.contentHash) {
                  useStore.setState(current => ({ openTabs: current.openTabs.map(item => item.path === tab.path
                    ? { ...item, externalConflict: { contentHash: hash } } : item) }))
                }
                failed.delete(tab.path)
                continue
              }
              if (hash !== tab.contentHash) {
                const result = await invoke<{ content: string; content_hash: string }>('read_file_with_hash', { filePath: tab.path })
                if (!isCurrent()) continue
                if (result.content_hash !== tab.contentHash) {
                  const data = JSON.parse(result.content)
                  const updated: OpenTab = { ...tab, cachedContent: result.content, contentHash: result.content_hash,
                    cachedScene: { elements: data.elements, appState: data.appState || {}, files: data.files || {} },
                    sceneVersion: tab.sceneVersion + 1 }
                  useStore.setState(current => ({ fileContent: result.content, activeFileLoadSource: 'disk',
                    openTabs: current.openTabs.map(item => item.path === tab.path ? updated : item) }))
                  setNotice(previous => ({ path: tab.path, name: tab.name, kind: 'reloaded',
                    count: previous?.path === tab.path && previous.kind === 'reloaded' ? previous.count + 1 : 1 }))
                  console.debug(logPrefix, 'reloaded external version')
                }
              }
              failed.delete(tab.path)
              setNotice(previous => previous?.path === tab.path && previous.kind === 'unavailable' ? null : previous)
            } catch (error) {
              if (!isCurrent()) continue
              if (tab.externalConflict) {
                useStore.setState(current => ({ openTabs: current.openTabs.map(item => item.path === tab.path
                  ? { ...item, externalConflict: { contentHash: null } } : item) }))
              } else if (!failed.has(tab.path)) {
                setNotice({ path: tab.path, name: tab.name, kind: 'unavailable', count: 0 })
              }
              if (!failed.has(tab.path)) console.warn(logPrefix, error)
              failed.add(tab.path)
            }
          }
        } while (again && !disposed)
      } finally { running = false }
    }
    const unsubscribe = useStore.subscribe((state, previous) => {
      // Invalidate reads even for a quick edit -> read-only or A -> B -> A
      // transition that React might otherwise batch into a single render.
      if (state.activeFile?.path !== previous.activeFile?.path || state.readOnly !== previous.readOnly ||
        state.openTabs.find(tab => tab.path === state.activeFile?.path)?.editorKey !==
          previous.openTabs.find(tab => tab.path === previous.activeFile?.path)?.editorKey ||
        state.isDirty !== previous.isDirty || state.fileMutationPath !== previous.fileMutationPath ||
        state.pendingFileLoad !== previous.pendingFileLoad ||
        state.savingBeforeReadOnly !== previous.savingBeforeReadOnly || state.currentDirectory !== previous.currentDirectory) {
        epoch++
        failed.clear()
        setNotice(null)
        void refresh()
      }
    })
    const listener = listen('file-system-change', refresh)
    // Also covers files opened outside the watched directory and missed or
    // continuously debounced filesystem events. Unchanged hashes transfer no scene.
    const timer = setInterval(() => void refresh(), TIMING.EXTERNAL_FILE_CHECK_INTERVAL)
    window.addEventListener('focus', refresh)
    void refresh()
    return () => {
      disposed = true
      unsubscribe()
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      void listener.then(off => off())
    }
  }, [])
  return { notice, dismiss: () => setNotice(null) }
}
