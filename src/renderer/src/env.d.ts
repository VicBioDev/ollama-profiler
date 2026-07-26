/// <reference types="vite/client" />

import type { DesktopApi } from '@shared/types'

declare global {
  interface Window {
    ollamaProfiler: DesktopApi
    __TAURI_INTERNALS__?: unknown
  }
}

export {}
