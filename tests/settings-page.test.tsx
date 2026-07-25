// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@main/defaults.js'
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
  it('allows every number field to be cleared before typing a replacement', () => {
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

    expect(inputs).toHaveLength(5)
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
        scanConcurrency: '',
        benchmarkConcurrency: '10'
      },
      DEFAULT_SETTINGS
    )

    expect(parsed.scanConcurrency).toBe(DEFAULT_SETTINGS.scanConcurrency)
    expect(parsed.benchmarkConcurrency).toBe(10)
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
