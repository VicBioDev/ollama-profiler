import type { ServerModel } from './types.js'

export function isCloudModelName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  const tag = normalized.includes(':')
    ? normalized.slice(normalized.lastIndexOf(':') + 1)
    : normalized.slice(normalized.lastIndexOf('/') + 1)
  return (
    tag === 'cloud' ||
    tag.startsWith('cloud-') ||
    tag.endsWith('-cloud') ||
    tag.includes('-cloud-')
  )
}

export function isBenchmarkableLocalModel(
  model: Pick<ServerModel, 'capabilities' | 'installed' | 'name'>
): boolean {
  return (
    model.installed &&
    model.capabilities.includes('completion') &&
    !isCloudModelName(model.name)
  )
}
