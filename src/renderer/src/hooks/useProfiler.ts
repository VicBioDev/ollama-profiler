import { useCallback, useEffect, useState } from 'react'
import type {
  AppSettings,
  ChatRequest,
  ChatResponse,
  ImportCommitOptions,
  ImportPreview,
  ProfilerSnapshot,
  ServerExportOptions,
  ServerExportResult
} from '@shared/types'

interface ProfilerActions {
  selectImportFile: () => Promise<ImportPreview | null>
  previewText: (contents: string) => Promise<ImportPreview>
  commitImport: (options: ImportCommitOptions) => Promise<{ added: number; updated: number }>
  testLocalhost: () => Promise<void>
  scanLocalNetwork: () => Promise<void>
  profileAllServers: (resumeIncomplete?: boolean) => Promise<void>
  setBenchmarkApproval: (serverId: string, approved: boolean) => Promise<void>
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>
  removeServer: (serverId: string) => Promise<void>
  removeServers: (serverIds: string[]) => Promise<void>
  exportServers: (
    options: ServerExportOptions
  ) => Promise<ServerExportResult | null>
  chatModels: (request: ChatRequest) => Promise<ChatResponse>
  clearError: () => void
}

interface UseProfilerResult {
  snapshot?: ProfilerSnapshot
  busy: boolean
  error?: string
  actions: ProfilerActions
}

export function useProfiler(): UseProfilerResult {
  const [snapshot, setSnapshot] = useState<ProfilerSnapshot>()
  const [busyCount, setBusyCount] = useState(0)
  const [error, setError] = useState<string>()

  useEffect(() => {
    void window.ollamaProfiler.getSnapshot().then(setSnapshot).catch(captureError)
    return window.ollamaProfiler.subscribe(setSnapshot)
  }, [])

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    setBusyCount((value) => value + 1)
    setError(undefined)
    try {
      return await operation()
    } catch (caught) {
      const message = errorMessage(caught)
      setError(message)
      throw caught
    } finally {
      setBusyCount((value) => Math.max(0, value - 1))
    }
  }, [])

  const captureError = (caught: unknown): void => setError(errorMessage(caught))

  const actions: ProfilerActions = {
    selectImportFile: () => run(() => window.ollamaProfiler.selectImportFile()),
    previewText: (contents) => run(() => window.ollamaProfiler.previewText(contents)),
    commitImport: (options) => run(() => window.ollamaProfiler.commitImport(options)),
    testLocalhost: async () => {
      await run(() => window.ollamaProfiler.testLocalhost())
    },
    scanLocalNetwork: async () => {
      await run(() => window.ollamaProfiler.scanLocalNetwork())
    },
    profileAllServers: async (resumeIncomplete = false) => {
      await run(() => window.ollamaProfiler.profileAllServers(resumeIncomplete))
    },
    setBenchmarkApproval: async (serverId, approved) => {
      await run(() => window.ollamaProfiler.setBenchmarkApproval(serverId, approved))
    },
    updateSettings: async (settings) => {
      await run(() => window.ollamaProfiler.updateSettings(settings))
    },
    removeServer: async (serverId) => {
      await run(() => window.ollamaProfiler.removeServer(serverId))
    },
    removeServers: async (serverIds) => {
      await run(() => window.ollamaProfiler.removeServers(serverIds))
    },
    exportServers: (options) =>
      run(() => window.ollamaProfiler.exportServers(options)),
    chatModels: (request) =>
      run(() => window.ollamaProfiler.chatModels(request)),
    clearError: () => setError(undefined)
  }

  return {
    snapshot,
    busy: busyCount > 0,
    error,
    actions
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
