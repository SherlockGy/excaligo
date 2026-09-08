import { useTranslation } from '../hooks/useTranslation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { AppState as ExcalidrawAppState, BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types'
import { useStore } from '../store/useStore'
import { setGlobalExcalidrawAPI } from '../hooks/useMenuHandler'
import { TIMING } from '../constants'
import type { OpenTab } from '../types'
import { useTheme } from '../hooks/useTheme'
import { sceneFingerprint, serializeScene } from '../lib/scene'
import { useReadOnlyWheelZoom } from '../hooks/useReadOnlyWheelZoom'

type ExcalidrawElement = Parameters<NonNullable<ExcalidrawProps['onChange']>>[0][number]

interface EditorPaneProps {
  tab: OpenTab
  isActive: boolean
  presentationMode: boolean
  readOnly: boolean
  theme: 'light' | 'dark'
}

function EditorPane({ tab, isActive, presentationMode, readOnly, theme }: EditorPaneProps) {
  const t = useTranslation()
  const [isReady, setIsReady] = useState(false)
  const excalidrawAPIRef = useRef<ExcalidrawImperativeAPI | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wheelZoom = useStore(state => state.preferences.readOnlyWheelZoom)
  const initialLoadCompleteRef = useRef(false)
  const isUserChangeRef = useRef(false)
  const lastSavedElementsRef = useRef(sceneFingerprint(tab.cachedScene))
  const hasCenteredInitialContentRef = useRef(false)
  const centerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const centerChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useReadOnlyWheelZoom(containerRef, excalidrawAPIRef, tab.path,
    isReady && isActive && readOnly && !presentationMode && wheelZoom)

  const initialData = useMemo(() => ({
    elements: tab.cachedScene.elements,
    appState: tab.cachedScene.appState,
    files: tab.cachedScene.files,
  }), [])

  const enableChangeTracking = useCallback(() => {
    initialLoadCompleteRef.current = true
    isUserChangeRef.current = true
    setIsReady(true)
  }, [])

  const clearCenterTimers = useCallback(() => {
    if (centerTimerRef.current) {
      clearTimeout(centerTimerRef.current)
      centerTimerRef.current = null
    }
    if (centerChangeTimerRef.current) {
      clearTimeout(centerChangeTimerRef.current)
      centerChangeTimerRef.current = null
    }
  }, [])

  const centerInitialContent = useCallback((api = excalidrawAPIRef.current) => {
    if (!isActive || !api || hasCenteredInitialContentRef.current) {
      return
    }

    const elements = tab.cachedScene.elements || []
    if (elements.length === 0) {
      hasCenteredInitialContentRef.current = true
      enableChangeTracking()
      return
    }

    hasCenteredInitialContentRef.current = true
    isUserChangeRef.current = false
    initialLoadCompleteRef.current = false
    clearCenterTimers()

    centerTimerRef.current = setTimeout(() => {
      api.scrollToContent(elements, {
        fitToContent: true,
      })
      api.refresh?.()

      centerChangeTimerRef.current = setTimeout(() => {
        centerChangeTimerRef.current = null
        enableChangeTracking()
      }, TIMING.USER_CHANGE_ENABLE_DELAY)
    }, TIMING.FILE_LOAD_DELAY)
  }, [
    clearCenterTimers,
    enableChangeTracking,
    isActive,
    tab.cachedScene.elements,
  ])

  useEffect(() => {
    centerInitialContent()
  }, [centerInitialContent])

  useEffect(() => {
    if (isActive && excalidrawAPIRef.current) {
      setGlobalExcalidrawAPI(excalidrawAPIRef.current)
    }
  }, [isActive])

  useEffect(() => {
    return () => {
      clearCenterTimers()
    }
  }, [clearCenterTimers])

  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prevState) => {
      const wasSaved =
        prevState.activeFile?.path === tab.path &&
        state.activeFile?.path === tab.path &&
        prevState.isDirty &&
        !state.isDirty

      if (wasSaved && state.fileContent) {
        try {
          const data = JSON.parse(state.fileContent)
          lastSavedElementsRef.current = sceneFingerprint({ elements: data.elements || [], appState: data.appState || {}, files: data.files || {} })
        } catch {
          // Ignore parse errors.
        }
      }
    })

    return unsubscribe
  }, [tab.path])

  const handleChange = useCallback((
    elements: readonly ExcalidrawElement[],
    appState: ExcalidrawAppState,
    files: BinaryFiles
  ) => {
    const store = useStore.getState()
    if (!isActive || store.activeFile?.path !== tab.path || store.readOnly || store.presentationMode ||
      !isUserChangeRef.current || !initialLoadCompleteRef.current) {
      lastSavedElementsRef.current = sceneFingerprint({ elements, appState, files })
      return
    }

    const currentElements = sceneFingerprint({ elements, appState, files })

    if (currentElements === lastSavedElementsRef.current) {
      return
    }

    lastSavedElementsRef.current = currentElements

    store.updateTabScene(tab.path, { elements, appState, files })

    if (!store.isDirty) {
      store.setIsDirty(true)
      store.markFileAsModified(tab.path, true)
      store.markTreeNodeAsModified(tab.path, true)
    }

    const newContent = serializeScene(store.fileContent || tab.cachedContent, { elements, appState, files })

    const freshStore = useStore.getState()
    if (freshStore.activeFile?.path === tab.path) {
      freshStore.setFileContent(newContent)
    }
  }, [isActive, tab.path])

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 h-full ${isActive ? 'visible z-10' : 'invisible z-0 pointer-events-none'}`}
      aria-hidden={!isActive}
    >
      <Excalidraw
        initialData={initialData}
        excalidrawAPI={(api) => {
          excalidrawAPIRef.current = api
          if (isActive) {
            setGlobalExcalidrawAPI(api)
            centerInitialContent(api)
          }
        }}
        onChange={handleChange}
        theme={theme}
        viewModeEnabled={!isActive || readOnly || presentationMode}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            saveAsImage: true,
            export: {
              saveFileToDisk: true,
            },
          },
        }}
      />
      {!isReady && isActive && (
        <div className="editor-loading absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-3">
            <div className="editor-spinner h-5 w-5 animate-spin rounded-full border-2" />
            <span className="text-sm">{t('Loading canvas...')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function ExcalidrawEditor() {
  const t = useTranslation()
  const activeFile = useStore(state => state.activeFile)
  const openTabs = useStore(state => state.openTabs)
  const presentationMode = useStore(state => state.presentationMode)
  const readOnly = useStore(state => state.readOnly || state.savingBeforeReadOnly || state.fileMutationPath !== null)
  const theme = useTheme()

  if (!activeFile) {
    return (
      <div className="editor-empty fixed inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <p className="text-lg mb-2">{t('No file selected')}</p>
          <p className="text-sm">{t('Select a file from the sidebar to view')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 relative">
      {openTabs.map((tab) => (
        <EditorPane
          key={`${tab.editorKey ?? tab.path}:${tab.sceneVersion}`}
          tab={tab}
          isActive={activeFile.path === tab.path}
          presentationMode={presentationMode}
          readOnly={readOnly}
          theme={theme}
        />
      ))}
    </div>
  )
}
