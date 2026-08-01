// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfilerJob, ProfilerSnapshot } from '@shared/types.js'
import { DEFAULT_SETTINGS } from '@shared/defaults.js'
import { decideBenchmarkContinuation } from '@shared/job-utils.js'
import { useBenchmarkContinuationOnLaunch } from '@renderer/hooks/useBenchmarkContinuationOnLaunch.js'

type BenchmarkDecisionRequest = Parameters<typeof decideBenchmarkContinuation>[1]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  vi.restoreAllMocks()
  act(() => root.unmount())
  container.remove()
})

describe('benchmark continuation on launch', () => {
  it('prompts once after the initial snapshot and resumes the interrupted run', async () => {
    const requestDecision = vi.fn(async () => 'continue' as const)
    const profileAllServers = vi.fn(async () => undefined)

    await renderHarness(undefined, requestDecision, profileAllServers)
    expect(requestDecision).not.toHaveBeenCalled()

    await renderHarness(
      snapshot([benchmarkJob('cancelled', 2, 5)]),
      requestDecision,
      profileAllServers
    )
    expect(requestDecision).toHaveBeenCalledTimes(1)
    expect(profileAllServers).toHaveBeenCalledWith(true)

    await renderHarness(
      snapshot([benchmarkJob('cancelled', 3, 5)]),
      requestDecision,
      profileAllServers
    )
    expect(requestDecision).toHaveBeenCalledTimes(1)
    expect(profileAllServers).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the latest benchmark finished', async () => {
    const requestDecision = vi.fn(async () => 'start-over' as const)
    const profileAllServers = vi.fn(async () => undefined)

    await renderHarness(
      snapshot([benchmarkJob('completed', 5, 5)]),
      requestDecision,
      profileAllServers
    )

    expect(requestDecision).not.toHaveBeenCalled()
    expect(profileAllServers).not.toHaveBeenCalled()
  })

  it('starts a fresh benchmark when Start over is selected', async () => {
    const requestDecision = vi.fn(async () => 'start-over' as const)
    const profileAllServers = vi.fn(async () => undefined)

    await renderHarness(
      snapshot([benchmarkJob('failed', 2, 5)]),
      requestDecision,
      profileAllServers
    )

    expect(requestDecision).toHaveBeenCalledTimes(1)
    expect(profileAllServers).toHaveBeenCalledWith(false)
  })

  it('does not request benchmark recovery when Cancel is selected', async () => {
    const requestDecision = vi.fn(async () => 'cancel' as const)
    const profileAllServers = vi.fn(async () => undefined)

    await renderHarness(
      snapshot([benchmarkJob('cancelled', 2, 5)]),
      requestDecision,
      profileAllServers
    )

    expect(requestDecision).toHaveBeenCalledTimes(1)
    expect(profileAllServers).not.toHaveBeenCalled()
  })
})

function Harness({
  currentSnapshot,
  requestDecision,
  profileAllServers
}: Readonly<{
  currentSnapshot: ProfilerSnapshot | undefined
  requestDecision: BenchmarkDecisionRequest
  profileAllServers: (resumeIncomplete?: boolean) => Promise<void>
}>): React.JSX.Element {
  useBenchmarkContinuationOnLaunch(
    currentSnapshot,
    requestDecision,
    profileAllServers
  )
  return <div />
}

async function renderHarness(
  currentSnapshot: ProfilerSnapshot | undefined,
  requestDecision: BenchmarkDecisionRequest,
  profileAllServers: (resumeIncomplete?: boolean) => Promise<void>
): Promise<void> {
  await act(async () => {
    root.render(
      <Harness
        currentSnapshot={currentSnapshot}
        profileAllServers={profileAllServers}
        requestDecision={requestDecision}
      />
    )
  })
}

function snapshot(jobs: ProfilerJob[]): ProfilerSnapshot {
  return {
    servers: [
      {
        id: 'server-1',
        endpoint: 'http://127.0.0.1:11434',
        source: 'manual',
        status: 'online',
        failureCount: 0,
        benchmarkApproved: true,
        firstDiscoveredAt: '2026-07-25T00:00:00Z',
        lastDiscoveredAt: '2026-07-26T00:00:00Z',
        models: []
      }
    ],
    jobs,
    settings: DEFAULT_SETTINGS,
    updatedAt: '2026-07-26T00:05:00Z'
  }
}

function benchmarkJob(
  status: ProfilerJob['status'],
  completed: number,
  total: number
): ProfilerJob {
  return {
    id: 'benchmark-job',
    kind: 'benchmark',
    status,
    label: 'Benchmark all approved local models',
    completed,
    total,
    createdAt: '2026-07-26T00:00:00Z',
    updatedAt: '2026-07-26T00:05:00Z'
  }
}
