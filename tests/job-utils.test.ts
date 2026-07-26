import { describe, expect, it } from 'vitest'
import {
  BENCHMARK_CONTINUATION_DIALOG,
  benchmarkContinuationPrompt,
  confirmBenchmarkContinuation,
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

  it('labels the two choices as continue and start over', () => {
    const prompt = benchmarkContinuationPrompt(job({}))

    expect(prompt).toContain('stopped after 2 of 5 servers')
    expect(prompt).toContain('Continue where it left off?')
    expect(prompt).not.toContain('Cancel')
    expect(BENCHMARK_CONTINUATION_DIALOG.okLabel).toBe('Continue')
    expect(BENCHMARK_CONTINUATION_DIALOG.cancelLabel).toBe('Start over')
  })

  it('asks only for an incomplete latest run and returns the user choice', async () => {
    const prompts: string[] = []
    const options: unknown[] = []
    const confirm = async (message: string, dialogOptions: unknown): Promise<boolean> => {
      prompts.push(message)
      options.push(dialogOptions)
      return true
    }

    await expect(confirmBenchmarkContinuation([job({})], confirm)).resolves.toBe(true)
    expect(prompts).toHaveLength(1)
    expect(options).toEqual([BENCHMARK_CONTINUATION_DIALOG])
    await expect(
      confirmBenchmarkContinuation([job({ status: 'completed', completed: 5 })], confirm)
    ).resolves.toBe(false)
    expect(prompts).toHaveLength(1)
  })
})
