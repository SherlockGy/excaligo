// Timing constants (in milliseconds)
export const TIMING = {
  DEBOUNCE_SAVE: 100,
  DEBOUNCE_SEARCH: 300,
  FILE_LOAD_DELAY: 300,
  LOADING_HIDE_DELAY: 200,
  USER_CHANGE_ENABLE_DELAY: 300,
  AUTO_SAVE_INTERVAL: 30000, // 30 seconds
} as const

// File system constants
export const FILE_SYSTEM = {
  EXTENSION: 'excalidraw',
  DEFAULT_FILE_PREFIX: 'Untitled',
  MAX_RENAME_ATTEMPTS: 100,
} as const

// UI constants
export const UI = {
  MIN_SIDEBAR_WIDTH: 200,
  MAX_SIDEBAR_WIDTH: 500,
  DEFAULT_SIDEBAR_WIDTH: 250,
  ZOOM_INCREMENT: 1.1,
  MAX_ZOOM: 30,
  MIN_ZOOM: 0.1,
} as const

// Performance thresholds
export const PERFORMANCE = {
  MAX_FILE_SIZE_MB: 50,
  MAX_ELEMENTS_COUNT: 10000,
  VIRTUALIZATION_THRESHOLD: 100, // Number of files before enabling virtualization
} as const

// Error messages
export const ERROR_MESSAGES = {
  FILE_NOT_FOUND: 'The file could not be found. It may have been moved or deleted.',
  SAVE_FAILED: 'Failed to save the file. Please check your permissions and try again.',
  LOAD_FAILED: 'Failed to load the file. The file may be corrupted or in an invalid format.',
  RENAME_FAILED: 'Failed to rename the file. A file with that name may already exist.',
  DELETE_FAILED: 'Failed to delete the file. Please check your permissions.',
  DIRECTORY_ACCESS_DENIED: 'Cannot access the selected directory. Please check your permissions.',
  INVALID_JSON: 'The file contains invalid JSON and cannot be opened.',
  PATH_TRAVERSAL: 'The requested path is outside the allowed directory.',
} as const

// Success messages
export const SUCCESS_MESSAGES = {
  FILE_SAVED: 'File saved successfully',
  FILE_CREATED: 'New file created',
  FILE_RENAMED: 'File renamed successfully',
  FILE_DELETED: 'File deleted successfully',
} as const
