import { useMemo } from 'react'
import type { ProfilerJob, ProfilerSnapshot, ServerRecord } from '@shared/types'

export interface LocalDiscoveryState {
  readonly servers: ServerRecord[]
  readonly activeJob?: ProfilerJob
  readonly latestJob?: ProfilerJob
}

export function useLocalDiscovery(snapshot: ProfilerSnapshot): LocalDiscoveryState {
  return useMemo(() => {
    const jobs = snapshot.jobs.filter(
      (job) => job.kind === 'local-discovery' || job.kind === 'lan-discovery'
    )
    return {
      servers: snapshot.servers
        .filter(isLocalDiscoveryServer)
        .sort((left, right) => {
          const leftLocalhost = localSources(left).includes('localhost') ? 0 : 1
          const rightLocalhost = localSources(right).includes('localhost') ? 0 : 1
          return leftLocalhost - rightLocalhost || left.endpoint.localeCompare(right.endpoint)
        }),
      activeJob: jobs.find(
        (job) => job.status === 'queued' || job.status === 'running'
      ),
      latestJob: jobs[0]
    }
  }, [snapshot])
}

export function isLocalDiscoveryServer(server: ServerRecord): boolean {
  const sources = localSources(server)
  return sources.includes('localhost') || sources.includes('lan-scan')
}

function localSources(server: ServerRecord): NonNullable<ServerRecord['discoverySources']> {
  return server.discoverySources ?? [server.source]
}
