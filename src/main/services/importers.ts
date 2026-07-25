import { gunzipSync } from 'node:zlib'
import { extname, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import type {
  DiscoveryCandidate,
  DiscoverySource,
  ImportIssue,
  ImportPreview
} from '@shared/types.js'

type UnknownRow = Record<string, unknown>

interface ParseContext {
  filename: string
  sourceHint?: 'fofa' | 'shodan'
}

const ENDPOINT_KEYS = ['endpoint', 'link', 'url', 'address']
const IMPORT_HEADER_KEYS = new Set([
  ...ENDPOINT_KEYS,
  'host',
  'hostname',
  'domain',
  'ip',
  'ip_str',
  'port',
  'protocol',
  'scheme',
  'country',
  'country_name',
  'region',
  'city',
  'asn',
  'org',
  'organization'
])
const MAX_IMPORT_BYTES = 50 * 1024 * 1024
const MAX_CELL_LENGTH = 64 * 1024

export function parseDiscoveryBuffer(
  contents: Buffer,
  filename: string,
  sourceHint?: 'fofa' | 'shodan'
): ImportPreview {
  if (contents.length === 0) throw new Error('The selected file is empty')
  if (contents.length > MAX_IMPORT_BYTES) throw new Error('Import files are limited to 50 MiB')

  const context: ParseContext = { filename: basename(filename), sourceHint }
  const extension = extname(filename).toLowerCase()
  const uncompressed =
    extension === '.gz' || isGzip(contents)
      ? gunzipSync(contents, { maxOutputLength: MAX_IMPORT_BYTES })
      : contents
  if (isZip(uncompressed)) {
    throw new Error('XLSX is not supported; export the results as CSV or JSON')
  }
  const rows = readTextRows(uncompressed, context)

  return buildPreview(rows, context)
}

export function parseDiscoveryRows(
  rows: UnknownRow[],
  filename: string,
  sourceHint?: 'fofa' | 'shodan'
): ImportPreview {
  return buildPreview(rows, { filename, sourceHint })
}

function readTextRows(contents: Buffer, context: ParseContext): UnknownRow[] {
  const text = decodeText(contents).trim()
  if (!text) return []
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const payload = JSON.parse(text) as unknown
      return unpackJson(payload)
    } catch {
      const ndjson = readNdjson(text)
      if (ndjson.length > 0) return ndjson
      throw new Error('The JSON export is malformed')
    }
  }
  if (context.filename.toLowerCase().endsWith('.json.gz')) {
    return readNdjson(text)
  }
  return readDelimitedRows(text, context.filename)
}

function unpackJson(payload: unknown): UnknownRow[] {
  if (Array.isArray(payload)) {
    return payload.filter(isObject)
  }
  if (!isObject(payload)) return []
  if (Array.isArray(payload.matches)) return payload.matches.filter(isObject)
  if (Array.isArray(payload.results)) {
    const fields = normalizeFields(payload.fields)
    return payload.results.map((row) => {
      if (isObject(row)) return row
      if (Array.isArray(row)) {
        return Object.fromEntries(fields.map((field, index) => [field, row[index]]))
      }
      return {}
    })
  }
  if (Array.isArray(payload.data)) return payload.data.filter(isObject)
  return [payload]
}

function readNdjson(text: string): UnknownRow[] {
  const rows: UnknownRow[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line) as unknown
      if (isObject(value)) rows.push(value)
    } catch {
      return []
    }
  }
  return rows
}

