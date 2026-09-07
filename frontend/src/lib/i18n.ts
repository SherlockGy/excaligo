import en from '../../../internal/localization/locales/en.json'
import zh from '../../../internal/localization/locales/zh.json'

export type Language = 'en' | 'zh'
export type MessageKey = keyof typeof en
export type Parameters = Record<string, string | number>
export const catalogs: Record<Language, Record<MessageKey, string>> = { en, zh }

export function translate(language: Language, key: MessageKey, parameters: Parameters = {}): string {
  return catalogs[language][key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder)
}
