import { useStore } from '../store/useStore'
import { translate, type MessageKey, type Parameters } from '../lib/i18n'

// Imperative callers resolve the current language at call time, not module load.
export function t(key: MessageKey, parameters?: Parameters): string {
  return translate(useStore.getState().preferences.language, key, parameters)
}

export function useTranslation() {
  const language = useStore(state => state.preferences.language)
  return (key: MessageKey, parameters?: Parameters) => translate(language, key, parameters)
}
