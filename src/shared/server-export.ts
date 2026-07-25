import type { ServerRecord } from './types.js'

const PRODUCT_NAME = 'Ollama Profiler'

export function createServerExportCsv(
  servers: ServerRecord[],
  modelName?: string
): string {
  const speedHeading = modelName ? `TPS (${modelName})` : 'Best TPS'
  const rows = [
    ['Endpoint', 'Region', speedHeading],
    ...servers.map((server) => [
      server.endpoint,
      [server.city, server.country].filter(Boolean).join(', '),
      formatExportSpeed(speedForExport(server, modelName))
    ])
  ]
  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}\r\n`
}

export function createServerExportFileName(
  modelName?: string,
  date = new Date()
): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
  const modelPart = modelName ? ` - ${safeFilePart(modelName)}` : ''
  return `${PRODUCT_NAME}${modelPart} - ${datePart}.csv`
}

export function speedForExport(
  server: ServerRecord,
  modelName?: string
): number | undefined {
  const installedModels = server.models.filter((model) => model.installed)
  if (modelName) {
    const normalizedName = modelName.trim().toLowerCase()
    return installedModels
      .find((model) => model.name.toLowerCase() === normalizedName)
      ?.benchmarks.find((result) => result.status === 'success')
      ?.tokensPerSecond
  }
  const speeds = installedModels
    .map(
      (model) =>
        model.benchmarks.find((result) => result.status === 'success')
          ?.tokensPerSecond
    )
    .filter((value): value is number => value !== undefined)
  return speeds.length > 0 ? Math.max(...speeds) : undefined
}

function formatExportSpeed(value?: number): string {
  return value === undefined ? '' : value.toFixed(1)
}

function escapeCsvCell(value: string): string {
  const safeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safeValue.replaceAll('"', '""')}"`
}

function safeFilePart(value: string): string {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/-+/g, '-')
      .replace(/^[ .-]+|[ .-]+$/g, '') || 'model'
  )
}
