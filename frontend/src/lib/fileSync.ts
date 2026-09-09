export class FileConflictError extends Error {
  constructor(public readonly contentHash: string) {
    super('File changed externally')
    this.name = 'FileConflictError'
  }
}

export function savedContentHash(result: { conflict: boolean; content_hash: string }): string {
  if (result.conflict) throw new FileConflictError(result.content_hash)
  return result.content_hash
}
