import { Events, Window } from '@wailsio/runtime'
import * as Service from '../../bindings/github.com/SherlockGy/excaligo/internal/desktop/service'
import type { DialogOptions } from '../../bindings/github.com/SherlockGy/excaligo/internal/desktop/models'
import type { Preferences } from '../../bindings/github.com/SherlockGy/excaligo/internal/preferences/models'

// The original frontend command vocabulary is isolated here. Every operation
// uses generated, compile-checked Wails v3 bindings; no legacy runtime is loaded.
const commands = {
  select_directory: () => Service.SelectDirectory(),
  list_excalidraw_files: (p: { directory: string }) => Service.ListExcalidrawFiles(p.directory),
  get_file_tree: (p: { directory: string }) => Service.GetFileTree(p.directory),
  read_file: (p: { filePath: string }) => Service.ReadFile(p.filePath),
  read_file_with_hash: (p: { filePath: string }) => Service.ReadFileWithHash(p.filePath),
  hash_file_content: (p: { filePath: string }) => Service.HashFileContent(p.filePath),
  save_file: (p: { filePath: string; content: string }) => Service.SaveFile(p.filePath, p.content),
  save_file_as: (p: { content: string }) => Service.SaveFileAs(p.content),
  create_new_file: (p: { directory: string; fileName: string }) => Service.CreateNewFile(p.directory, p.fileName),
  create_new_folder: (p: { directory: string; folderName: string }) => Service.CreateNewFolder(p.directory, p.folderName),
  rename_file: (p: { oldPath: string; newName: string }) => Service.RenameFile(p.oldPath, p.newName),
  rename_folder: (p: { oldPath: string; newName: string }) => Service.RenameFolder(p.oldPath, p.newName),
  delete_file: (p: { filePath: string }) => Service.DeleteFile(p.filePath),
  delete_folder: (p: { folderPath: string }) => Service.DeleteFolder(p.folderPath),
  get_preferences: () => Service.GetPreferences(),
  save_preferences: (p: { preferences: Preferences }) => Service.SavePreferences(p.preferences),
  watch_directory: (p: { directory: string }) => Service.WatchDirectory(p.directory),
  set_menu_visible: (p: { visible: boolean }) => Service.SetMenuVisible(p.visible),
  set_decorations: (p: { visible: boolean }) => Service.SetDecorations(p.visible),
  force_close_app: () => Service.ForceCloseApp(),
  cancel_close: () => Service.CancelClose(),
  pending_open_files: () => Service.PendingOpenFiles(),
}

export async function invoke<T = void>(command: keyof typeof commands, args?: Record<string, unknown>): Promise<T> {
  const call = commands[command] as unknown as (args?: Record<string, unknown>) => Promise<T>
  return call(args)
}

export type UnlistenFn = () => void
export async function listen<T = unknown>(name: string, callback: (event: { payload: T }) => void | Promise<void>): Promise<UnlistenFn> {
  return Events.On(name, event => {
    const logPrefix = `[listen 处理桌面事件][event=${name}]`
    Promise.resolve(callback({ payload: event.data as T })).catch(error => {
      console.error(logPrefix, error)
    })
  })
}

function dialogOptions(options: Partial<DialogOptions>): DialogOptions {
  return { title: '', kind: 'info', okLabel: 'OK', cancelLabel: 'Cancel', ...options }
}
export function ask(text: string, options: Partial<DialogOptions> = {}): Promise<boolean> {
  return Service.Ask(text, dialogOptions(options))
}
export function message(text: string, options: Partial<DialogOptions> = {}): Promise<void> {
  return Service.Message(text, dialogOptions(options))
}
export const getCurrentWindow = () => ({
  close: () => Window.Close(),
  minimize: () => Window.Minimise(),
  isFullscreen: () => Window.IsFullscreen(),
  setFullscreen: (value: boolean) => value ? Window.Fullscreen() : Window.UnFullscreen(),
})

export async function exportBlob(name: string, blob: Blob): Promise<void> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(blob)
  })
  await Service.ExportFile(name, data)
}
