import type { FileTreeNode } from '../types'

export function normalizeFilePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[a-z]:$/i.test(normalized)) return `${normalized}/`
  return normalized || '/'
}

export function canDropFile(filePath: string | null, directory: string | null): boolean {
  if (!filePath || !directory) return false
  const normalized = normalizeFilePath(filePath)
  const parent = normalizeFilePath(normalized.slice(0, normalized.lastIndexOf('/')))
  return parent !== normalizeFilePath(directory)
}

export function findTreeNode(nodes: FileTreeNode[], path: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const found = node.children && findTreeNode(node.children, path)
    if (found) return found
  }
}

// Keep the in-memory tree coherent before the watcher or a disk refresh returns.
export function moveTreeFile(nodes: FileTreeNode[], source: string, destination: string, directory: string, root: string): FileTreeNode[] {
  const file = findTreeNode(nodes, source)
  if (!file || file.is_directory) return nodes
  const moved = { ...file, path: destination }
  const sort = (items: FileTreeNode[]) => items.sort((a, b) =>
    Number(b.is_directory) - Number(a.is_directory) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const relocate = (items: FileTreeNode[]): FileTreeNode[] => items.filter(node => node.path !== source).map(node => {
    if (!node.is_directory) return node
    const children = relocate(node.children || [])
    return { ...node, children: node.path === directory ? sort([...children, moved]) : children }
  })
  const result = relocate(nodes)
  return directory === root ? sort([...result, moved]) : result
}
