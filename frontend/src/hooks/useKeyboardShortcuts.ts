import { useEffect } from 'react'
import { useStore } from '../store/useStore'
import { executeMenuCommand } from './useMenuHandler'

export function keyboardCommand(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>, isMac: boolean): string | null {
  const key = event.key.toLowerCase()
  const mod = isMac ? event.metaKey : event.ctrlKey
  if (event.key === 'F5') return 'presentation'
  if (event.key === 'Escape') return 'exit_presentation'
  if (event.key === 'F11' || (isMac && event.metaKey && event.ctrlKey && key === 'f')) return 'fullscreen'
  if (!mod) return null
  switch (key) {
    case 'n': return event.shiftKey ? 'new_folder' : 'new_file'
    case 'o': return 'open_directory'
    case 's': return event.shiftKey ? 'save_as' : 'save'
    case 'w': return event.shiftKey ? 'close_window' : 'close_tab'
    case 'q': return 'quit'
    case 'b': return 'toggle_sidebar'
    case 'm': return 'minimize'
    case 'd': return event.shiftKey ? 'toggle_decorations' : null
    case '+':
    case '=': return 'zoom_in'
    case '-': return 'zoom_out'
    case '0': return 'reset_zoom'
    case 'tab': return event.shiftKey ? 'previous_tab' : 'next_tab'
    default: return null
  }
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const logPrefix = '[useKeyboardShortcuts 处理键盘快捷键][app=excaligo]'
    const handle = (event: KeyboardEvent) => {
      const command = keyboardCommand(event, /MAC/i.test(navigator.platform))
      if (!command || document.querySelector('.name-prompt-overlay')) return
      const state = useStore.getState()
      // Avoid executing a native accelerator a second time in the WebView.
      if (state.preferences.showDecorations && !state.presentationMode &&
        !['next_tab', 'previous_tab', 'exit_presentation'].includes(command)) return
      event.preventDefault()
      void executeMenuCommand(command).catch(error => console.error(logPrefix, error))
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])
}
