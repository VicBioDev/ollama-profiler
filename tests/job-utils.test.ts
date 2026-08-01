import { describe, expect, it } from 'vitest'
import {
  benchmarkContinuationPrompt,
  decideBenchmarkContinuation,
  latestIncompleteBenchmark
} from '@shared/job-utils.js'
import type { ProfilerJob } from '@shared/types.js'

function job(overrides: Partial<ProfilerJob>): ProfilerJob {
  return {
    id: 'benchmark-job',
    kind: 'benchmark',
    status: 'cancelled',
    label: 'Benchmark all approved local models',
    completed: 2,
    total: 5,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:05:00.000Z',
    ...overrides
  }
}

describe('benchmark continuation', () => {
  it('offers to continue only when the latest benchmark did not finish', () => {
    const incomplete = job({})

    expect(latestIncompleteBenchmark([incomplete])).toBe(incomplete)
    expect(latestIncompleteBenchmark([job({ status: 'completed', completed: 5 })])).toBeUndefined()
    expect(
      latestIncompleteBenchmark([
        job({ id: 'latest', status: 'completed', completed: 5 }),
        incomplete
      ])
    ).toBeUndefined()
  })

  it('describes the unfinished benchmark before requesting a decision', () => {
    const prompt = benchmarkContinuationPrompt(job({}))

    expect(prompt).toContain('stopped after 2 of 5 servers')
    expect(prompt).toContain('Continue where it left off?')
  })

  it('asks only for an incomplete latest run and returns the decision', async () => {
    const requested: ProfilerJob[] = []
    const requestDecision = async (incomplete: ProfilerJob) => {
      requested.push(incomplete)
      return 'cancel' as const
    }

    await expect(
      decideBenchmarkContinuation([job({})], requestDecision)
    ).resolves.toBe('cancel')
    expect(requested).toHaveLength(1)
    await expect(
      decideBenchmarkContinuation(
        [job({ status: 'completed', completed: 5 })],
        requestDecision
      )
    ).resolves.toBe('start-over')
    expect(requested).toHaveLength(1)
  })
})
