import type { ProfilerJob } from './types.js'

export function latestIncompleteBenchmark(
  jobs: readonly ProfilerJob[]
): ProfilerJob | undefined {
  const latest = jobs.find((job) => job.kind === 'benchmark')
  return latest &&
    (latest.status === 'cancelled' || latest.status === 'failed') &&
    latest.completed < latest.total
    ? latest
    : undefined
}

export function benchmarkContinuationPrompt(job: ProfilerJob): string {
  return `The last benchmark stopped after ${job.completed} of ${job.total} servers. Continue where it left off?`
}

export type BenchmarkContinuationDecision =
  | 'continue'
  | 'start-over'
  | 'cancel'

export async function decideBenchmarkContinuation(
  jobs: readonly ProfilerJob[],
  requestDecision: (job: ProfilerJob) => Promise<BenchmarkContinuationDecision>
): Promise<BenchmarkContinuationDecision> {
  const incomplete = latestIncompleteBenchmark(jobs)
  return incomplete ? requestDecision(incomplete) : 'start-over'
}
