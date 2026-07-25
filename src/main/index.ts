import { app, BrowserWindow, shell } from 'electron'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { ProfilerStore } from './services/store.js'
import { ProfilerEngine } from './services/profiler-engine.js'
import { registerIpc } from './ipc.js'

let mainWindow: BrowserWindow | null = null
let engine: ProfilerEngine | undefined
let shutdownStarted = false
let shutdownComplete = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    title: 'Ollama Profiler',
    backgroundColor: '#0b0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Preload failed: ${preloadPath}`, error)
  })
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`Renderer failed to load (${errorCode}): ${errorDescription}`)
  })
  mainWindow.webContents.on('console-message', (details) => {
    const output = `[renderer:${details.level}] ${details.message}`
    if (details.level === 'error') console.error(output)
    else console.log(output)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  const dataDirectory = app.getPath('userData')
  await removeLegacyApiSecrets(join(dataDirectory, 'profiler-secrets.json'))
  engine = new ProfilerEngine(new ProfilerStore(join(dataDirectory, 'profiler-data.json')))
  await engine.initialize()
  registerIpc(engine, () => mainWindow)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (!engine || shutdownComplete) return
  event.preventDefault()
  if (shutdownStarted) return
  shutdownStarted = true
  void engine.shutdown().finally(() => {
    shutdownComplete = true
    app.quit()
  })
})

async function removeLegacyApiSecrets(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
