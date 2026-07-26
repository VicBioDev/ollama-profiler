import type { BenchmarkResult, ServerModel, ServerRecord } from '@shared/types'

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function formatDate(value?: string): string {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function formatRelative(value?: string): string {
  if (!value) return 'Never'
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000)
  const absolute = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absolute < 60) return formatter.format(seconds, 'second')
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), 'hour')
  return formatter.format(Math.round(seconds / 86400), 'day')
}

export function formatSpeed(value?: number): string {
  return value === undefined ? '—' : `${value.toFixed(1)} tok/s`
}

export function formatDuration(value?: number): string {
  return value === undefined ? '—' : `${Math.round(value)} ms`
}

export function latestAttempt(model: ServerModel): BenchmarkResult | undefined {
  return model.benchmarks[0]
}

export function latestSuccess(model: ServerModel): BenchmarkResult | undefined {
  return model.benchmarks.find((result) => result.status === 'success')
}

export function bestServerModel(server: ServerRecord): ServerModel | undefined {
  return server.models
    .filter((model) => model.installed)
    .reduce<ServerModel | undefined>((best, model) => {
      const speed = latestSuccess(model)?.tokensPerSecond
      if (speed === undefined) return best
      const bestSpeed = best ? latestSuccess(best)?.tokensPerSecond : undefined
      return bestSpeed === undefined || speed > bestSpeed ? model : best
    }, undefined)
}

export function bestServerSpeed(server: ServerRecord): number | undefined {
  const model = bestServerModel(server)
  return model ? latestSuccess(model)?.tokensPerSecond : undefined
}

export function serverModelSpeed(
  server: ServerRecord,
  modelName: string
): number | undefined {
  const normalizedName = modelName.trim().toLowerCase()
  const model = server.models.find(
    (candidate) =>
      candidate.installed &&
      candidate.name.toLowerCase() === normalizedName
  )
  return model ? latestSuccess(model)?.tokensPerSecond : undefined
}

export function installedModels(server: ServerRecord): ServerModel[] {
  return server.models.filter((model) => model.installed)
}
