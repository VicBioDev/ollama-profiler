import { describe, expect, it } from 'vitest'
import {
  KeyedSerialExecutor,
  runWithConcurrency
} from '@main/services/concurrency.js'

describe('concurrency controls', () => {
  it('caps work across different servers', async () => {
    let active = 0
    let maximum = 0

    await runWithConcurrency([1, 2, 3, 4, 5, 6], 3, async () => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    })

    expect(maximum).toBe(3)
  })

  it('serializes operations with the same server key while allowing other keys', async () => {
    const executor = new KeyedSerialExecutor()
    const activeByKey = new Map<string, number>()
    const overlapByKey = new Map<string, number>()
    let globalMaximum = 0
    let globalActive = 0

    const operation = (key: string): Promise<void> =>
      executor.run(key, async () => {
        const keyedActive = (activeByKey.get(key) ?? 0) + 1
        activeByKey.set(key, keyedActive)
        overlapByKey.set(key, Math.max(overlapByKey.get(key) ?? 0, keyedActive))
        globalActive += 1
        globalMaximum = Math.max(globalMaximum, globalActive)
        await new Promise((resolve) => setTimeout(resolve, 8))
        activeByKey.set(key, keyedActive - 1)
        globalActive -= 1
      })

    await Promise.all([
      operation('server-a'),
      operation('server-a'),
      operation('server-b'),
      operation('server-b')
    ])

    expect(overlapByKey.get('server-a')).toBe(1)
    expect(overlapByKey.get('server-b')).toBe(1)
    expect(globalMaximum).toBe(2)
  })
})
