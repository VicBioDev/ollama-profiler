import { describe, expect, it } from 'vitest'
import {
  calculateTokensPerSecond,
  isAddressAllowed
} from '@main/services/ollama-client.js'

describe('benchmark metrics and network policy', () => {
  it('uses Ollama nanosecond durations for token speed', () => {
    expect(calculateTokensPerSecond(64, 2_000_000_000)).toBe(32)
  })

  it('always blocks metadata and link-local targets', () => {
    expect(isAddressAllowed('169.254.169.254', true)).toBe(false)
    expect(isAddressAllowed('100.100.100.200', true)).toBe(false)
    expect(isAddressAllowed('fd00:ec2::254', true)).toBe(false)
    expect(isAddressAllowed('169.254.1.10', true)).toBe(false)
    expect(isAddressAllowed('fe80::1', true)).toBe(false)
    expect(isAddressAllowed('ff02::1', true)).toBe(false)
    expect(isAddressAllowed('999.1.1.1', true)).toBe(false)
  })

  it('allows user-owned LAN nodes only when enabled', () => {
    expect(isAddressAllowed('192.168.1.20', true)).toBe(true)
    expect(isAddressAllowed('192.168.1.20', false)).toBe(false)
    expect(isAddressAllowed('127.0.0.1', true)).toBe(true)
    expect(isAddressAllowed('::1', false)).toBe(false)
    expect(isAddressAllowed('::1', true)).toBe(true)
    expect(isAddressAllowed('fc00::10', false)).toBe(false)
    expect(isAddressAllowed('fc00::10', true)).toBe(true)
    expect(isAddressAllowed('2001:db8::10', false)).toBe(true)
  })
})
