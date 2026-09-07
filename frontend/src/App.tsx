import { Sidebar } from './components/Sidebar'
import { ExcalidrawEditor } from './components/ExcalidrawEditor'
import { TabBar } from './components/TabBar'
import { LaserPointer } from './components/LaserPointer'
import { useStore } from './store/useStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMenuHandler } from './hooks/useMenuHandler'
import { useAppLifecycle } from './hooks/useAppLifecycle'
import { useTheme } from './hooks/useTheme'
import { useEffect } from 'react'
import { PanelLeft } from 'lucide-react'
import { ShellSettings } from './components/ShellSettings'
import { DocumentModeButton } from './components/DocumentModeButton'
import { useTranslation } from './hooks/useTranslation'
import './index.css'

function App() {
  const { sidebarVisible, presentationMode, preferences, toggleSidebar } = useStore()
  const t = useTranslation()
  useAppLifecycle()
  useKeyboardShortcuts()
  useMenuHandler()
  useTheme()
  useEffect(() => { document.documentElement.lang = preferences.language === 'zh' ? 'zh-CN' : 'en' }, [preferences.language])

  return (
    <div className={`app-shell h-screen flex overflow-hidden ${presentationMode ? 'cursor-none' : ''}`}>
      {sidebarVisible && !presentationMode && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        {presentationMode ? <TabBar /> : (
          <div className="shell-toolbar">
            <button type="button" className="shell-toolbar-button" onClick={toggleSidebar}
              title={t('Toggle Sidebar')} aria-label={t('Toggle Sidebar')} aria-pressed={sidebarVisible}>
              <PanelLeft size={16} aria-hidden="true" />
            </button>
            <div className="shell-tabs"><TabBar /></div>
            <DocumentModeButton />
            <ShellSettings />
          </div>
        )}
        <ExcalidrawEditor />
      </div>
      {presentationMode && <LaserPointer />}
    </div>
  )
}

export default App
