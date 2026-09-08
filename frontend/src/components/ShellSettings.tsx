import { useEffect, useId, useRef } from 'react'
import { Monitor, Moon, Settings, Sun } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useTranslation } from '../hooks/useTranslation'
import { EXCALIDRAW_VERSION } from '../lib/version'

export function ShellSettings() {
  const t = useTranslation()
  const { theme, language, readOnlyWheelZoom } = useStore(state => state.preferences)
  const updateAppearance = useStore(state => state.updateAppearance)
  const setReadOnlyWheelZoom = useStore(state => state.setReadOnlyWheelZoom)
  const wheelZoomDescription = useId()
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
        <label className="wheel-zoom-setting">
          <span>{t('Wheel zoom in read-only mode')}</span>
          <input type="checkbox" role="switch" checked={readOnlyWheelZoom}
            aria-describedby={wheelZoomDescription}
            onChange={event => void setReadOnlyWheelZoom(event.target.checked)} />
        </label>
        <p id={wheelZoomDescription} className="sidebar-muted">
          {t('Scroll to zoom, left-drag to pan. Only in read-only mode; drawing files stay unchanged.')}
        </p>
        <dl className="engine-version">
          <dt>{t('Excalidraw version')}</dt>
          <dd>{EXCALIDRAW_VERSION}</dd>
        </dl>
      </section>
    </details>
  )
}
