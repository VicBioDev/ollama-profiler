import type { ProfilerPatch, ProfilerSnapshot } from './types.js'

export function applyProfilerPatch(
  snapshot: ProfilerSnapshot,
  patch: ProfilerPatch
): ProfilerSnapshot {
  return {
    ...snapshot,
    servers: mergeById(snapshot.servers, patch.servers ?? []),
    jobs: mergeById(snapshot.jobs, patch.jobs ?? []),
    updatedAt: patch.updatedAt
  }
}

function mergeById<T extends { readonly id: string }>(current: T[], updates: T[]): T[] {
  if (updates.length === 0) return current
  const pending = new Map(updates.map((value) => [value.id, value]))
  const merged = current.map((value) => {
    const replacement = pending.get(value.id)
    pending.delete(value.id)
    return replacement ?? value
  })
  return pending.size === 0 ? merged : [...merged, ...pending.values()]
}
