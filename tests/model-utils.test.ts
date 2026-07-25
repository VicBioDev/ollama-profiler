import { describe, expect, it } from 'vitest'
import {
  isBenchmarkableLocalModel,
  isCloudModelName
} from '@shared/model-utils.js'

describe('cloud model detection', () => {
  it.each([
    'kimi-k2.7-code:cloud',
    'minimax-m2.7:cloud',
    'gpt-oss:120b-cloud',
    'deepseek-v3.1:671b-cloud'
  ])('detects %s as a cloud model', (name) => {
    expect(isCloudModelName(name)).toBe(true)
  })

  it.each([
    'llama3.1:8b',
    'qwen3.6:35b',
    'acme/cloud-model:latest',
    'cloud-research:7b'
  ])('keeps %s eligible as a locally run model', (name) => {
    expect(isCloudModelName(name)).toBe(false)
  })

  it('selects every installed local generation model and excludes unsupported models', () => {
    const base = {
      installed: true,
      capabilities: ['completion']
    }
    const models = [
      { ...base, name: 'llama3.1:8b' },
      { ...base, name: 'qwen3:32b' },
      { ...base, name: 'kimi-k2.7-code:cloud' },
      { ...base, name: 'nomic-embed-text:latest', capabilities: ['embedding'] },
      { ...base, name: 'removed:latest', installed: false }
    ]

    expect(models.filter(isBenchmarkableLocalModel).map((model) => model.name)).toEqual([
      'llama3.1:8b',
      'qwen3:32b'
    ])
  })
})
