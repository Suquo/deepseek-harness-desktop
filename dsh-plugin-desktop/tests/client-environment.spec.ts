import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { apply } from '../src/client/index.ts'
import { provideDesktopLayout } from '../src/client/layout-service.ts'
import { parseDesktopClientEnvironment } from '../src/client/environment.ts'
import {
  computeDesktopColumns, DesktopLayoutState, MACOS_SIDEBAR_COLLAPSED, SIDEBAR_COLLAPSED,
} from '../src/client/layout-state.ts'
import { installAdvancedStyles } from '../src/client/styles.ts'
import {
  MACOS_DRAG_REGION_HEIGHT,
  MACOS_TITLEBAR_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
  WINDOWS_TITLEBAR_HEIGHT,
} from '../src/window-chrome.ts'

describe('desktop client environment', () => {
  it('does not activate desktop effects for an ordinary browser URL', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const effect = vi.fn()

    try {
      expect(parseDesktopClientEnvironment('')).toBeUndefined()
      apply({ effect } as unknown as ClientContext)
      expect(effect).not.toHaveBeenCalled()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts the Electron-owned kebab query markers', () => {
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin'))
      .toEqual({ mode: 'advanced', platform: 'darwin' })
    expect(parseDesktopClientEnvironment('?dsh-desktop-platform=win32&dsh-desktop-mode=compatibility'))
      .toEqual({ mode: 'compatibility', platform: 'win32' })
  })

  it.each([
    ['?dsh-desktop-mode=glass&dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced', 'dsh-desktop-platform'],
    ['?dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=android', 'dsh-desktop-platform'],
  ])('fails loud for malformed marker %s', (search, field) => {
    expect(() => parseDesktopClientEnvironment(search)).toThrow(field)
  })
})

