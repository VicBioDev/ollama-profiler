import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Sidebar } from '@renderer/components/Sidebar.js'
import { TopBar } from '@renderer/components/TopBar.js'

describe('window drag regions', () => {
  it('makes the title bar and sidebar draggable without capturing controls', () => {
    const sidebar = renderToStaticMarkup(
      <Sidebar
        activePage="overview"
        hasServers
        localState="idle"
        onCheckForUpdates={() => undefined}
        onNavigate={() => undefined}
      />
    )
    const topbar = renderToStaticMarkup(
      <TopBar
        busy={false}
        jobs={[]}
        profileAction={{ label: 'Scan & benchmark all', onClick: () => undefined }}
      />
    )

    expect(sidebar).toContain('class="sidebar" data-tauri-drag-region="deep"')
    expect(sidebar).toContain('data-tauri-drag-region="false"')
    expect(topbar).toContain('class="topbar" data-tauri-drag-region="deep"')
    expect(topbar).toContain('data-tauri-drag-region="false"')
  })
})
