import { expect, it } from 'vitest'
import { keyboardCommand } from './useKeyboardShortcuts'

it('supports lower- and upper-case macOS decoration shortcuts', () => {
  for (const key of ['d', 'D']) {
    expect(keyboardCommand({ key, metaKey: true, ctrlKey: false, shiftKey: true }, true)).toBe('toggle_decorations')
  }
})

it('preserves native clipboard and editor shortcuts', () => {
  for (const key of ['c', 'v', 'x', 'a', 'z', 'd']) {
    expect(keyboardCommand({ key, metaKey: true, ctrlKey: false, shiftKey: false }, true)).toBeNull()
  }
})

it('distinguishes save from save-as, and tab close from window close', () => {
  expect(keyboardCommand({ key: 'S', metaKey: false, ctrlKey: true, shiftKey: true }, false)).toBe('save_as')
  expect(keyboardCommand({ key: 'w', metaKey: true, ctrlKey: false, shiftKey: false }, true)).toBe('close_tab')
  expect(keyboardCommand({ key: 'w', metaKey: true, ctrlKey: false, shiftKey: true }, true)).toBe('close_window')
})
