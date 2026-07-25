import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  DesktopApi,
  ImportCommitOptions,
  ProfilerSnapshot
} from '@shared/types.js'

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('profiler:get-snapshot'),
  subscribe: (listener: (snapshot: ProfilerSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: ProfilerSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on('profiler:snapshot', handler)
    return () => ipcRenderer.removeListener('profiler:snapshot', handler)
  },
  selectImportFile: () => ipcRenderer.invoke('profiler:select-import-file'),
  previewText: (contents: string) => ipcRenderer.invoke('profiler:preview-text', contents),
  commitImport: (options: ImportCommitOptions) =>
    ipcRenderer.invoke('profiler:commit-import', options),
  testLocalhost: () => ipcRenderer.invoke('profiler:test-localhost'),
  scanLocalNetwork: () => ipcRenderer.invoke('profiler:scan-local-network'),
  scanServers: (serverIds?: string[]) =>
    ipcRenderer.invoke('profiler:scan-servers', serverIds),
  benchmarkServers: (serverIds?: string[]) =>
    ipcRenderer.invoke('profiler:benchmark-servers', serverIds),
  setBenchmarkApproval: (serverId: string, approved: boolean) =>
    ipcRenderer.invoke('profiler:set-benchmark-approval', serverId, approved),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('profiler:update-settings', settings),
  removeServer: (serverId: string) =>
    ipcRenderer.invoke('profiler:remove-server', serverId),
  removeServers: (serverIds: string[]) =>
    ipcRenderer.invoke('profiler:remove-servers', serverIds),
  exportServers: (options) =>
    ipcRenderer.invoke('profiler:export-servers', options)
}

contextBridge.exposeInMainWorld('ollamaProfiler', api)