function readDelimitedRows(text: string, filename: string): UnknownRow[] {
  const delimiter = filename.toLowerCase().endsWith('.tsv') || prefersTabs(text) ? '\t' : ','
  const records = parseDelimited(text, delimiter).filter((record) =>
    record.some((value) => value.trim())
  )
  const first = records[0]
  if (!first) return []

  const normalizedHeaders = first.map((value) =>
    value.trim().toLowerCase().replace(/[\s./-]+/g, '_').replace(/^_+|_+$/g, '')
  )
  const hasHeader = normalizedHeaders.some((value) => IMPORT_HEADER_KEYS.has(value))
  if (!hasHeader) {
    return records.map((record) => ({ endpoint: record[0] ?? '' }))
  }

  return records.slice(1).map((record) =>
    Object.fromEntries(normalizedHeaders.map((header, index) => [header, record[index] ?? '']))
  )
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  const pushField = (): void => {
    if (field.length > MAX_CELL_LENGTH) throw new Error('An import field exceeds 64 KiB')
    record.push(field)
    field = ''
  }
  const pushRecord = (): void => {
    pushField()
    records.push(record)
    record = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }
    if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === delimiter) {
      pushField()
    } else if (character === '\n') {
      pushRecord()
    } else if (character !== '\r') {
      field += character
    }
  }
  if (quoted) throw new Error('The delimited file contains an unterminated quoted field')
  if (field.length > 0 || record.length > 0) pushRecord()
  return records
}

function prefersTabs(text: string): boolean {
  const sample = text.slice(0, 8_192)
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? ''
  return (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0)
}

function buildPreview(rows: UnknownRow[], context: ParseContext): ImportPreview {
  if (rows.length === 0) throw new Error('No data rows were found in the selected file')
  if (rows.length > 20_000) throw new Error('Import files are limited to 20,000 rows')

  const provider = context.sourceHint ?? detectProvider(rows)
  const candidates = new Map<string, DiscoveryCandidate>()
  const issues: ImportIssue[] = []
  let duplicateRows = 0
  let invalidRows = 0

  rows.forEach((raw, index) => {
    try {
      const candidate =
        provider === 'shodan'
          ? normalizeShodanRow(raw)
          : normalizeGenericRow(raw, provider === 'fofa' ? 'fofa-file' : 'manual')
      if (candidates.has(candidate.endpoint)) {
        duplicateRows += 1
      } else {
        candidates.set(candidate.endpoint, candidate)
      }
    } catch (error) {
      invalidRows += 1
      if (issues.length < 100) {
        issues.push({
          row: index + 1,
          message: error instanceof Error ? error.message : 'Invalid row'
        })
      }
    }
  })

  return {
    id: randomUUID(),
    filename: context.filename,
    provider,
    totalRows: rows.length,
    validRows: candidates.size,
    duplicateRows,
    invalidRows,
    candidates: Array.from(candidates.values()),
    issues
  }
}

export function normalizeShodanRow(row: UnknownRow): DiscoveryCandidate {
  const normalized = normalizeKeys(row)
  const ip = text(normalized.ip_str ?? normalized.ip)
  const port = number(normalized.port)
  if (!ip || !port) throw new Error('Shodan row is missing ip_str or port')

  const location = isObject(row.location) ? normalizeKeys(row.location) : {}
  const shodan = isObject(row._shodan) ? normalizeKeys(row._shodan) : {}
  const moduleName = text(shodan.module).toLowerCase()
  const usesTls =
    isObject(row.ssl) ||
    moduleName.includes('https') ||
    moduleName.includes('ssl') ||
    moduleName.includes('tls') ||
    port === 443
  const endpoint = normalizeEndpoint(`${usesTls ? 'https' : 'http'}://${ip}:${port}`)

  return {
    endpoint,
    source: 'shodan-file',
    ip,
    country: optionalText(location.country_name ?? normalized.country_name),
    region: optionalText(location.region_code ?? normalized.region),
    city: optionalText(location.city ?? normalized.city),
    asn: optionalText(normalized.asn),
    organization: optionalText(normalized.org ?? normalized.organization ?? normalized.isp),
    sourceUpdatedAt: optionalIso(normalized.timestamp ?? normalized.last_update)
  }
}

