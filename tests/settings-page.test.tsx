// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/defaults.js'
import {
  createSettingsDraft,
  parseSettingsDraft,
  SettingsPage
} from '@renderer/pages/SettingsPage.js'

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

describe('settings number editing', () => {
  it('allows every freeform number field to be cleared before typing a replacement', () => {
    act(() => {
      root.render(
        <SettingsPage
          busy={false}
          onSaveSettings={async () => undefined}
          settings={DEFAULT_SETTINGS}
        />
      )
    })
    const inputs = [
      ...container.querySelectorAll<HTMLInputElement>('input[type="number"]')
    ]

    expect(inputs).toHaveLength(3)
    for (const input of inputs) {
      act(() => setInputValue(input, ''))
      expect(input.value).toBe('')

      act(() => setInputValue(input, '10'))
      expect(input.value).toBe('10')
    }
  })

  it('falls back to the saved value instead of converting an empty draft to zero', () => {
    const draft = createSettingsDraft(DEFAULT_SETTINGS)
    const parsed = parseSettingsDraft(
      {
        ...draft,
        requestTimeoutMs: ''
      },
      DEFAULT_SETTINGS
    )

    expect(parsed.requestTimeoutMs).toBe(DEFAULT_SETTINGS.requestTimeoutMs)
  })
})

describe('benchmark controls', () => {
  it('offers the same five concurrency levels for scans and benchmarks', () => {
    act(() => {
      root.render(
        <SettingsPage
          busy={false}
          onSaveSettings={async () => undefined}
          settings={DEFAULT_SETTINGS}
        />
      )
    })

    const scanOptions = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[name="scanConcurrency"]'
      )
    ]
    const benchmarkOptions = [
      ...container.querySelectorAll<HTMLInputElement>(
        'input[name="benchmarkConcurrency"]'
      )
    ]

    expect(scanOptions.map(({ value }) => value)).toEqual(['2', '4', '8', '16', '32'])
    expect(benchmarkOptions.map(({ value }) => value)).toEqual([
      '2',
      '4',
      '8',
      '16',
      '32'
    ])
    expect(scanOptions.find(({ checked }) => checked)?.value).toBe('8')
    expect(benchmarkOptions.find(({ checked }) => checked)?.value).toBe('4')
    expect(container.textContent).toContain('Saved changes apply to running jobs')
  })

  it('saves selected concurrency levels and a user-authored benchmark prompt', async () => {
    const onSaveSettings = vi.fn(async () => undefined)
    await act(async () => {
      root.render(
        <SettingsPage
          busy={false}
          onSaveSettings={onSaveSettings}
          settings={DEFAULT_SETTINGS}
        />
      )
    })

    const scan32 = container.querySelector<HTMLInputElement>(
      'input[name="scanConcurrency"][value="32"]'
    )
    const benchmark16 = container.querySelector<HTMLInputElement>(
      'input[name="benchmarkConcurrency"][value="16"]'
    )
    const prompt = container.querySelector<HTMLTextAreaElement>('textarea')
    const save = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      ({ textContent }) => textContent?.includes('Save settings')
    )
    if (!scan32 || !benchmark16 || !prompt || !save) {
      throw new Error('Expected settings controls are unavailable')
    }

    await act(async () => {
      scan32.click()
      benchmark16.click()
      setTextAreaValue(prompt, 'Explain why deterministic benchmarks matter.')
    })
    await act(async () => {
      save.click()
    })

    expect(onSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        scanConcurrency: 32,
        benchmarkConcurrency: 16,
        benchmarkPrompt: 'Explain why deterministic benchmarks matter.'
      })
    )
  })
})

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  )?.set
  if (!setter) throw new Error('HTML input value setter is unavailable')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set
  if (!setter) throw new Error('HTML textarea value setter is unavailable')
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
