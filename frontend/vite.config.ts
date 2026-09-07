import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import wails from '@wailsio/runtime/plugins/vite'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const enginePackage = JSON.parse(readFileSync(new URL('./node_modules/@excalidraw/excalidraw/package.json', import.meta.url), 'utf8'))
if (typeof enginePackage.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(enginePackage.version)) {
  throw new Error('A stable Excalidraw package version is required')
}

export default defineConfig({
  define: { __EXCALIDRAW_VERSION__: JSON.stringify(enginePackage.version) },
  plugins: [react(), wails('./bindings'), {
    name: 'local-excalidraw-fonts',
    buildStart() {
      cpSync('node_modules/@excalidraw/excalidraw/dist/prod/fonts', 'public/fonts', { recursive: true })
    },
    closeBundle() {
      // Retain the tracked embed placeholder even when Vite empties dist.
      writeFileSync('dist/.gitkeep', '')
    },
  }],
  resolve: { alias: [
    { find: /^browser-fs-access$/, replacement: fileURLToPath(new URL('./src/lib/fileAccess.ts', import.meta.url)) },
    { find: 'browser-fs-access-original', replacement: fileURLToPath(new URL('./node_modules/browser-fs-access/dist/index.mjs', import.meta.url)) },
  ] },
  clearScreen: false,
  server: { host: '127.0.0.1', port: 9245, strictPort: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
