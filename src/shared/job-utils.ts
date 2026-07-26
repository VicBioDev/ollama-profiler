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

export const BENCHMARK_CONTINUATION_DIALOG = {
  title: 'Unfinished benchmark',
  kind: 'warning' as const,
  okLabel: 'Continue',
  cancelLabel: 'Start over'
}

export async function confirmBenchmarkContinuation(
  jobs: readonly ProfilerJob[],
  confirm: (
    message: string,
    options: typeof BENCHMARK_CONTINUATION_DIALOG
  ) => Promise<boolean>
): Promise<boolean> {
  const incomplete = latestIncompleteBenchmark(jobs)
  return incomplete
    ? confirm(benchmarkContinuationPrompt(incomplete), BENCHMARK_CONTINUATION_DIALOG)
    : false
}
