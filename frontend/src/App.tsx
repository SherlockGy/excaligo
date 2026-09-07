import { Sidebar } from './components/Sidebar'
import { ExcalidrawEditor } from './components/ExcalidrawEditor'
import { TabBar } from './components/TabBar'
import { LaserPointer } from './components/LaserPointer'
import { useStore } from './store/useStore'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useMenuHandler } from './hooks/useMenuHandler'
import { useAppLifecycle } from './hooks/useAppLifecycle'
import { useTheme } from './hooks/useTheme'
import './index.css'

function App() {
  const { sidebarVisible, presentationMode } = useStore()
  useAppLifecycle()
  useKeyboardShortcuts()
  useMenuHandler()
  useTheme()

  return (
    <div className={`app-shell h-screen flex overflow-hidden ${presentationMode ? 'cursor-none' : ''}`}>
      {sidebarVisible && !presentationMode && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0">
        <TabBar />
        <ExcalidrawEditor />
      </div>
      {presentationMode && <LaserPointer />}
    </div>
  )
}

export default App
