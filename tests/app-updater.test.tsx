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
  it('checks on launch, installs after confirmation, and waits to restart', async () => {
    const downloadAndInstall = vi.fn(async () => undefined)
    checkMock.mockResolvedValue({
      version: '0.2.0',
      body: 'Improved discovery.\nFixed update reliability.',
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
      label: 'v0.2.0 is available',
      version: '0.2.0',
      notes: 'Improved discovery.\nFixed update reliability.'
    })

    await act(async () => {
      await updater.installUpdate()
    })

    expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunchMock).not.toHaveBeenCalled()
    expect(updater.state).toMatchObject({
      phase: 'ready-to-restart',
      version: '0.2.0'
    })

    await act(async () => {
      await updater.restartToUpdate()
    })

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
      await updater.restartToUpdate()
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

  it('keeps the version and check action on one row and confirms updates', () => {
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
            label: 'v0.2.0 is available',
            detail: 'A signed update is available.',
            version: '0.2.0',
            notes: 'Improved discovery.\nFixed update reliability.'
          }}
        />
      )
    })

    const versionRow = container.querySelector('.sidebar-version-row')
    const currentVersion = container.querySelector(
      '.sidebar-current-version'
    )
    const checkForUpdates = container.querySelector<HTMLButtonElement>(
      '.sidebar-check-update'
    )
    const update = container.querySelector<HTMLButtonElement>(
      '.sidebar-update-action'
    )

    expect(versionRow?.children).toHaveLength(2)
    expect(currentVersion?.textContent).toContain('v')
    expect(checkForUpdates?.textContent).toBe('Check for updates')
    expect(container.textContent).toContain('v0.2.0 is available')

    act(() => checkForUpdates?.click())
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
    expect(onInstallUpdate).not.toHaveBeenCalled()

    act(() => update?.click())
    expect(onInstallUpdate).not.toHaveBeenCalled()
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'Update to v0.2.0?'
    )
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'Improved discovery.'
    )

    const confirm = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === 'Download & install'
    )
    act(() => confirm?.click())
    expect(onInstallUpdate).toHaveBeenCalledTimes(1)
  })

  it('offers restart only after the update is installed', () => {
    const onRestartUpdate = vi.fn()

    act(() => {
      root.render(
        <Sidebar
          activePage="overview"
          hasServers={true}
          localState="idle"
          onNavigate={() => undefined}
          onRestartUpdate={onRestartUpdate}
          updateState={{
            phase: 'ready-to-restart',
            label: 'Ready to restart',
            detail: 'v0.2.0 is installed.',
            version: '0.2.0'
          }}
        />
      )
    })

    expect(relaunchMock).not.toHaveBeenCalled()
    const restart = container.querySelector<HTMLButtonElement>(
      '.sidebar-restart-action'
    )
    expect(restart?.textContent).toBe('Restart now')

    act(() => restart?.click())
    expect(onRestartUpdate).toHaveBeenCalledTimes(1)
  })
})

function Harness(): React.JSX.Element {
  updater = useAppUpdater()
  return <div>{updater.state.label}</div>
}
