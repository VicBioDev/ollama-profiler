import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http, { type IncomingMessage, type RequestOptions } from 'node:http'
import https from 'node:https'
import { performance } from 'node:perf_hooks'
import type { AppSettings, BenchmarkResult } from '@shared/types.js'

export class OllamaClientError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OllamaClientError'
  }
}

interface ResolvedTarget {
  address: string
  family: 4 | 6
}

interface RawRequestOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  connectTimeoutMs: number
  timeoutMs: number
  maxBytes: number
  allowPrivateNetworks: boolean
}

interface OllamaTag {
  name?: string
  model?: string
  digest?: string
  size?: number
  modified_at?: string
  details?: {
    family?: string
    parameter_size?: string
    quantization_level?: string
  }
}

export interface OllamaModelDetails {
  name: string
  digest?: string
  sizeBytes?: number
  family?: string
  parameterSize?: string
  quantization?: string
  capabilities: string[]
}

export interface OllamaInventory {
  version: string
  models: OllamaModelDetails[]
}

export class OllamaClient {
  constructor(
    private readonly endpoint: string,
    private readonly settings: AppSettings
  ) {}

  async probeVersion(): Promise<string> {
    const versionPayload = await this.requestJson('/api/version')
    const version = stringValue(versionPayload.version)
    if (!version) throw new OllamaClientError('invalid_version', 'Ollama did not return a version')
    return version
  }

  async inventory(): Promise<OllamaInventory> {
    const version = await this.probeVersion()

    const tagsPayload = await this.requestJson('/api/tags')
    if (!Array.isArray(tagsPayload.models)) {
      throw new OllamaClientError('invalid_tags', 'Ollama did not return a model list')
    }

    const models: OllamaModelDetails[] = []
    for (const rawTag of tagsPayload.models) {
      if (!isObject(rawTag)) continue
      const tag = rawTag as OllamaTag
      const name = stringValue(tag.name ?? tag.model)
      if (!name || name.length > 512 || name.includes('\0')) continue
      let show: Record<string, unknown> = {}
      try {
        show = await this.requestJson('/api/show', {
          model: name,
          verbose: false
        })
      } catch (error) {
        if (error instanceof OllamaClientError && error.code === 'http_404') {
          continue
        }
      }
      const details = isObject(show.details) ? show.details : {}
      const capabilities = Array.isArray(show.capabilities)
        ? show.capabilities.filter((value): value is string => typeof value === 'string')
        : []
      models.push({
        name,
        digest: stringValue(tag.digest),
        sizeBytes: positiveNumber(tag.size),
        family: stringValue(details.family ?? tag.details?.family),
        parameterSize: stringValue(details.parameter_size ?? tag.details?.parameter_size),
        quantization: stringValue(
          details.quantization_level ?? tag.details?.quantization_level
        ),
        capabilities
      })
    }
    return { version, models }
  }

  async benchmark(model: string): Promise<BenchmarkResult> {
    if (!model || model.length > 512 || model.includes('\0')) {
      throw new OllamaClientError('invalid_model', 'Invalid model name')
    }
    const startedAt = new Date().toISOString()
    const started = performance.now()
    let firstTokenAt: number | undefined
    let finalEvent: Record<string, unknown> | undefined

    await this.requestStream(
      '/api/generate',
      {
        model,
        prompt: this.settings.benchmarkPrompt,
        stream: true,
        keep_alive: 0,
        options: {
          temperature: 0,
          num_predict: this.settings.benchmarkNumPredict
        }
      },
      (event) => {
        if (event.error) {
          throw new OllamaClientError('ollama_error', String(event.error))
        }
        if (
          firstTokenAt === undefined &&
          (stringValue(event.response) || stringValue(event.thinking))
        ) {
          firstTokenAt = performance.now()
        }
        if (event.done === true) finalEvent = event
      }
    )

    const finished = performance.now()
    if (!finalEvent) {
      throw new OllamaClientError(
        'incomplete_stream',
        'Benchmark stream ended without final metrics'
      )
    }
    const evalCount = positiveInteger(finalEvent.eval_count)
    const evalDurationNs = positiveInteger(finalEvent.eval_duration)
    if (!evalCount || !evalDurationNs) {
      throw new OllamaClientError('missing_metrics', 'Benchmark response has no usage metrics')
    }
    if (evalCount < this.settings.benchmarkMinTokens) {
      throw new OllamaClientError(
        'insufficient_tokens',
        `Only ${evalCount} generated tokens were returned`
      )
    }

    return {
      id: crypto.randomUUID(),
      status: 'success',
      startedAt,
      finishedAt: new Date().toISOString(),
      tokensPerSecond: calculateTokensPerSecond(evalCount, evalDurationNs),
      ttftMs: firstTokenAt === undefined ? undefined : firstTokenAt - started,
      clientTotalMs: finished - started,
      evalCount,
      evalDurationNs,
      promptEvalCount: positiveInteger(finalEvent.prompt_eval_count),
      promptEvalDurationNs: positiveInteger(finalEvent.prompt_eval_duration),
      loadDurationNs: positiveInteger(finalEvent.load_duration),
      totalDurationNs: positiveInteger(finalEvent.total_duration),
      doneReason: stringValue(finalEvent.done_reason)
    }
  }

