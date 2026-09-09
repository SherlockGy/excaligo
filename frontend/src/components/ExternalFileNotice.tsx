import { AlertTriangle, RefreshCw, X } from 'lucide-react'
import { useRef } from 'react'
import { useStore } from '../store/useStore'
import { useTranslation } from '../hooks/useTranslation'
import { useExternalFileSync } from '../hooks/useExternalFileSync'
import type { OpenTab } from '../types'

function ConflictNotice({ tab }: { tab: OpenTab }) {
  const t = useTranslation()
  const busy = useStore(state => !!state.fileMutationPath || state.savingBeforeReadOnly)
  const resolve = useStore(state => state.resolveFileConflict)
  const hash = tab.externalConflict!.contentHash
  const firstHash = useRef(hash)
  return (
    <aside className="external-file-notice" data-warning="true" aria-label={t('Save conflict')}>
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="external-notice-content">
        <div role="status" aria-live="polite" aria-atomic="true">
          <strong title={tab.path}>{tab.name}</strong>
          <p>{t('Saving paused because the file changed externally. Your unsaved edits are still here.')}</p>
          {hash === null ? <p>{t('The external file is unavailable. Waiting for it to become readable.')}</p>
            : hash !== firstHash.current && <p>{t('The external version changed again. Please review your choice.')}</p>}
        </div>
        <p className="external-notice-detail">{t('Reload discards local edits. Overwrite replaces the external file with your edits.')}</p>
        <div className="external-notice-actions">
          <button type="button" disabled={busy || hash === null} onClick={() => void resolve(tab.path, 'reload', hash)}>
            {t('Reload external version')}
          </button>
          <button type="button" disabled={busy || hash === null} onClick={() => void resolve(tab.path, 'overwrite', hash)}>
            {t('Overwrite with local edits')}
          </button>
        </div>
      </div>
      <button type="button" className="external-notice-close" disabled={busy} aria-label={t('Dismiss notification')}
        title={t('Dismiss notification')} onClick={() => useStore.setState({ fileConflictPath: null })}>
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  )
}

export function ExternalFileNotice() {
  const { notice, dismiss } = useExternalFileSync()
  const t = useTranslation()
  const conflict = useStore(state => state.openTabs.find(tab => tab.path === state.fileConflictPath && tab.externalConflict))
  if (conflict) return <ConflictNotice key={conflict.editorKey ?? conflict.path} tab={conflict} />
  if (!notice) return null
  const warning = notice.kind === 'unavailable'
  const Icon = warning ? AlertTriangle : RefreshCw
  return (
    <aside className="external-file-notice" data-warning={warning} aria-label={t('External file update')}>
      <Icon size={18} aria-hidden="true" />
      <div className="external-notice-content" role="status" aria-live="polite" aria-atomic="true">
        <strong title={notice.path}>{notice.name}</strong>
        <p>{t(warning ? 'Cannot reload the external file. Keeping the current view and retrying automatically.'
          : 'External changes reloaded. Your view position is preserved.')}</p>
        {notice.count > 1 && <p className="external-notice-detail">{t('Reloaded {count} times', { count: notice.count })}</p>}
      </div>
      <button type="button" className="external-notice-close" aria-label={t('Dismiss notification')}
        title={t('Dismiss notification')} onClick={dismiss}><X size={16} aria-hidden="true" /></button>
    </aside>
  )
}
