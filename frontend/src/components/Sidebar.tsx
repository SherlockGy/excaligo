import { useTranslation } from '../hooks/useTranslation'
import { ScrollArea } from '@radix-ui/react-scroll-area'
import { FolderOpen, Plus, FolderPlus } from 'lucide-react'
import { useStore } from '../store/useStore'
import { TreeView } from './TreeView'
import { FileTreeNode } from '../types'
import { invoke } from '../lib/backend'
import { promptForName } from '../lib/namePrompt'
import { useSidebarFileDrag } from '../hooks/useSidebarFileDrag'
import { cn } from '../lib/utils'

function countFilesInTree(nodes: FileTreeNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (!node.is_directory) {
      count++
    }
    if (node.children) {
      count += countFilesInTree(node.children)
    }
  }
  return count
}

export function Sidebar() {
  const t = useTranslation()
  const {
    currentDirectory,
    fileTree,
    activeFile,
    loadFileFromTree,
    createNewFile,
    createNewFolder,
    fileMutationPath,
  } = useStore()
  const drag = useSidebarFileDrag()
  const rootDropTarget = !!currentDirectory && drag.dropTargetPath === currentDirectory

  const handleSelectDirectory = async () => {
    const dir = await invoke<string | null>('select_directory')
    if (dir) {
      await useStore.getState().loadDirectory(dir)
    }
  }

  const handleNewFile = async () => {
    if (!currentDirectory) {
      const dir = await invoke<string | null>('select_directory')
      if (dir) {
        if (!await useStore.getState().loadDirectory(dir)) return
      } else {
        return
      }
    }

    const fileName = await promptForName({
      title: t('File name'),
      defaultValue: t('Untitled.excalidraw'),
      confirmLabel: t('Create'),
    })
    if (!fileName) {
      return
    }

    await createNewFile(fileName)
  }

  const handleNewFolder = async () => {
    if (!currentDirectory) {
      const dir = await invoke<string | null>('select_directory')
      if (dir) {
        if (!await useStore.getState().loadDirectory(dir)) return
      } else {
        return
      }
    }

    const folderName = await promptForName({
      title: t('Folder name'),
      defaultValue: t('New Folder'),
      confirmLabel: t('Create'),
    })
    if (!folderName) {
      return
    }

    await createNewFolder(folderName)
  }

  return (
    <div ref={drag.rootRef} {...drag.handlers} className="sidebar-panel w-[280px] h-full border-r flex flex-col" aria-busy={!!fileMutationPath}>
      {drag.draggedFilePath && drag.position && (
        <div className="file-drag-preview" style={{ left: drag.position.x, top: drag.position.y }} aria-hidden="true">
          {drag.draggedFilePath.split(/[\\/]/).pop()?.replace(/\.excalidraw$/, '')}
        </div>
      )}
      {/* Header */}
      <div className="sidebar-section p-4 border-b">
        <button
          onClick={handleSelectDirectory}
          className={cn('sidebar-action w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors', rootDropTarget && 'file-drop-target')}
          data-drop-directory={currentDirectory || undefined}
          title={currentDirectory ? t('Drop files here to move to the workspace root') : undefined}
        >
          <FolderOpen className="w-4 h-4" />
          <span className="text-sm font-medium truncate">
            {currentDirectory ? currentDirectory.split(/[\\/]/).pop() : t('Select Directory')}
          </span>
        </button>

        <button
          onClick={handleNewFile}
          className="sidebar-action w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-md transition-colors"
          title={!currentDirectory ? t('Select a directory first') : t('Create a new Excalidraw file')}
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">{t('New File')}</span>
        </button>

        <button
          onClick={handleNewFolder}
          className="sidebar-action w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-md transition-colors"
          title={!currentDirectory ? t('Select a directory first') : t('Create a new folder')}
        >
          <FolderPlus className="w-4 h-4" />
          <span className="text-sm">{t('New Folder')}</span>
        </button>
      </div>

      {/* File Tree */}
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className={cn('p-2 min-h-full', rootDropTarget && 'file-drop-root')} data-drop-directory={currentDirectory || undefined}>
          {fileTree.length === 0 ? (
            <div className="sidebar-muted text-sm text-center py-8">
              {currentDirectory ? t('No .excalidraw files found') : t('No directory selected')}
            </div>
          ) : (
            <TreeView
              nodes={fileTree}
              onFileClick={loadFileFromTree}
              activeFilePath={activeFile?.path}
              dropTargetPath={drag.dropTargetPath}
              draggedFilePath={drag.draggedFilePath}
            />
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="sidebar-section p-3 border-t">
        {(drag.draggedFilePath || fileMutationPath) && (
          <div className="sidebar-muted text-xs mb-2" role="status">
            {fileMutationPath ? t('Updating files...') : t('Drop onto a folder or the workspace name to move.')}
          </div>
        )}
        <div className="sidebar-muted text-xs">
          {t(countFilesInTree(fileTree) === 1 ? '{count} file' : '{count} files', { count: countFilesInTree(fileTree) })}
        </div>
      </div>
    </div>
  )
}
