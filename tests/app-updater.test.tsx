// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@renderer/components/Sidebar.js'
import { useAppUpdater } from '@renderer/hooks/useAppUpdater.js'

const { checkMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  relaunchMock: vi.fn()
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkMock
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: relaunchMock
}))

let container: HTMLDivElement
let root: Root
let updater: ReturnType<typeof useAppUpdater>

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  checkMock.mockReset()
  relaunchMock.mockReset()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('application updater', () => {
  it('checks on launch and only installs after a separate action', async () => {
    const downloadAndInstall = vi.fn(async () => undefined)
    checkMock.mockResolvedValue({
      version: '0.2.0',
      downloadAndInstall
    })

    await act(async () => {
      root.render(<Harness />)
    })

    expect(checkMock).toHaveBeenCalledWith({ timeout: 20_000 })
    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(downloadAndInstall).not.toHaveBeenCalled()
    expect(relaunchMock).not.toHaveBeenCalled()
    expect(updater.state).toMatchObject({
      phase: 'available',
      label: 'Update available',
      version: '0.2.0'
    })

    await act(async () => {
      await updater.installUpdate()
    })

    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunchMock).toHaveBeenCalledTimes(1)
    expect(updater.state.phase).toBe('restarting')
  })

  it('reports the current version without offering installation', async () => {
    checkMock.mockResolvedValue(null)

    await act(async () => {
      root.render(<Harness />)
    })

    expect(checkMock).toHaveBeenCalledTimes(1)
    expect(updater.state.phase).toBe('current')

    await act(async () => {
      await updater.installUpdate()
    })

    expect(relaunchMock).not.toHaveBeenCalled()
  })

  it('keeps manual checks available after the launch check', async () => {
    checkMock.mockResolvedValue(null)

    await act(async () => {
      root.render(<Harness />)
    })
    await act(async () => {
      await updater.checkForUpdates()
    })

    expect(checkMock).toHaveBeenCalledTimes(2)
  })

  it('uses separate current-version and install-version controls', () => {
    const onCheckForUpdates = vi.fn()
    const onInstallUpdate = vi.fn()

    act(() => {
      root.render(
        <Sidebar
          activePage="overview"
          hasServers={true}
          localState="idle"
          onCheckForUpdates={onCheckForUpdates}
          onInstallUpdate={onInstallUpdate}
          onNavigate={() => undefined}
          updateState={{
            phase: 'available',
            label: 'Update available',
            detail: 'A signed update is available.',
            version: '0.2.0'
          }}
        />
      )
    })

    const currentVersion = container.querySelector<HTMLButtonElement>(
      '.sidebar-current-version'
    )
    const newVersion = container.querySelector<HTMLButtonElement>(
      '.sidebar-update-version'
    )

    expect(currentVersion?.textContent).toContain('Click to check for updates')
    expect(newVersion?.textContent).toContain('v0.2.0')

    act(() => currentVersion?.click())
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
    expect(onInstallUpdate).not.toHaveBeenCalled()

    act(() => newVersion?.click())
    expect(onInstallUpdate).toHaveBeenCalledTimes(1)
  })
})

function Harness(): React.JSX.Element {
  updater = useAppUpdater()
  return <div>{updater.state.label}</div>
}
