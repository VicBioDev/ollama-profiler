import { useEffect, useRef } from 'react'
import type { ProfilerSnapshot } from '@shared/types'
import {
  confirmBenchmarkContinuation,
  latestIncompleteBenchmark
} from '@shared/job-utils'

type BenchmarkConfirmation = Parameters<typeof confirmBenchmarkContinuation>[1]

export function useBenchmarkContinuationOnLaunch(
  snapshot: ProfilerSnapshot | undefined,
  confirm: BenchmarkConfirmation,
  profileAllServers: (resumeIncomplete?: boolean) => Promise<void>
): void {
  const checked = useRef(false)
  const profileAllServersRef = useRef(profileAllServers)
  profileAllServersRef.current = profileAllServers

  useEffect(() => {
    if (!snapshot || checked.current) return
    checked.current = true

    if (
      snapshot.servers.length === 0 ||
      !latestIncompleteBenchmark(snapshot.jobs)
    ) {
      return
    }

    void confirmBenchmarkContinuation(snapshot.jobs, confirm).then((resume) =>
      profileAllServersRef.current(resume)
    )
  }, [confirm, snapshot])
}
