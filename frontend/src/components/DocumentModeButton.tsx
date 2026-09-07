import { Eye, Pencil } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useTranslation } from '../hooks/useTranslation'

export function DocumentModeButton() {
  const t = useTranslation()
  const activeFile = useStore(state => state.activeFile)
  const readOnly = useStore(state => state.readOnly)
  const saving = useStore(state => state.savingBeforeReadOnly)
  const toggleReadOnly = useStore(state => state.toggleReadOnly)
  const label = saving ? t('Saving...') : readOnly ? t('Read-only') : t('Editing')
  const action = readOnly ? t('Switch to edit mode') : t('Save and switch to read-only')
  const Icon = readOnly ? Eye : Pencil

  return (
    <button type="button" className="shell-toolbar-button document-mode-button"
      disabled={!activeFile || saving} aria-label={`${label}: ${action}`}
      title={action} aria-busy={saving} data-editing={!readOnly}
      onClick={() => void toggleReadOnly()}>
      <Icon size={15} aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
  )
}
