import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { createServerExportFileName } from '@shared/server-export'
import type {
  AppSettings,
  DesktopApi,
  DesktopNavigationTarget,
  ImportCommitOptions,
  ImportPreview,
  ProfilerSnapshot,
  ServerExportOptions,
  ServerExportResult
} from '@shared/types'

export function createDesktopApi(): DesktopApi {
  const currentPlatform = platform()
  return {
    platform: currentPlatform === 'macos' ? 'darwin' : currentPlatform,
    getSnapshot: () => invoke<ProfilerSnapshot>('get_snapshot'),
    subscribe: (listener) => subscribe('profiler:snapshot', listener),
    subscribeToNavigation: (listener) =>
      subscribe<DesktopNavigationTarget>('profiler:navigate', listener),
    selectImportFile: async () => {
      const selected = await open({
        title: 'Import FOFA, Shodan, or endpoint data',
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Discovery exports',
            extensions: ['csv', 'tsv', 'txt', 'json', 'gz']
          }
        ]
      })
      return selected
        ? invoke<ImportPreview>('preview_file', { filePath: selected })
        : null
    },
    previewText: (contents: string) =>
      invoke<ImportPreview>('preview_text', { contents }),
    commitImport: (options: ImportCommitOptions) =>
      invoke<{ added: number; updated: number }>('commit_import', { options }),
    testLocalhost: () => invoke<string>('test_localhost'),
    scanLocalNetwork: () => invoke<string>('scan_local_network'),
    profileAllServers: (resumeIncomplete = false) =>
      invoke<string>('profile_all_servers', { resumeIncomplete }),
    setBenchmarkApproval: (serverId: string, approved: boolean) =>
      invoke<void>('set_benchmark_approval', { serverId, approved }),
    updateSettings: (settings: Partial<AppSettings>) =>
      invoke<AppSettings>('update_settings', { settings }),
    removeServer: (serverId: string) =>
      invoke<void>('remove_server', { serverId }),
    removeServers: (serverIds: string[]) =>
      invoke<void>('remove_servers', { serverIds }),
    exportServers: async (
      options: ServerExportOptions
    ): Promise<ServerExportResult | null> => {
      const filePath = await save({
        title: 'Export selected Ollama servers',
        defaultPath: createServerExportFileName(options.modelName),
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      return filePath
        ? invoke<ServerExportResult>('export_servers', { options, filePath })
        : null
    }
  }
}

function subscribe<T>(
  eventName: string,
  listener: (payload: T) => void
): () => void {
  let disposed = false
  let unlisten: UnlistenFn | undefined

  void listen<T>(eventName, (event) => listener(event.payload)).then((cleanup) => {
    if (disposed) cleanup()
    else unlisten = cleanup
  })

  return () => {
    disposed = true
    unlisten?.()
  }
}
