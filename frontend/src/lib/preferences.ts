import { Preferences } from '../types'

/**
 * Convert preferences from Go snake_case to TypeScript camelCase
 */
export function convertPreferencesFromBackend(backendPrefs: any): Preferences {
  return {
    language: backendPrefs?.language === 'zh' ? 'zh' : 'en',
    readOnlyWheelZoom: (backendPrefs?.read_only_wheel_zoom ?? backendPrefs?.readOnlyWheelZoom) === true,
    lastDirectory: backendPrefs?.last_directory || backendPrefs?.lastDirectory || null,
    recentDirectories: backendPrefs?.recent_directories || backendPrefs?.recentDirectories || [],
    theme: backendPrefs?.theme || 'system',
    sidebarVisible: backendPrefs?.sidebar_visible !== undefined
      ? backendPrefs.sidebar_visible
      : (backendPrefs?.sidebarVisible !== undefined ? backendPrefs.sidebarVisible : true),
    showDecorations: backendPrefs?.show_decorations !== undefined
      ? backendPrefs.show_decorations
      : (backendPrefs?.showDecorations !== undefined ? backendPrefs.showDecorations : true),
  }
}

/**
 * Convert preferences from TypeScript camelCase to Go snake_case
 */
export function convertPreferencesToBackend(tsPrefs: Preferences): any {
  return {
    language: tsPrefs.language,
    read_only_wheel_zoom: tsPrefs.readOnlyWheelZoom === true,
    last_directory: tsPrefs.lastDirectory || null,
    recent_directories: tsPrefs.recentDirectories || [],
    theme: tsPrefs.theme || 'system',
    sidebar_visible: tsPrefs.sidebarVisible !== undefined ? tsPrefs.sidebarVisible : true,
    show_decorations: tsPrefs.showDecorations !== undefined ? tsPrefs.showDecorations : true,
  }
}
