// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BenchmarkContinuationDialog } from '@renderer/components/BenchmarkContinuationDialog.js'
import type { ProfilerJob } from '@shared/types.js'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('benchmark continuation dialog', () => {
  it('offers Continue, Start over, and a no-op Cancel choice', () => {
    const onDecision = vi.fn()
    act(() => {
      root.render(
        <BenchmarkContinuationDialog
          job={benchmarkJob()}
          onDecision={onDecision}
        />
      )
    })

    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('stopped after 2 of 5 servers')
    expect(dialog?.textContent).toContain(
      'Cancel closes this dialog without queuing benchmark recovery.'
    )
    expect(button('Cancel')).toBe(document.activeElement)

    act(() => button('Cancel').click())
    expect(onDecision).toHaveBeenCalledWith('cancel')

    act(() => button('Start over').click())
    expect(onDecision).toHaveBeenCalledWith('start-over')

    act(() => button('Continue').click())
    expect(onDecision).toHaveBeenCalledWith('continue')
  })

  it('treats Escape as Cancel', () => {
    const onDecision = vi.fn()
    act(() => {
      root.render(
        <BenchmarkContinuationDialog
          job={benchmarkJob()}
          onDecision={onDecision}
        />
      )
    })

    act(() => {
      container
        .querySelector('[role="dialog"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    })

    expect(onDecision).toHaveBeenCalledWith('cancel')
  })
})

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label
  )
  if (!match) throw new Error(`Missing ${label} button`)
  return match
}

function benchmarkJob(): ProfilerJob {
  return {
    id: 'benchmark-job',
    kind: 'benchmark',
    status: 'cancelled',
    label: 'Benchmark all approved local models',
    completed: 2,
    total: 5,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:05:00Z'
  }
}
