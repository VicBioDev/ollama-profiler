import { networkInterfaces } from 'node:os'
import type { AppSettings } from '@shared/types.js'
import { runWithConcurrency } from './concurrency.js'
import { OllamaClient } from './ollama-client.js'

const OLLAMA_PORT = 11434
const DEFAULT_MAX_NETWORKS = 4
const DEFAULT_MAX_TARGETS = 1_024
const MIN_DISCOVERY_CONCURRENCY = 16
const MAX_DISCOVERY_CONCURRENCY = 48

export interface NetworkInterfaceAddress {
  address: string
  netmask: string
  family: string | number
  internal: boolean
}

export type NetworkInterfaceSnapshot = Record<
  string,
  readonly NetworkInterfaceAddress[] | undefined
>

export interface LanNetwork {
  interfaceName: string
  cidr: string
  address: string
}

export interface LanTarget {
  endpoint: string
  ip: string
  network: string
}

export interface LanScanPlan {
  networks: LanNetwork[]
  targets: LanTarget[]
  selfAddresses: string[]
}

export interface DiscoveredOllamaEndpoint extends LanTarget {
  version: string
}

export type OllamaEndpointProbe = (endpoint: string) => Promise<string>
export type DiscoveryProgress = (completed: number, total: number) => Promise<void> | void

interface LanScanOptions {
  maxNetworks?: number
  maxTargets?: number
}

export function createLanScanPlan(
  interfaces: NetworkInterfaceSnapshot = networkInterfaces() as NetworkInterfaceSnapshot,
  options: LanScanOptions = {}
): LanScanPlan {
  const maxNetworks = clamp(options.maxNetworks ?? DEFAULT_MAX_NETWORKS, 1, 16)
  const maxTargets = clamp(options.maxTargets ?? DEFAULT_MAX_TARGETS, 1, 4_096)
  const selfAddresses = new Set<string>()
  const candidates: Array<LanNetwork & { networkValue: number; broadcastValue: number }> = []
  const seenNetworks = new Set<string>()

  for (const [interfaceName, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (
        address.internal ||
        (address.family !== 'IPv4' && address.family !== 4) ||
        !isPrivateIpv4(address.address)
      ) {
        continue
      }
      selfAddresses.add(address.address)
      const addressValue = ipv4ToNumber(address.address)
      const prefix = netmaskPrefix(address.netmask)
      if (addressValue === undefined || prefix === undefined) continue

      // Never probe more than the /24 containing this interface. Smaller real
      // subnets remain smaller; larger enterprise networks stay bounded.
      const effectivePrefix = Math.max(24, prefix)
      if (effectivePrefix >= 31) continue
      const mask = maskFromPrefix(effectivePrefix)
      const networkValue = (addressValue & mask) >>> 0
      const broadcastValue = (networkValue | (~mask >>> 0)) >>> 0
      const cidr = `${numberToIpv4(networkValue)}/${effectivePrefix}`
      if (seenNetworks.has(cidr)) continue
      seenNetworks.add(cidr)
      candidates.push({
        interfaceName,
        cidr,
        address: address.address,
        networkValue,
        broadcastValue
      })
    }
  }

  candidates.sort((left, right) => {
    const addressOrder = privateAddressPriority(left.address) - privateAddressPriority(right.address)
    return addressOrder || left.interfaceName.localeCompare(right.interfaceName)
  })

  const targets: LanTarget[] = []
  const networks: LanNetwork[] = []
  for (const candidate of candidates.slice(0, maxNetworks)) {
    if (targets.length >= maxTargets) break
    networks.push({
      interfaceName: candidate.interfaceName,
      cidr: candidate.cidr,
      address: candidate.address
    })
    for (
      let value = candidate.networkValue + 1;
      value < candidate.broadcastValue && targets.length < maxTargets;
      value += 1
    ) {
      const ip = numberToIpv4(value)
      targets.push({
        endpoint: `http://${ip}:${OLLAMA_PORT}`,
        ip,
        network: candidate.cidr
      })
    }
  }

  return {
    networks,
    targets,
    selfAddresses: [...selfAddresses]
  }
}

export async function discoverLanOllama(
  plan: LanScanPlan,
  settings: AppSettings,
  onProgress?: DiscoveryProgress,
  probe: OllamaEndpointProbe = createDiscoveryProbe(settings)
): Promise<DiscoveredOllamaEndpoint[]> {
  const discovered: DiscoveredOllamaEndpoint[] = []
  let completed = 0
  const concurrency = clamp(
    settings.scanConcurrency * 4,
    MIN_DISCOVERY_CONCURRENCY,
    MAX_DISCOVERY_CONCURRENCY
  )

  await runWithConcurrency(plan.targets, concurrency, async (target) => {
    try {
      const version = await probe(target.endpoint)
      discovered.push({ ...target, version })
    } catch {
      // A closed port or non-Ollama response is the expected result for most hosts.
    } finally {
      completed += 1
      await onProgress?.(completed, plan.targets.length)
    }
  })

  return discovered.sort((left, right) => left.ip.localeCompare(right.ip, undefined, {
    numeric: true
  }))
}

export async function discoverLocalhostOllama(
  settings: AppSettings,
  onProgress?: DiscoveryProgress,
  probe: OllamaEndpointProbe = createDiscoveryProbe(settings)
): Promise<DiscoveredOllamaEndpoint[]> {
  const targets: LanTarget[] = [
    {
      endpoint: `http://127.0.0.1:${OLLAMA_PORT}`,
      ip: '127.0.0.1',
      network: 'localhost'
    },
    {
      endpoint: `http://[::1]:${OLLAMA_PORT}`,
      ip: '::1',
      network: 'localhost'
    }
  ]

  for (const [index, target] of targets.entries()) {
    try {
      const version = await probe(target.endpoint)
      await onProgress?.(index + 1, targets.length)
      return [{ ...target, version }]
    } catch {
      await onProgress?.(index + 1, targets.length)
    }
  }
  return []
}

function createDiscoveryProbe(settings: AppSettings): OllamaEndpointProbe {
  const discoverySettings: AppSettings = {
    ...settings,
    connectTimeoutMs: Math.min(settings.connectTimeoutMs, 800),
    requestTimeoutMs: Math.min(settings.requestTimeoutMs, 1_500),
    maxResponseBytes: Math.min(settings.maxResponseBytes, 64 * 1024),
    allowPrivateNetworks: true
  }
  return async (endpoint) => new OllamaClient(endpoint, discoverySettings).probeVersion()
}

export function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address)
  if (!octets) return false
  const [a = 0, b = 0] = octets
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function privateAddressPriority(address: string): number {
  if (address.startsWith('192.168.')) return 0
  if (address.startsWith('10.')) return 1
  return 2
}

function netmaskPrefix(netmask: string): number | undefined {
  const octets = parseIpv4(netmask)
  if (!octets) return undefined
  const bits = octets.map((octet) => octet.toString(2).padStart(8, '0')).join('')
  if (!/^1*0*$/.test(bits)) return undefined
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0')
}

function maskFromPrefix(prefix: number): number {
  if (prefix <= 0) return 0
  return (0xffffffff << (32 - prefix)) >>> 0
}

function ipv4ToNumber(address: string): number | undefined {
  const octets = parseIpv4(address)
  if (!octets) return undefined
  return octets.reduce((value, octet) => value * 256 + octet, 0) >>> 0
}

function numberToIpv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255
  ].join('.')
}

function parseIpv4(address: string): number[] | undefined {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return undefined
  }
  return octets
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)))
}
