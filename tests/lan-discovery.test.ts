import { describe, expect, it } from 'vitest'
import type { AppSettings } from '@shared/types.js'
import {
  createLanScanPlan,
  discoverLanOllama,
  discoverLocalhostOllama,
  type LanScanPlan,
  type NetworkInterfaceSnapshot
} from '@main/services/lan-discovery.js'

const settings: AppSettings = {
  scanConcurrency: 8,
  benchmarkConcurrency: 4,
  connectTimeoutMs: 5_000,
  requestTimeoutMs: 15_000,
  benchmarkTimeoutMs: 120_000,
  maxResponseBytes: 1_048_576,
  benchmarkPrompt: 'Test prompt',
  benchmarkNumPredict: 64,
  benchmarkMinTokens: 8,
  allowPrivateNetworks: true
}

describe('local network discovery', () => {
  it('builds a bounded /24 plan from private active interfaces', () => {
    const interfaces: NetworkInterfaceSnapshot = {
      en0: [
        {
          address: '192.168.17.42',
          netmask: '255.255.0.0',
          family: 'IPv4',
          internal: false
        }
      ],
      public0: [
        {
          address: '203.0.113.8',
          netmask: '255.255.255.0',
          family: 'IPv4',
          internal: false
        }
      ],
      lo0: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          internal: true
        }
      ]
    }

    const plan = createLanScanPlan(interfaces)

    expect(plan.networks).toEqual([
      {
        interfaceName: 'en0',
        cidr: '192.168.17.0/24',
        address: '192.168.17.42'
      }
    ])
    expect(plan.targets).toHaveLength(254)
    expect(plan.targets[0]?.endpoint).toBe('http://192.168.17.1:11434')
    expect(plan.targets.at(-1)?.endpoint).toBe('http://192.168.17.254:11434')
    expect(plan.selfAddresses).toEqual(['192.168.17.42'])
  })

  it('deduplicates networks and respects the total target limit', () => {
    const interfaces: NetworkInterfaceSnapshot = {
      en0: [
        {
          address: '10.42.7.20',
          netmask: '255.255.0.0',
          family: 4,
          internal: false
        }
      ],
      en1: [
        {
          address: '10.42.7.30',
          netmask: '255.255.255.0',
          family: 'IPv4',
          internal: false
        }
      ]
    }

    const plan = createLanScanPlan(interfaces, { maxTargets: 20 })

    expect(plan.networks).toHaveLength(1)
    expect(plan.networks[0]?.cidr).toBe('10.42.7.0/24')
    expect(plan.targets).toHaveLength(20)
  })

  it('probes different hosts concurrently and keeps only valid Ollama responses', async () => {
    const plan: LanScanPlan = {
      networks: [{ interfaceName: 'en0', cidr: '192.168.1.0/24', address: '192.168.1.10' }],
      selfAddresses: ['192.168.1.10'],
      targets: [2, 3, 4, 5].map((last) => ({
        endpoint: `http://192.168.1.${last}:11434`,
        ip: `192.168.1.${last}`,
        network: '192.168.1.0/24'
      }))
    }
    let active = 0
    let maxActive = 0
    const progress: number[] = []

    const discovered = await discoverLanOllama(
      plan,
      settings,
      (completed) => {
        progress.push(completed)
      },
      async (endpoint) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        if (endpoint.endsWith('.3:11434') || endpoint.endsWith('.5:11434')) {
          return '0.12.3'
        }
        throw new Error('closed')
      }
    )

    expect(maxActive).toBeGreaterThan(1)
    expect(discovered.map((candidate) => candidate.ip)).toEqual([
      '192.168.1.3',
      '192.168.1.5'
    ])
    expect(progress.at(-1)).toBe(4)
  })

  it('stops the localhost fallback after the first valid loopback response', async () => {
    const calls: string[] = []
    const discovered = await discoverLocalhostOllama(
      settings,
      undefined,
      async (endpoint) => {
        calls.push(endpoint)
        return '0.12.3'
      }
    )

    expect(calls).toEqual(['http://127.0.0.1:11434'])
    expect(discovered[0]?.ip).toBe('127.0.0.1')
  })
})
