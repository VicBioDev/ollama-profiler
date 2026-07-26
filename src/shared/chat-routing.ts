import { isBenchmarkableLocalModel } from './model-utils.js'
import type {
  ChatModelTarget,
  ServerModel,
  ServerRecord
} from './types.js'

export interface ChatModelCandidate extends ChatModelTarget {
  endpoint: string
  tokensPerSecond?: number
}

export interface ChatModelChoice {
  name: string
  serverCount: number
  bestTokensPerSecond?: number
}

export interface ChatRoute {
  targets: ChatModelCandidate[]
}

interface CandidateGroup {
  name: string
  candidates: ChatModelCandidate[]
}

interface ScoredRoute {
  targets: ChatModelCandidate[]
  unknownSpeeds: number
  totalTokensPerSecond: number
}

export function buildChatModelCatalog(
  servers: readonly ServerRecord[]
): ChatModelChoice[] {
  return candidateGroups(servers)
    .map(({ name, candidates }) => ({
      name,
      serverCount: candidates.length,
      bestTokensPerSecond: candidates
        .map(({ tokensPerSecond }) => tokensPerSecond)
        .filter((value): value is number => value !== undefined)
        .sort((left, right) => right - left)[0]
    }))
    .sort(
      (left, right) =>
        (right.bestTokensPerSecond ?? -1) -
          (left.bestTokensPerSecond ?? -1) ||
        left.name.localeCompare(right.name)
    )
}

export function routeChatModels(
  servers: readonly ServerRecord[],
  selectedModelNames: readonly string[]
): ChatRoute | undefined {
  const normalizedSelections = selectedModelNames.map(normalizeModelName)
  if (
    normalizedSelections.length === 0 ||
    normalizedSelections.length > 4 ||
    new Set(normalizedSelections).size !== normalizedSelections.length
  ) {
    return undefined
  }

  const groupsByName = new Map(
    candidateGroups(servers).map((group) => [normalizeModelName(group.name), group])
  )
  const groups = normalizedSelections.map((name) => groupsByName.get(name))
  if (groups.some((group) => !group)) return undefined

  const orderedGroups = (groups as CandidateGroup[])
    .map((group, selectionIndex) => ({ ...group, selectionIndex }))
    .sort(
      (left, right) =>
        left.candidates.length - right.candidates.length ||
        left.selectionIndex - right.selectionIndex
    )
  let best: ScoredRoute | undefined

  const visit = (
    index: number,
    usedServers: Set<string>,
    targets: ChatModelCandidate[]
  ): void => {
    if (index === orderedGroups.length) {
      const route = scoreRoute(targets)
      if (!best || isBetterRoute(route, best)) best = route
      return
    }

    const group = orderedGroups[index]
    if (!group) return
    for (const candidate of group.candidates) {
      if (usedServers.has(candidate.serverId)) continue
      usedServers.add(candidate.serverId)
      targets.push(candidate)
      visit(index + 1, usedServers, targets)
      targets.pop()
      usedServers.delete(candidate.serverId)
    }
  }

  visit(0, new Set(), [])
  if (!best) return undefined

  const targetByName = new Map(
    best.targets.map((target) => [normalizeModelName(target.modelName), target])
  )
  return {
    targets: normalizedSelections.map((name) => targetByName.get(name)!)
  }
}

function candidateGroups(servers: readonly ServerRecord[]): CandidateGroup[] {
  const groups = new Map<string, CandidateGroup>()
  for (const server of servers) {
    if (server.status !== 'online' || !server.benchmarkApproved) continue
    for (const model of server.models) {
      if (!isBenchmarkableLocalModel(model)) continue
      const key = normalizeModelName(model.name)
      const existing = groups.get(key) ?? { name: model.name, candidates: [] }
      if (!existing.candidates.some(({ serverId }) => serverId === server.id)) {
        existing.candidates.push({
          serverId: server.id,
          endpoint: server.endpoint,
          modelName: model.name,
          tokensPerSecond: latestSuccessfulSpeed(model)
        })
      }
      groups.set(key, existing)
    }
  }

  return [...groups.values()].map((group) => ({
    ...group,
    candidates: group.candidates.sort(compareCandidates)
  }))
}

function latestSuccessfulSpeed(model: ServerModel): number | undefined {
  return model.benchmarks.find((result) => result.status === 'success')
    ?.tokensPerSecond
}

function compareCandidates(
  left: ChatModelCandidate,
  right: ChatModelCandidate
): number {
  return (
    (right.tokensPerSecond ?? -1) - (left.tokensPerSecond ?? -1) ||
    left.endpoint.localeCompare(right.endpoint)
  )
}

function scoreRoute(targets: ChatModelCandidate[]): ScoredRoute {
  return {
    targets: [...targets],
    unknownSpeeds: targets.filter(({ tokensPerSecond }) => tokensPerSecond === undefined)
      .length,
    totalTokensPerSecond: targets.reduce(
      (sum, { tokensPerSecond }) => sum + (tokensPerSecond ?? 0),
      0
    )
  }
}

function isBetterRoute(candidate: ScoredRoute, current: ScoredRoute): boolean {
  if (candidate.unknownSpeeds !== current.unknownSpeeds) {
    return candidate.unknownSpeeds < current.unknownSpeeds
  }
  if (candidate.totalTokensPerSecond !== current.totalTokensPerSecond) {
    return candidate.totalTokensPerSecond > current.totalTokensPerSecond
  }
  return routeKey(candidate.targets) < routeKey(current.targets)
}

function routeKey(targets: ChatModelCandidate[]): string {
  return targets
    .map(({ endpoint, modelName }) => `${modelName.toLowerCase()}@${endpoint}`)
    .sort()
    .join('|')
}

function normalizeModelName(name: string): string {
  return name.trim().toLowerCase()
}
