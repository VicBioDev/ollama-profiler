import type { AppSettings } from './types.js'

export const DEFAULT_SETTINGS: AppSettings = {
  scanConcurrency: 8,
  benchmarkConcurrency: 8,
  connectTimeoutMs: 5_000,
  requestTimeoutMs: 15_000,
  benchmarkTimeoutMs: 120_000,
  maxResponseBytes: 1024 * 1024,
  benchmarkPrompt: 'Reply with a concise description of what an Ollama server does.',
  benchmarkNumPredict: 64,
  benchmarkMinTokens: 8,
  allowPrivateNetworks: true
}
