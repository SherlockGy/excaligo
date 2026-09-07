import { expect, it } from 'vitest'
import { catalogs, translate, type MessageKey } from './i18n'
import { convertPreferencesFromBackend, convertPreferencesToBackend } from './preferences'

it('has matching nonempty translations and interpolation tokens in both languages', () => {
  expect(Object.keys(catalogs.zh).sort()).toEqual(Object.keys(catalogs.en).sort())
  for (const key of Object.keys(catalogs.en) as MessageKey[]) {
    expect(catalogs.zh[key].trim(), key).not.toBe('')
    expect((catalogs.zh[key].match(/\{\w+\}/g) || []).sort(), key)
      .toEqual((catalogs.en[key].match(/\{\w+\}/g) || []).sort())
  }
})

it('interpolates user file names literally without interpreting replacement syntax or markup', () => {
  expect(translate('zh', 'Actions for {name}', { name: '<img>$&{name}' })).toBe('<img>$&{name} 的操作')
  expect(translate('en', '{count} files', { count: 2 })).toBe('2 files')
})

it('keeps legacy defaults and round trips the language field', () => {
  expect(convertPreferencesFromBackend({ theme: 'dark' }).language).toBe('en')
  expect(convertPreferencesFromBackend({ language: 'fr' }).language).toBe('en')
  const prefs = convertPreferencesFromBackend({ language: 'zh', theme: 'light' })
  expect(convertPreferencesFromBackend(convertPreferencesToBackend(prefs))).toEqual(prefs)
})
