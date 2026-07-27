import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useCallback, useEffect, useRef, useState } from 'react'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'ready-to-restart'
  | 'restarting'
  | 'error'

export interface AppUpdateState {
  readonly phase: UpdatePhase
  readonly label: string
  readonly detail: string
  readonly version?: string
  readonly notes?: string
}

const IDLE_STATE: AppUpdateState = {
  phase: 'idle',
  label: 'Check for updates',
  detail: 'Click to check GitHub Releases for a newer signed version.'
}

export function useAppUpdater(): {
  readonly state: AppUpdateState
  readonly checkForUpdates: () => Promise<void>
  readonly installUpdate: () => Promise<void>
  readonly restartToUpdate: () => Promise<void>
} {
  const [state, setState] = useState<AppUpdateState>(IDLE_STATE)
  const availableUpdate = useRef<
    NonNullable<Awaited<ReturnType<typeof check>>> | undefined
  >(undefined)
  const checkedOnLaunch = useRef(false)

  const checkForUpdates = useCallback(async (): Promise<void> => {
    if (
      state.phase === 'checking' ||
      state.phase === 'downloading' ||
      state.phase === 'installing' ||
      state.phase === 'restarting'
    ) {
      return
    }

    setState({
      phase: 'checking',
      label: 'Checking…',
      detail: 'Checking the latest signed GitHub Release.'
    })

    try {
      availableUpdate.current = undefined
      const update = await check({ timeout: 20_000 })
      if (!update) {
        setState({
          phase: 'current',
          label: 'Up to date',
          detail: 'This is the newest available version.'
        })
        return
      }

      availableUpdate.current = update
      setState({
        phase: 'available',
        label: `v${update.version} is available`,
        detail: 'Review the release notes before downloading and installing.',
        version: update.version,
        notes: update.body?.trim() || undefined
      })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setState({
        phase: 'error',
        label: 'Update check failed',
        detail: message
      })
    }
  }, [state.phase])

  useEffect(() => {
    if (checkedOnLaunch.current) {
      return
    }
    checkedOnLaunch.current = true
    void checkForUpdates()
  }, [checkForUpdates])

  const installUpdate = useCallback(async (): Promise<void> => {
    if (state.phase !== 'available' || !availableUpdate.current) {
      return
    }

    const update = availableUpdate.current
    try {
      let downloaded = 0
      let total: number | undefined
      setState({
        phase: 'downloading',
        label: `Downloading v${update.version}…`,
        detail: `A signed update to v${update.version} is available.`
      })

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? undefined
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          const progress =
            total && total > 0
              ? ` ${Math.min(100, Math.round((downloaded / total) * 100))}%`
              : ''
          setState({
            phase: 'downloading',
            label: `Downloading${progress}`,
            detail: `Downloading the signed v${update.version} update.`
          })
        } else if (event.event === 'Finished') {
          setState({
            phase: 'installing',
            label: 'Installing…',
            detail: `Replacing this installation with v${update.version}.`
          })
        }
      })

      availableUpdate.current = undefined
      setState({
        phase: 'ready-to-restart',
        label: 'Ready to restart',
        detail: `v${update.version} is installed. Restart when you are ready to use it.`,
        version: update.version
      })
    } catch (caught) {
      availableUpdate.current = undefined
      const message = caught instanceof Error ? caught.message : String(caught)
      setState({
        phase: 'error',
        label: 'Update failed',
        detail: message
      })
    }
  }, [state.phase])

  const restartToUpdate = useCallback(async (): Promise<void> => {
    if (state.phase !== 'ready-to-restart' || !state.version) {
      return
    }

    const version = state.version
    setState({
      phase: 'restarting',
      label: 'Restarting…',
      detail: `Restarting into v${version}.`,
      version
    })

    try {
      await relaunch()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setState({
        phase: 'error',
        label: 'Restart failed',
        detail: message,
        version
      })
    }
  }, [state.phase, state.version])

  return { state, checkForUpdates, installUpdate, restartToUpdate }
}
