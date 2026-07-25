import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  normalizeEndpoint,
  parseDiscoveryBuffer
} from '@main/services/importers.js'

describe('discovery importers', () => {
  it('parses and de-duplicates a FOFA CSV export', () => {
    const csv = [
      'host,ip,port,protocol,country_name,org',
      'ollama.example,203.0.113.10,11434,http,SG,"Example, Inc."',
      'ollama.example,203.0.113.10,11434,http,SG,"Example, Inc."'
    ].join('\n')

    const preview = parseDiscoveryBuffer(Buffer.from(csv), 'fofa.csv')

    expect(preview.provider).toBe('fofa')
    expect(preview.validRows).toBe(1)
    expect(preview.duplicateRows).toBe(1)
    expect(preview.candidates[0]?.endpoint).toBe('http://ollama.example:11434')
    expect(preview.candidates[0]?.organization).toBe('Example, Inc.')
  })

  it('parses a plain text endpoint list without consuming the first row as a header', () => {
    const preview = parseDiscoveryBuffer(
      Buffer.from('http://ollama-a.example:11434\nollama-b.example:11434\n'),
      'servers.txt'
    )

    expect(preview.issues).toEqual([])
    expect(preview).toMatchObject({ validRows: 2, invalidRows: 0 })
    expect(preview.candidates.map((candidate) => candidate.endpoint)).toEqual([
      'http://ollama-a.example:11434',
      'http://ollama-b.example:11434'
    ])
  })

  it('rejects ZIP-based workbooks with a safe export hint', () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])
    expect(() => parseDiscoveryBuffer(zipHeader, 'fofa.xlsx')).toThrow(
      'export the results as CSV or JSON'
    )
  })

  it('parses a Shodan compressed NDJSON export', () => {
    const rows = [
      JSON.stringify({
        ip_str: '198.51.100.25',
        port: 11434,
        org: 'Lab',
        location: { country_name: 'Singapore', city: 'Singapore' },
        timestamp: '2026-07-25T10:00:00Z',
        _shodan: { module: 'http' }
      }),
      JSON.stringify({
        ip_str: '198.51.100.26',
        port: 443,
        ssl: { cert: {} },
        location: { country_name: 'Japan' }
      })
    ].join('\n')

    const preview = parseDiscoveryBuffer(gzipSync(rows), 'shodan-results.json.gz')

    expect(preview.provider).toBe('shodan')
    expect(preview.validRows).toBe(2)
    expect(preview.candidates[0]).toMatchObject({
      endpoint: 'http://198.51.100.25:11434',
      source: 'shodan-file',
      organization: 'Lab'
    })
    expect(preview.candidates[1]?.endpoint).toBe('https://198.51.100.26:443')
  })

  it('normalizes IPv6 and removes paths and credentials', () => {
    expect(normalizeEndpoint('2001:db8::1', 11434)).toBe(
      'http://[2001:db8::1]:11434'
    )
    expect(normalizeEndpoint('https://example.com:8443/api/tags?q=x')).toBe(
      'https://example.com:8443'
    )
    expect(() => normalizeEndpoint('http://user:pass@example.com')).toThrow(
      'Credentials'
    )
  })
})
