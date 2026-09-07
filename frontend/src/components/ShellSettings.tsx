import { useEffect, useRef } from 'react'
import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useTranslation } from '../hooks/useTranslation'

export function ShellSettings() {
  const t = useTranslation()
  const { theme, language } = useStore(state => state.preferences)
  const updateAppearance = useStore(state => state.updateAppearance)
  const details = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && details.current?.open) {
        details.current.open = false
        details.current.querySelector('summary')?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [])

  return (
    <details ref={details} className="shell-settings">
      <summary title={t('Settings')} aria-label={t('Settings')}>
        <Settings size={16} aria-hidden="true" />
      </summary>
      <section className="shell-settings-panel" aria-label={t('Settings')}>
        <fieldset>
          <legend>{t('Theme')}</legend>
          <div className="theme-options">
            {([
              ['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor],
            ] as const).map(([value, label, Icon]) => (
              <button key={value} type="button" aria-pressed={theme === value}
                onClick={() => void updateAppearance({ theme: value })}>
                <Icon size={16} aria-hidden="true" />{t(label)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="language-setting">
          <span>{t('App language')}</span>
          <select value={language} onChange={event => {
            const value = event.target.value
            if (value === 'en' || value === 'zh') void updateAppearance({ language: value })
          }}>
            <option value="zh" lang="zh-CN">中文</option>
            <option value="en" lang="en">English</option>
          </select>
        </label>
        <p className="sidebar-muted">{t('Editor language is unchanged.')}</p>
      </section>
    </details>
  )
}
