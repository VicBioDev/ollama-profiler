import { isCloudModelName } from './model-utils.js'
import type { ServerExportFormat, ServerRecord } from './types.js'

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
  date = new Date(),
  format: ServerExportFormat = 'csv'
): string {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
  if (format === 'sub2api') {
    return `${PRODUCT_NAME} - Sub2API - ${datePart}.json`
  }
  const modelPart = modelName ? ` - ${safeFilePart(modelName)}` : ''
  return `${PRODUCT_NAME}${modelPart} - ${datePart}.csv`
}

export function createSub2ApiExportJson(
  servers: ServerRecord[],
  exportedAt = new Date()
): string {
  return `${JSON.stringify(
    {
      exported_at: formatSub2ApiTimestamp(exportedAt),
      proxies: [],
      accounts: servers.map(createSub2ApiAccount)
    },
    null,
    2
  )}\n`
}

export function serverNodeAddress(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '')
}

function createSub2ApiAccount(server: ServerRecord) {
  const address = serverNodeAddress(server.endpoint)
  return {
    name: address,
    platform: 'openai',
    type: 'apikey',
    credentials: {
      api_key: address,
      base_url: `${address}/`,
      model_mapping: sub2ApiModelMapping(server)
    },
    extra: {
      openai_apikey_responses_websockets_v2_enabled: false,
      openai_apikey_responses_websockets_v2_mode: 'off',
      openai_long_context_billing_enabled: false
    },
    concurrency: 1,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: true
  }
}

function sub2ApiModelMapping(server: ServerRecord): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const name of server.models
    .filter((model) => model.installed && !isCloudModelName(model.name))
    .map((model) => model.name)
    .sort((left, right) => left.localeCompare(right))) {
    mapping[name] = name
  }
  return mapping
}

function formatSub2ApiTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
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
