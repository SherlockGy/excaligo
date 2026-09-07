import '@testing-library/jest-dom'
import { vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), ask: vi.fn(), message: vi.fn(),
}))

vi.mock('../lib/backend', () => ({
  ...mocks,
  getCurrentWindow: () => ({
    close: vi.fn(), minimize: vi.fn(), isFullscreen: vi.fn().mockResolvedValue(false), setFullscreen: vi.fn(),
  }),
}))

Object.defineProperty(window, 'matchMedia', { writable: true, value: vi.fn(() => ({
  matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
})) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoke.mockReset()
  mocks.ask.mockReset()
  mocks.listen.mockResolvedValue(vi.fn())
  vi.spyOn(window, 'alert').mockImplementation(() => {})
})

export const { invoke: mockInvoke, listen: mockListen, ask: mockAsk } = mocks
