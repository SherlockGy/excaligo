import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'

export function useTheme(): 'light' | 'dark' {
  const preference = useStore(state => state.preferences.theme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const change = () => setSystemDark(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const theme = preference === 'system' ? systemDark ? 'dark' : 'light' : preference
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark') }, [theme])
  return theme
}
