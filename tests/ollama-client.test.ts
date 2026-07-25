import { createServer, type RequestListener, type Server } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@main/defaults.js'
import { OllamaClient } from '@main/services/ollama-client.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        })
    )
  )
})

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind')
  return `http://127.0.0.1:${address.port}`
}

describe('Ollama HTTP integration', () => {
  it('keeps usable tag metadata when show is protected and skips a removed model', async () => {
    const endpoint = await listen((request, response) => {
      if (request.url === '/api/version') {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ version: '0.12.3' }))
        return
      }
      if (request.url === '/api/tags') {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({
          models: [
            {
              name: 'qwen3:8b',
              digest: 'digest-a',
              details: {
                family: 'qwen3',
                parameter_size: '8.2B',
                quantization_level: 'Q4_K_M'
              }
            },
            { name: 'private-show:latest', details: { family: 'llama' } },
            { name: 'removed:latest' },
            { name: 'x'.repeat(513) }
          ]
        }))
        return
      }
      if (request.url === '/api/show') {
        let body = ''
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => {
          body += chunk
        })
        request.on('end', () => {
          const model = (JSON.parse(body) as { model: string }).model
          if (model === 'removed:latest') {
            response.statusCode = 404
            response.end(JSON.stringify({ error: 'not found' }))
          } else if (model === 'private-show:latest') {
            response.statusCode = 403
            response.end(JSON.stringify({ error: 'forbidden' }))
          } else {
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({
              capabilities: ['completion', 'tools'],
              details: { family: 'qwen3', parameter_size: '8.2B' }
            }))
          }
        })
        return
      }
      response.statusCode = 404
      response.end()
    })

    const inventory = await new OllamaClient(endpoint, DEFAULT_SETTINGS).inventory()

    expect(inventory.version).toBe('0.12.3')
    expect(inventory.models).toHaveLength(2)
    expect(inventory.models[0]).toMatchObject({
      name: 'qwen3:8b',
      family: 'qwen3',
      capabilities: ['completion', 'tools']
    })
    expect(inventory.models[1]).toMatchObject({
      name: 'private-show:latest',
      family: 'llama',
      capabilities: []
    })
  })

  it('parses streaming generation metrics using Ollama nanoseconds', async () => {
    const endpoint = await listen((request, response) => {
      if (request.url !== '/api/generate') {
        response.statusCode = 404
        response.end()
        return
      }
      response.setHeader('Content-Type', 'application/x-ndjson')
      response.write(`${JSON.stringify({ response: 'Hello', done: false })}\n`)
      response.end(`${JSON.stringify({
        response: '',
        done: true,
        done_reason: 'stop',
        eval_count: 64,
        eval_duration: 2_000_000_000,
        load_duration: 500_000_000,
        total_duration: 3_000_000_000
      })}\n`)
    })

    const result = await new OllamaClient(endpoint, DEFAULT_SETTINGS).benchmark('qwen3:8b')

    expect(result.status).toBe('success')
    expect(result.tokensPerSecond).toBe(32)
    expect(result.evalCount).toBe(64)
    expect(result.loadDurationNs).toBe(500_000_000)
    expect(result.ttftMs).toBeTypeOf('number')
  })

  it('rejects redirects instead of following them', async () => {
    const endpoint = await listen((_request, response) => {
      response.statusCode = 302
      response.setHeader('Location', 'http://127.0.0.1:1/private')
      response.end()
    })

    await expect(new OllamaClient(endpoint, DEFAULT_SETTINGS).inventory()).rejects.toMatchObject({
      code: 'redirect_blocked'
    })
  })

  it('rejects oversized and malformed streaming responses', async () => {
    const oversizedSettings = { ...DEFAULT_SETTINGS, maxResponseBytes: 64 * 1024 }
    const oversizedEndpoint = await listen((_request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ version: 'x'.repeat(70 * 1024) }))
    })
    await expect(
      new OllamaClient(oversizedEndpoint, oversizedSettings).inventory()
    ).rejects.toMatchObject({ code: 'response_too_large' })

    const malformedEndpoint = await listen((_request, response) => {
      response.setHeader('Content-Type', 'application/x-ndjson')
      response.end('{"response":"partial"}\nthis is not json\n')
    })
    await expect(
      new OllamaClient(malformedEndpoint, DEFAULT_SETTINGS).benchmark('qwen3:8b')
    ).rejects.toMatchObject({ code: 'invalid_stream' })
  })
})