function normalizeGenericRow(
  row: UnknownRow,
  source: DiscoverySource
): DiscoveryCandidate {
  const normalized = normalizeKeys(row)
  const explicitEndpoint = ENDPOINT_KEYS.map((key) => text(normalized[key])).find(Boolean)
  const hostValue = text(normalized.host ?? normalized.hostname ?? normalized.domain ?? normalized.ip)
  const port = number(normalized.port)
  const scheme = text(normalized.protocol ?? normalized.scheme).toLowerCase()
  let endpoint: string

  if (explicitEndpoint) {
    endpoint = normalizeEndpoint(explicitEndpoint, port, scheme)
  } else if (hostValue) {
    endpoint = normalizeEndpoint(hostValue, port, scheme)
  } else {
    throw new Error('Row has no endpoint, link, host, hostname, domain, or IP')
  }

  const parsed = new URL(endpoint)
  return {
    endpoint,
    source,
    ip: optionalText(normalized.ip) ?? (isIpLiteral(parsed.hostname) ? parsed.hostname : undefined),
    country: optionalText(normalized.country_name ?? normalized.country),
    region: optionalText(normalized.region ?? normalized.province),
    city: optionalText(normalized.city),
    asn: optionalText(normalized.asn),
    organization: optionalText(normalized.org ?? normalized.organization ?? normalized.isp),
    sourceUpdatedAt: optionalIso(
      normalized.lastupdatetime ?? normalized.last_update_time ?? normalized.updated_at
    )
  }
}

export function normalizeEndpoint(value: string, port?: number, scheme?: string): string {
  let candidate = value.trim()
  if (!candidate) throw new Error('Endpoint is empty')
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    const selectedScheme = scheme === 'https' || port === 443 ? 'https' : 'http'
    const host = candidate.includes(':') && !candidate.startsWith('[') && isIpLiteral(candidate)
      ? `[${candidate}]`
      : candidate
    candidate = `${selectedScheme}://${host}${port && !hasExplicitPort(host) ? `:${port}` : ''}`
  }
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new Error('Endpoint is not a valid URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Only HTTP and HTTPS Ollama endpoints are supported')
  }
  if (url.username || url.password) throw new Error('Credentials in endpoint URLs are not supported')
  url.pathname = ''
  url.search = ''
  url.hash = ''
  if (!url.port && port) url.port = String(port)
  const selectedPort = url.port || (url.protocol === 'https:' ? '443' : '80')
  const normalizedHost = url.hostname.replace(/^\[|\]$/g, '')
  const host = normalizedHost.includes(':') ? `[${normalizedHost}]` : normalizedHost
  return `${url.protocol}//${host}:${selectedPort}`
}

function detectProvider(rows: UnknownRow[]): 'fofa' | 'shodan' | 'generic' {
  const sample = rows.slice(0, 20)
  if (sample.some((row) => 'ip_str' in row || '_shodan' in row)) return 'shodan'
  if (
    sample.some((row) => {
      const keys = Object.keys(normalizeKeys(row))
      return keys.includes('lastupdatetime') || keys.includes('country_name') || keys.includes('link')
    })
  ) {
    return 'fofa'
  }
  return 'generic'
}

function normalizeKeys(row: UnknownRow): UnknownRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.trim().toLowerCase().replace(/[\s./-]+/g, '_').replace(/^_+|_+$/g, ''),
      value
    ])
  )
}

function normalizeFields(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((field) => field.trim())
  if (Array.isArray(value)) return value.map(String)
  return ['host', 'ip', 'port', 'protocol', 'country_name', 'region', 'city', 'asn', 'org']
}

function decodeText(contents: Buffer): string {
  const utf8 = contents.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8.replace(/^\uFEFF/, '')
  return new TextDecoder('gb18030').decode(contents).replace(/^\uFEFF/, '')
}

function isObject(value: unknown): value is UnknownRow {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function optionalText(value: unknown): string | undefined {
  const result = text(value)
  return result ? result.slice(0, 512) : undefined
}

function number(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined
}

function optionalIso(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

function isGzip(contents: Buffer): boolean {
  return contents[0] === 0x1f && contents[1] === 0x8b
}

function isZip(contents: Buffer): boolean {
  return contents.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
}

function hasExplicitPort(host: string): boolean {
  if (host.startsWith('[')) return /\]:\d+$/.test(host)
  return /:\d+$/.test(host)
}

function isIpLiteral(value: string): boolean {
  const plain = value.replace(/^\[|\]$/g, '')
  return isIP(plain) !== 0
}
