import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { createDesktopApi } from './data/desktopApi'
import './styles.css'

async function bootstrap(): Promise<void> {
  const isStitchPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('preview') === 'stitch'

  if (!window.ollamaProfiler && isStitchPreview) {
    const { createPreviewApi } = await import('./data/previewApi')
    window.ollamaProfiler = createPreviewApi()
  } else if (!window.ollamaProfiler && window.__TAURI_INTERNALS__) {
    window.ollamaProfiler = createDesktopApi()
  }

  const root = document.getElementById('root')
  if (!root) throw new Error('Application root was not found')

  if (!window.ollamaProfiler) {
    createRoot(root).render(
      <main className="boot-screen">
        <strong>Ollama Profiler could not start.</strong>
        <span>The secure desktop bridge did not load. Restart the app or reinstall it.</span>
      </main>
    )
    return
  }

  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void bootstrap()
