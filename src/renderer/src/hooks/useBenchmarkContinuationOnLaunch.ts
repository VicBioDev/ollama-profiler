import { useEffect, useRef } from 'react'
import type { ProfilerSnapshot } from '@shared/types'
import {
  decideBenchmarkContinuation,
  latestIncompleteBenchmark
} from '@shared/job-utils'

type BenchmarkDecisionRequest = Parameters<typeof decideBenchmarkContinuation>[1]

export function useBenchmarkContinuationOnLaunch(
  snapshot: ProfilerSnapshot | undefined,
  requestDecision: BenchmarkDecisionRequest,
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

    void decideBenchmarkContinuation(snapshot.jobs, requestDecision).then(
      (decision) => {
        if (decision !== 'cancel') {
          void profileAllServersRef.current(decision === 'continue')
        }
      }
    )
  }, [requestDecision, snapshot])
}
