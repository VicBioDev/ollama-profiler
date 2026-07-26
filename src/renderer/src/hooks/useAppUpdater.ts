import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useCallback, useState } from 'react'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'current'
  | 'downloading'
  | 'installing'
  | 'restarting'
  | 'error'

export interface AppUpdateState {
  readonly phase: UpdatePhase
  readonly label: string
  readonly detail: string
}

const IDLE_STATE: AppUpdateState = {
  phase: 'idle',
  label: 'Check for updates',
  detail: 'Click to check GitHub Releases for a newer signed version.'
}

export function useAppUpdater(): {
  readonly state: AppUpdateState
  readonly checkAndInstall: () => Promise<void>
} {
  const [state, setState] = useState<AppUpdateState>(IDLE_STATE)

  const checkAndInstall = useCallback(async (): Promise<void> => {
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
      const update = await check({ timeout: 20_000 })
      if (!update) {
        setState({
          phase: 'current',
          label: 'Up to date',
          detail: 'This is the newest available version.'
        })
        return
      }

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

      setState({
        phase: 'restarting',
        label: 'Restarting…',
        detail: `v${update.version} is installed. Restarting the app.`
      })
      await relaunch()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setState({
        phase: 'error',
        label: 'Update failed',
        detail: message
      })
    }
  }, [state.phase])

  return { state, checkAndInstall }
}