describe('advanced desktop layout', () => {
  it('owns native caption geometry without targeting feature headers', () => {
    expect(MACOS_TITLEBAR_HEIGHT).toBe(20)
    expect(MACOS_DRAG_REGION_HEIGHT).toBe(32)
    expect(MACOS_DRAG_REGION_HEIGHT).toBeGreaterThan(MACOS_TITLEBAR_HEIGHT)
    expect(WINDOWS_TITLEBAR_HEIGHT).toBe(32)
    let css = ''
    const remove = vi.fn()
    const style = {
      dataset: {},
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installAdvancedStyles()
      expect(css).toMatch(/\.dshDesktopSidebarSurface\s*\{[^}]*--dsw-specific-sidebar-fill:\s*transparent;/)
      expect(css).toMatch(/data-desktop-platform="darwin"\]\[data-sidebar-collapsed\][^{]*\.dshDesktopUpstreamSidebar \{[^}]*width:\s*56px;[^}]*margin:\s*0 auto;/)
      expect(css).toMatch(new RegExp(`data-desktop-platform="darwin"\\] \\.dshDesktopUpstreamSidebar \\{[^}]*padding-top: ${MACOS_TITLEBAR_HEIGHT}px;[^}]*-webkit-app-region: no-drag;`))
      expect(css).toContain(`grid-template-rows: ${MACOS_TITLEBAR_HEIGHT}px minmax(0, 1fr)`)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-platform="darwin"\] \.dshDesktopSidebarSurface \{[^}]*grid-row: 1 \/ -1;[^}]*-webkit-app-region: no-drag;/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-platform="darwin"\] \.dshDesktopConversationSurface,\s*\.dshDesktopFrame\[data-desktop-platform="darwin"\] \.dshDesktopRightbarSurface \{ grid-row: 2; \}/)
      expect(css).toMatch(new RegExp(`data-desktop-platform="darwin"\\] \\.dshDesktopSidebarSurface::before \\{[^}]*left: ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH}px;[^}]*height: ${MACOS_DRAG_REGION_HEIGHT}px;[^}]*-webkit-app-region: drag;`))
      expect(css).not.toMatch(/data-desktop-platform="darwin"\] \.dshDesktopSidebarSurface::before \{[^}]*z-index:/)
      expect(css).toMatch(/\.dshDesktopMacCaptionRow \{[^}]*position: relative;[^}]*grid-column: 2 \/ -1;[^}]*grid-row: 1;/)
      expect(css).toMatch(new RegExp(`\\.dshDesktopMacCaptionRow::before \\{[^}]*height: ${MACOS_DRAG_REGION_HEIGHT}px;[^}]*-webkit-app-region: drag;`))
      expect(css).not.toMatch(/\.dshDesktopMacCaptionRow::before \{[^}]*z-index:/)
      expect(css).not.toMatch(/data-desktop-platform="darwin"\] \.dshDesktopSidebarSurface \{[^}]*-webkit-app-region:\s*drag;/)
      expect(css).not.toContain('[data-phase')
      expect(css).toMatch(/html:has\(\[aria-modal="true"\]\) \.dshDesktopMacCaptionRow::before,[\s\S]*html:has\(\[aria-modal="true"\]\) \.dshDesktopSidebarSurface::before \{ -webkit-app-region: no-drag !important; \}/)
      expect(css).toContain(`grid-template-rows: ${WINDOWS_TITLEBAR_HEIGHT}px minmax(0, 1fr)`)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-platform="win32"\] \.dshDesktopSidebarSurface \{ grid-row: 1 \/ -1; \}/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-platform="win32"\] \.dshDesktopConversationSurface,\s*\.dshDesktopFrame\[data-desktop-platform="win32"\] \.dshDesktopRightbarSurface \{ grid-row: 2; \}/)
      expect(css).toMatch(/\.dshDesktopWindowsCaptionRow \{[^}]*grid-column: 2 \/ -1;[^}]*grid-row: 1;/)
      expect(css).toMatch(new RegExp(`\\.dshDesktopWindowsCaptionRow::before \\{[^}]*inset: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH}px 0 0;[^}]*-webkit-app-region: drag;`))
      expect(css).not.toMatch(/data-desktop-platform="win32"[^{}]*header[^{}]*\{[^}]*padding-right/)
      // The right panel's occupant anchors its own panel to the column and lets
      // it hang over the center when it asks for no track, so the column must
      // be a positioning context that never clips.
      expect(css).toMatch(/\.dshDesktopRightbarSurface \{[^}]*position: relative;[^}]*overflow: visible;/)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('releases the Cordis layout service with its owning effect', () => {
    const released: string[] = []
    let panelInfo: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } | undefined
    let onMain: (() => void) | undefined
    const layout = new DesktopLayoutState()
    const ctx = {
      reflect: {
        provide: (name: string, value: unknown) => {
          expect(name).toBe('layout')
          expect(value).toBe(layout)
          return () => { released.push('layout') }
        },
      },
      slots: {
        provideRoot: (contribution: { hooks: { panelInfo: typeof panelInfo } }) => {
          panelInfo = contribution.hooks.panelInfo
          return () => { released.push('panelInfo') }
        },
        subscribe: (key: string, listener: () => void) => {
          expect(key).toBe('main')
          onMain = listener
          return () => { released.push('main') }
        },
      },
    } as unknown as ClientContext

    const dispose = provideDesktopLayout(ctx, layout)
    // Advanced mode stands in for upstream's layout package, so it supplies the
    // root panel source the sidebar reads, backed by the same layout state.
    expect(panelInfo?.getSnapshot()).toEqual({ activePanelId: null })
    expect(onMain).toBeTypeOf('function')
    expect(released).toEqual([])
    const pending = layout.beginNavigation()
    dispose()
    expect(released.sort()).toEqual(['layout', 'main', 'panelInfo'])
    expect(pending.aborted).toBe(true)
  })

  it('uses the compatibility rail on Windows and the wider desktop rail on macOS', () => {
    expect(computeDesktopColumns(1440, 0, 0)).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1384, rightbar: 0 })
    expect(computeDesktopColumns(1440, 0, 0, MACOS_SIDEBAR_COLLAPSED))
      .toEqual({ sidebar: MACOS_SIDEBAR_COLLAPSED, center: 1350, rightbar: 0 })
    expect(SIDEBAR_COLLAPSED).toBe(56)
    expect(MACOS_SIDEBAR_COLLAPSED).toBe(90)
  })

  it('publishes mirrored panel transitions', () => {
    const layout = new DesktopLayoutState()
    const snapshots: object[] = []
    layout.subscribe(() => { snapshots.push(layout.getSnapshot()) })
    layout.toggleSidebar()
    layout.openRightbar(true, false)
    layout.openRightbar(true, false)
    layout.closeRightbar()
    const hidden = { rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false }
    expect(snapshots).toEqual([
      { sidebar: 0, rightbar: 360, ...hidden, narrow: false, narrowExpanded: false },
      { sidebar: 0, rightbar: 360, rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false, narrow: false, narrowExpanded: false },
      { sidebar: 0, rightbar: 360, ...hidden, narrow: false, narrowExpanded: false },
    ])
  })

  it('forgets a dragged right-panel width when the panel closes, as the details panel did', () => {
    const layout = new DesktopLayoutState()
    layout.openRightbar(true, false)
    layout.setRightbar(480)
    expect(layout.getSnapshot().rightbar).toBe(480)
    layout.closeRightbar()
    layout.openRightbar(true, false)
    expect(layout.getSnapshot().rightbar).toBe(360)
  })

  it('records the occupant presentation without deciding it', () => {
    const layout = new DesktopLayoutState()
    layout.openRightbar(false, true)
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: false, rightbarFullscreen: true })
    // A hidden panel reserves nothing: the frame reads the track off this flag.
    layout.closeRightbar()
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false })
  })

  it('selects global main panels and falls back to the Conversation when one unregisters', () => {
    const registered = new Set(['files'])
    const layout = new DesktopLayoutState(id => registered.has(id))
    const panel = (id: string) => id as Parameters<DesktopLayoutState['selectPanel']>[0]
    expect(() => { layout.selectPanel(panel('missing')) }).toThrow('main panel "missing" is not registered')
    expect(layout.getPanelInfo()).toEqual({ activePanelId: null })
    const navigation = layout.beginNavigation()
    layout.selectPanel(panel('files'))
    expect(layout.getPanelInfo()).toEqual({ activePanelId: 'files' })
    // A selection supersedes any navigation still pending.
    expect(navigation.aborted).toBe(true)
    registered.delete('files')
    layout.retainMainPanels()
    expect(layout.getPanelInfo()).toEqual({ activePanelId: null })
  })

  it('collapses the expanded narrow rail when the right panel opens', () => {
    const layout = new DesktopLayoutState()
    layout.setNarrow(true)
    layout.toggleSidebar()
    expect(layout.getSnapshot().narrowExpanded).toBe(true)
    layout.openRightbar(true, false)
    expect(layout.getSnapshot().narrowExpanded).toBe(false)
  })

  it('lets the rail re-expand without losing its wide preference on narrow windows', () => {
    const layout = new DesktopLayoutState()
    layout.setNarrow(true)
    expect(layout.getSnapshot()).toMatchObject({ sidebar: 280, narrow: true, narrowExpanded: false })
    layout.toggleSidebar()
    expect(layout.getSnapshot()).toMatchObject({ sidebar: 280, narrow: true, narrowExpanded: true })
    layout.setNarrow(false)
    expect(layout.getSnapshot()).toMatchObject({ sidebar: 280, narrow: false, narrowExpanded: false })
  })
})
