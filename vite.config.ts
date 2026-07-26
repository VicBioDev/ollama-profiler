import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src/renderer'),
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    emptyOutDir: true,
    outDir: resolve('out/renderer'),
    target: ['es2021', 'safari13'],
    minify: process.env.TAURI_DEBUG ? false : 'esbuild',
    sourcemap: Boolean(process.env.TAURI_DEBUG)
  }
})
