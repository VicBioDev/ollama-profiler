import {
  dialog,
  ipcMain,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { writeFile } from 'node:fs/promises'
import type {
  AppSettings,
  ImportCommitOptions,
  ServerExportOptions
} from '@shared/types.js'
import {
  createServerExportCsv,
  createServerExportFileName
} from '@shared/server-export.js'
import type { ProfilerEngine } from './services/profiler-engine.js'

export function registerIpc(engine: ProfilerEngine, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('profiler:get-snapshot', () => engine.getSnapshot())

  ipcMain.handle('profiler:select-import-file', async () => {
    const owner = getWindow()
    const options: OpenDialogOptions = {
      title: 'Import FOFA, Shodan, or endpoint data',
      properties: ['openFile'],
      filters: [
        {
          name: 'Discovery exports',
          extensions: ['csv', 'tsv', 'txt', 'json', 'gz']
        }
      ]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    return result.canceled || !filePath ? null : engine.previewFile(filePath)
  })

  ipcMain.handle('profiler:preview-text', (_event, contents: string) =>
    engine.previewText(contents)
  )
  ipcMain.handle(
    'profiler:commit-import',
    (_event, options: ImportCommitOptions) => engine.commitImport(options)
  )
  ipcMain.handle('profiler:test-localhost', () => engine.testLocalhost())
  ipcMain.handle('profiler:scan-local-network', () => engine.scanLocalNetwork())
  ipcMain.handle('profiler:profile-all-servers', () => engine.profileAllServers())
  ipcMain.handle(
    'profiler:set-benchmark-approval',
    (_event, serverId: string, approved: boolean) =>
      engine.setBenchmarkApproval(serverId, approved)
  )
  ipcMain.handle(
    'profiler:update-settings',
    (_event, settings: Partial<AppSettings>) => engine.updateSettings(settings)
  )
  ipcMain.handle('profiler:remove-server', (_event, serverId: string) =>
    engine.removeServer(serverId)
  )
  ipcMain.handle('profiler:remove-servers', (_event, serverIds: string[]) =>
    engine.removeServers(serverIds)
  )
  ipcMain.handle(
    'profiler:export-servers',
    async (_event, options: ServerExportOptions) => {
      const serverIds = Array.isArray(options?.serverIds)
        ? options.serverIds.filter((id): id is string => typeof id === 'string')
        : []
      const modelName =
        typeof options?.modelName === 'string' &&
        options.modelName.length > 0 &&
        options.modelName.length <= 512
          ? options.modelName
          : undefined
      const byId = new Map(
        engine.getSnapshot().servers.map((server) => [server.id, server])
      )
      const servers = [
        ...new Set(serverIds)
      ].flatMap((id) => {
        const server = byId.get(id)
        return server ? [server] : []
      })
      if (servers.length === 0) {
        throw new Error('Select at least one server to export')
      }

      const saveOptions: SaveDialogOptions = {
        title: 'Export selected Ollama servers',
        defaultPath: createServerExportFileName(modelName),
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      }
      const owner = getWindow()
      const result = owner
        ? await dialog.showSaveDialog(owner, saveOptions)
        : await dialog.showSaveDialog(saveOptions)
      if (result.canceled || !result.filePath) return null

      await writeFile(
        result.filePath,
        createServerExportCsv(servers, modelName),
        'utf8'
      )
      return { filePath: result.filePath, count: servers.length }
    }
  )

  engine.on('snapshot', (snapshot) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('profiler:snapshot', snapshot)
    }
  })
}
