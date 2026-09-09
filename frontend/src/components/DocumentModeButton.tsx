import { Eye, Pencil } from 'lucide-react'
import { useStore } from '../store/useStore'
import { useTranslation } from '../hooks/useTranslation'

export function DocumentModeButton() {
  const t = useTranslation()
  const activeFile = useStore(state => state.activeFile)
  const readOnly = useStore(state => state.readOnly)
  const saving = useStore(state => state.savingBeforeReadOnly)
  const fileMutation = useStore(state => state.fileMutationPath !== null)
  const toggleReadOnly = useStore(state => state.toggleReadOnly)
  const conflict = useStore(state => state.openTabs.find(tab => tab.path === state.activeFile?.path)?.externalConflict)
  const label = conflict ? t('Save conflict') : saving ? t('Saving...') : readOnly ? t('Read-only') : t('Editing')
  const action = conflict ? t('Review save conflict') : readOnly ? t('Switch to edit mode') : t('Save and switch to read-only')
  const Icon = readOnly ? Eye : Pencil

  return (
    <button type="button" className="shell-toolbar-button document-mode-button"
      disabled={!activeFile || saving || fileMutation} aria-label={`${label}: ${action}`}
      title={action} aria-busy={saving || fileMutation} data-editing={!readOnly}
      onClick={() => void toggleReadOnly()}>
      <Icon size={15} aria-hidden="true" />
      <span aria-live="polite">{label}</span>
    </button>
  )
}