  private async requestJson(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const buffer = await requestBuffer(new URL(path, `${this.endpoint}/`), {
      method: body === undefined ? 'GET' : 'POST',
      body,
      connectTimeoutMs: this.settings.connectTimeoutMs,
      timeoutMs: this.settings.requestTimeoutMs,
      maxBytes: this.settings.maxResponseBytes,
      allowPrivateNetworks: this.settings.allowPrivateNetworks
    })
    try {
      const parsed = JSON.parse(buffer.toString('utf8')) as unknown
      if (!isObject(parsed)) throw new Error('JSON response is not an object')
      return parsed
    } catch (error) {
      throw new OllamaClientError(
        'invalid_json',
        error instanceof Error ? error.message : 'Ollama returned invalid JSON'
      )
    }
  }

  private async requestStream(
    path: string,
    body: unknown,
    onEvent: (event: Record<string, unknown>) => void
  ): Promise<void> {
    const target = new URL(path, `${this.endpoint}/`)
    const resolved = await resolveTarget(
      target.hostname,
      this.settings.allowPrivateNetworks
    )
    await new Promise<void>((resolve, reject) => {
      let totalBytes = 0
      let pending = ''
      const request = createRequest(
        target,
        resolved,
        {
          method: 'POST',
          connectTimeoutMs: this.settings.connectTimeoutMs,
          timeoutMs: this.settings.benchmarkTimeoutMs,
          body,
          maxBytes: this.settings.maxResponseBytes,
          allowPrivateNetworks: this.settings.allowPrivateNetworks
        },
        (response) => {
          try {
            verifyResponse(response, resolved)
            ensureSuccess(response)
          } catch (error) {
            response.resume()
            reject(error)
            return
          }
          response.setEncoding('utf8')
          response.on('data', (chunk: string) => {
            try {
              totalBytes += Buffer.byteLength(chunk)
              if (totalBytes > this.settings.maxResponseBytes) {
                throw new OllamaClientError(
                  'response_too_large',
                  'Benchmark response exceeded the size limit'
                )
              }
              pending += chunk
              const lines = pending.split(/\r?\n/)
              pending = lines.pop() ?? ''
              for (const line of lines) {
                if (!line.trim()) continue
                const event = JSON.parse(line) as unknown
                if (!isObject(event)) {
                  throw new Error('Stream event is not a JSON object')
                }
                onEvent(event)
              }
            } catch (error) {
              request.destroy()
              reject(
                error instanceof OllamaClientError
                  ? error
                  : new OllamaClientError('invalid_stream', 'Malformed benchmark stream')
              )
            }
          })
          response.on('end', () => {
            if (pending.trim()) {
              try {
                const event = JSON.parse(pending) as unknown
                if (isObject(event)) onEvent(event)
              } catch {
                reject(new OllamaClientError('invalid_stream', 'Malformed benchmark stream'))
                return
              }
            }
            resolve()
          })
          response.on('error', reject)
        }
      )
      request.on('error', (error) => reject(normalizeNetworkError(error)))
      writeBodyAndEnd(request, body)
    })
  }
}

export function calculateTokensPerSecond(evalCount: number, evalDurationNs: number): number {
  if (evalCount <= 0 || evalDurationNs <= 0) {
    throw new Error('Token count and evaluation duration must be positive')
  }
  return (evalCount * 1_000_000_000) / evalDurationNs
}

async function requestBuffer(
  target: URL,
  options: RawRequestOptions
): Promise<Buffer> {
  const resolved = await resolveTarget(target.hostname, options.allowPrivateNetworks)
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    const request = createRequest(target, resolved, options, (response) => {
      try {
        verifyResponse(response, resolved)
        ensureSuccess(response)
      } catch (error) {
        response.resume()
        reject(error)
        return
      }
      response.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > options.maxBytes) {
          request.destroy()
          reject(
            new OllamaClientError('response_too_large', 'Response exceeded the size limit')
          )
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.on('end', () => resolve(Buffer.concat(chunks)))
      response.on('error', reject)
    })
    request.on('error', (error) => reject(normalizeNetworkError(error)))
    writeBodyAndEnd(request, options.body)
  })
}

