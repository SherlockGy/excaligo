import { useTranslation } from '../hooks/useTranslation'

export function UnsavedIndicator() {
  const t = useTranslation()
  const label = t('Unsaved Changes')

  return <span className="modified-dot" role="img" aria-label={label} title={label} />
}
