import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './useStore'
import { mockAsk, mockInvoke } from '../test/setup'
import type { OpenTab } from '../types'

const empty = JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} })
const drawing = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'a', x: 1 }], appState: {}, files: {} })
const initial = useStore.getState()
const makeTab = (name: string, content = drawing): OpenTab => ({
  name, path: `/workspace/${name}`, modified: false, cachedContent: content, contentHash: 'old-hash',
  cachedScene: JSON.parse(content), sceneVersion: 0,
})

beforeEach(() => {
  useStore.setState(initial, true)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function activate(tab: OpenTab, dirty = false) {
  useStore.setState({ currentDirectory: '/workspace', activeFile: tab, openTabs: [{ ...tab, modified: dirty }],
    fileContent: tab.cachedContent, isDirty: dirty })
}

describe('saving and unsaved data', () => {
  it('saves a cleared canvas rather than silently skipping it', async () => {
    activate(makeTab('empty.excalidraw', empty), true)
    mockInvoke.mockResolvedValue('new-hash')
    await useStore.getState().saveCurrentFile()
    expect(mockInvoke).toHaveBeenCalledWith('save_file', { filePath: '/workspace/empty.excalidraw', content: empty })
    expect(useStore.getState().isDirty).toBe(false)
    expect(useStore.getState().openTabs[0].contentHash).toBe('new-hash')
  })

  it('propagates write failures and retains the dirty canvas', async () => {
    activate(makeTab('a.excalidraw'), true)
    mockInvoke.mockRejectedValue(new Error('disk full'))
    await expect(useStore.getState().saveCurrentFile()).rejects.toThrow('disk full')
    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().fileContent).toBe(drawing)
  })

  it('does not close a tab after a failed Save decision', async () => {
    const tab = makeTab('a.excalidraw'); activate(tab, true)
    mockAsk.mockResolvedValue(true)
    mockInvoke.mockRejectedValue(new Error('permission denied'))
    await expect(useStore.getState().closeTab(tab.path)).rejects.toThrow('permission denied')
    expect(useStore.getState().openTabs).toHaveLength(1)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('keeps edits made while a save is in progress', async () => {
    const tab = makeTab('a.excalidraw'); activate(tab, true)
    let resolve!: (hash: string) => void
    mockInvoke.mockReturnValue(new Promise<string>(done => { resolve = done }))
    const saving = useStore.getState().saveCurrentFile()
    useStore.getState().setFileContent(empty)
    resolve('saved-hash'); await saving
    expect(useStore.getState().isDirty).toBe(true)
    expect(useStore.getState().openTabs[0].cachedContent).toBe(empty)
  })

  it('serializes overlapping saves and writes the newest content last', async () => {
    activate(makeTab('a.excalidraw'), true)
    let resolve!: (hash: string) => void
    mockInvoke.mockReturnValueOnce(new Promise<string>(done => { resolve = done })).mockResolvedValue('second-hash')
    const first = useStore.getState().saveCurrentFile()
    useStore.getState().setFileContent(empty)
    const second = useStore.getState().saveCurrentFile()
    expect(mockInvoke).toHaveBeenCalledTimes(1)
    resolve('first-hash'); await Promise.all([first, second])
    expect(mockInvoke).toHaveBeenCalledTimes(2)
    expect(useStore.getState().isDirty).toBe(false)
    expect(useStore.getState().openTabs[0].contentHash).toBe('second-hash')
  })

  it('cancels directory switching without destroying open tabs', async () => {
    activate(makeTab('a.excalidraw'), true)
    mockAsk.mockResolvedValue(false)
    await useStore.getState().loadDirectory('/other')
    expect(useStore.getState().currentDirectory).toBe('/workspace')
    expect(useStore.getState().isDirty).toBe(true)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('tab cache and filesystem updates', () => {
  it('ignores an older directory response and watches only the latest directory', async () => {
    let resolve!: (value: unknown[]) => void
    const delayed = new Promise<unknown[]>(done => { resolve = done })
    mockInvoke.mockImplementation(async (_command, args) => args?.directory === '/old' ? delayed : [])
    const old = useStore.getState().loadDirectory('/old')
    expect(await useStore.getState().loadDirectory('/new')).toBe(true)
    resolve([])
    expect(await old).toBe(false)
    expect(useStore.getState().currentDirectory).toBe('/new')
    expect(mockInvoke).not.toHaveBeenCalledWith('watch_directory', { directory: '/old' })
  })

  it('does not clear the canvas if directory watching fails', async () => {
    const tab = makeTab('a.excalidraw'); activate(tab)
    mockInvoke.mockImplementation(async command => {
      if (command === 'watch_directory') throw new Error('watch limit reached')
      return []
    })
    expect(await useStore.getState().loadDirectory('/other')).toBe(false)
    expect(useStore.getState().activeFile).toEqual(tab)
    expect(useStore.getState().currentDirectory).toBe('/workspace')
  })
  it('ignores an older disk read after another tab is selected', async () => {
    activate(makeTab('a.excalidraw'))
    let resolveOlder!: (value: unknown) => void
    mockInvoke.mockReturnValueOnce(new Promise(done => { resolveOlder = done }))
      .mockResolvedValueOnce({ content: empty, content_hash: 'c-hash' })
    const older = useStore.getState().loadFile(makeTab('b.excalidraw'))
    await useStore.getState().loadFile(makeTab('c.excalidraw'))
    resolveOlder({ content: drawing, content_hash: 'b-hash' })
    await older
    expect(useStore.getState().activeFile?.name).toBe('c.excalidraw')
    expect(useStore.getState().fileContent).toBe(empty)
  })
  it('uses a cached scene when the BLAKE3 hash matches', async () => {
    const a = makeTab('a.excalidraw'), b = makeTab('b.excalidraw')
    activate(a); useStore.setState({ openTabs: [a, b] })
    mockInvoke.mockResolvedValue('old-hash')
    await useStore.getState().loadFile(b)
    expect(useStore.getState().activeFileLoadSource).toBe('cache')
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('reloads an externally changed file and invalidates its mounted scene', async () => {
    const a = makeTab('a.excalidraw'), b = makeTab('b.excalidraw')
    activate(a); useStore.setState({ openTabs: [a, b] })
    mockInvoke.mockImplementation(async command => command === 'hash_file_content' ? 'changed' : { content: empty, content_hash: 'changed' })
    await useStore.getState().loadFile(b)
    expect(useStore.getState().activeFileLoadSource).toBe('disk')
    expect(useStore.getState().openTabs[1].sceneVersion).toBe(1)
    expect(useStore.getState().fileContent).toBe(empty)
  })

  it('updates nested tab paths after a folder rename, not sibling prefixes', async () => {
    const a = { ...makeTab('a.excalidraw'), path: '/workspace/folder/a.excalidraw' }
    const b = { ...makeTab('b.excalidraw'), path: '/workspace/folder-other/b.excalidraw' }
    activate(a); useStore.setState({ openTabs: [a, b] })
    mockInvoke.mockImplementation(async command => command === 'rename_folder' ? '/workspace/new' : [])
    await useStore.getState().renameFolder('/workspace/folder', 'new')
    expect(useStore.getState().openTabs.map(tab => tab.path)).toEqual(['/workspace/new/a.excalidraw', b.path])
    expect(useStore.getState().activeFile?.path).toBe('/workspace/new/a.excalidraw')
  })

  it('removes tabs under a deleted folder', async () => {
    const a = { ...makeTab('a.excalidraw'), path: '/workspace/folder/a.excalidraw' }
    activate(a); mockInvoke.mockResolvedValue([])
    await useStore.getState().deleteFolder('/workspace/folder')
    expect(useStore.getState().openTabs).toEqual([])
    expect(useStore.getState().activeFile).toBeNull()
  })

  it('ignores a tree response from a previously active directory', async () => {
    activate(makeTab('a.excalidraw'))
    let resolve!: (value: unknown[]) => void
    mockInvoke.mockReturnValue(new Promise<unknown[]>(done => { resolve = done }))
    const refresh = useStore.getState().loadFileTree('/workspace')
    useStore.setState({ currentDirectory: '/other' })
    resolve([]); await refresh
    expect(useStore.getState().currentDirectory).toBe('/other')
  })
})