function createRequest(
  target: URL,
  resolved: ResolvedTarget,
  options: RawRequestOptions,
  onResponse: (response: IncomingMessage) => void
): http.ClientRequest {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body)
  const requestOptions: RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'OllamaProfiler/0.1',
      Connection: 'close',
      ...(payload
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        : {})
    },
    lookup: (_hostname, _lookupOptions, callback): void => {
      callback(null, resolved.address, resolved.family)
    }
  }
  const request =
    target.protocol === 'https:'
      ? https.request(requestOptions, onResponse)
      : http.request(requestOptions, onResponse)
  let connectTimer: NodeJS.Timeout | undefined
  const clearConnectTimer = (): void => {
    if (connectTimer) clearTimeout(connectTimer)
    connectTimer = undefined
  }
  request.on('socket', (socket) => {
    if (!socket.connecting) return
    connectTimer = setTimeout(() => {
      request.destroy(
        new OllamaClientError('connect_timeout', 'Ollama connection timed out')
      )
    }, options.connectTimeoutMs)
    socket.once(target.protocol === 'https:' ? 'secureConnect' : 'connect', clearConnectTimer)
    socket.once('error', clearConnectTimer)
  })
  request.once('response', clearConnectTimer)
  request.once('error', clearConnectTimer)
  request.once('close', clearConnectTimer)
  request.setTimeout(options.timeoutMs, () => {
    request.destroy(new OllamaClientError('timeout', 'Ollama request timed out'))
  })
  return request
}

function writeBodyAndEnd(request: http.ClientRequest, body: unknown): void {
  if (body !== undefined) request.write(JSON.stringify(body))
  request.end()
}

async function resolveTarget(
  hostname: string,
  allowPrivateNetworks: boolean
): Promise<ResolvedTarget> {
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (addresses.length === 0) {
    throw new OllamaClientError('dns_error', 'DNS resolution returned no addresses')
  }
  const candidate = addresses.find((address) =>
    isAddressAllowed(address.address, allowPrivateNetworks)
  )
  if (!candidate) {
    throw new OllamaClientError(
      'blocked_address',
      'Target resolved only to blocked or unsafe addresses'
    )
  }
  return {
    address: normalizeAddress(candidate.address),
    family: candidate.family as 4 | 6
  }
}

export function isAddressAllowed(address: string, allowPrivateNetworks: boolean): boolean {
  const normalized = normalizeAddress(address).toLowerCase()
  if (
    normalized === '169.254.169.254' ||
    normalized === '100.100.100.200' ||
    normalized === 'fd00:ec2::254' ||
    normalized === 'metadata.google.internal'
  ) {
    return false
  }
  if (normalized.includes(':')) {
    const firstHextet = Number.parseInt(normalized.split(':', 1)[0] || '0', 16)
    if (
      normalized === '::' ||
      (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) ||
      firstHextet >= 0xff00
    ) {
      return false
    }
    const isUniqueLocal = (firstHextet & 0xfe00) === 0xfc00
    if (!allowPrivateNetworks && (normalized === '::1' || isUniqueLocal)) {
      return false
    }
    return true
  }
  const octets = normalized.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    return false
  }
  const [a = 0, b = 0] = octets
  if (a === 0 || a >= 224 || (a === 169 && b === 254)) return false
  if (
    !allowPrivateNetworks &&
    (a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127))
  ) {
    return false
  }
  return true
}

function verifyResponse(response: IncomingMessage, resolved: ResolvedTarget): void {
  const peer = normalizeAddress(response.socket.remoteAddress ?? '')
  if (!peer || peer !== normalizeAddress(resolved.address)) {
    throw new OllamaClientError(
      'dns_rebinding',
      'Connected peer differs from the validated DNS address'
    )
  }
}

function ensureSuccess(response: IncomingMessage): void {
  const status = response.statusCode ?? 0
  if (status >= 300 && status < 400) {
    throw new OllamaClientError('redirect_blocked', 'HTTP redirects are not allowed')
  }
  if (status !== 200) {
    throw new OllamaClientError(`http_${status}`, `Ollama returned HTTP ${status}`)
  }
}

function normalizeNetworkError(error: Error): OllamaClientError {
  if (error instanceof OllamaClientError) return error
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
    return new OllamaClientError('timeout', 'Ollama request timed out')
  }
  return new OllamaClientError('network_error', error.message)
}

function normalizeAddress(value: string): string {
  return value.replace(/^::ffff:/, '').split('%', 1)[0] ?? value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const result = Number(value)
  return Number.isFinite(result) && result > 0 ? result : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const result = Number(value)
  return Number.isSafeInteger(result) && result > 0 ? result : undefined
}
