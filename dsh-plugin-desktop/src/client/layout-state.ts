import type { ILayout, MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'

/** Advanced-shell panel state shared by the root slot and layout-service adapter. */
export interface DesktopLayoutSnapshot {
  /** Preferred sidebar width; zero means the compact rail. */
  sidebar: number
  /** Preferred right-panel width, used whenever the panel is drawn. */
  rightbar: number
  /** Whether the right panel's occupant reports itself drawn, in either presentation. */
  rightbarShown: boolean
  /** Whether the drawn panel reserves a grid track rather than hanging over the center. */
  rightbarTrack: boolean
  /** Whether the drawn panel covers the frame. */
  rightbarFullscreen: boolean
  /** Whether the current viewport is below the automatic-collapse breakpoint. */
  narrow: boolean
  /** Manual narrow-screen override that temporarily expands the rail. */
  narrowExpanded: boolean
}

/** Column geometry after preserving the center surface. */
export interface DesktopColumns {
  /** Rendered sidebar width. */
  sidebar: number
  /** Rendered center width. */
  center: number
  /** Rendered right-panel width. */
  rightbar: number
}

/** Compatibility-mode compact rail used by the upstream Windows sidebar. */
export const SIDEBAR_COLLAPSED = 56
/** Wider compact rail reserved for the desktop-owned macOS sidebar. */
export const MACOS_SIDEBAR_COLLAPSED = 90
export const SIDEBAR_DEFAULT = 280
export const SIDEBAR_MIN = 264
export const SIDEBAR_MAX = 420
export const SIDEBAR_AUTO_COLLAPSE = 1024
// The right panel keeps the desktop's former details geometry. Upstream's own
// frame sizes the same panel as a viewport ratio; the advanced shell keeps its
// fixed range so the frame reads the way it did before the panel was renamed.
export const RIGHTBAR_DEFAULT = 360
export const RIGHTBAR_MIN = 300
export const RIGHTBAR_MAX = 520
export const CENTER_MIN = 640

/**
 * Resolve three desktop columns without allowing the right panel to squeeze the conversation below its floor.
 * @param viewport - available frame width.
 * @param sidebar - sidebar preference, where zero selects the compact rail.
 * @param rightbar - right-panel preference, where zero closes the panel.
 * @param collapsedWidth - platform-selected compact rail width.
 * @returns rendered column widths.
 */
export function computeDesktopColumns(
  viewport: number,
  sidebar: number,
  rightbar: number,
  collapsedWidth: number = SIDEBAR_COLLAPSED,
): DesktopColumns {
  const sidebarWidth = sidebar === 0 ? collapsedWidth : clamp(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredRightbar = rightbar === 0 ? 0 : clamp(rightbar, RIGHTBAR_MIN, RIGHTBAR_MAX)
  if (sidebarWidth + preferredRightbar + CENTER_MIN <= viewport) {
    return { sidebar: sidebarWidth, center: viewport - sidebarWidth - preferredRightbar, rightbar: preferredRightbar }
  }
  const reducedRightbar = preferredRightbar === 0 ? 0 : Math.max(RIGHTBAR_MIN, viewport - sidebarWidth - CENTER_MIN)
  if (sidebarWidth + reducedRightbar + CENTER_MIN <= viewport) {
    return { sidebar: sidebarWidth, center: CENTER_MIN, rightbar: reducedRightbar }
  }
  return { sidebar: sidebarWidth, center: Math.max(0, viewport - sidebarWidth), rightbar: 0 }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Small observable panel controller used by the advanced root registration.
 *
 * Advanced mode replaces upstream's layout package, so this is also the
 * `ctx.layout` every upstream surface calls: panel selection for the keyed
 * `main` slot, navigation supersession, and the right panel's presentation
 * reports. Whether the right panel is drawn belongs to its occupant; this
 * records what the occupant reports and never decides it.
 */
export class DesktopLayoutState implements ILayout {
  private snapshot: DesktopLayoutSnapshot = Object.freeze({
    sidebar: SIDEBAR_DEFAULT,
    rightbar: RIGHTBAR_DEFAULT,
    rightbarShown: false,
    rightbarTrack: false,
    rightbarFullscreen: false,
    narrow: false,
    narrowExpanded: false,
  })
  private panelInfo: PanelInfo = Object.freeze({ activePanelId: null })
  private navigation = new AbortController()
  private readonly listeners = new Set<() => void>()

  /** @param hasMainPanel - checks the live `main` slot registry for a panel id. */
  constructor(private readonly hasMainPanel: (id: MainPanelId) => boolean = () => false) {}

  /** @returns the immutable current panel snapshot. */
  getSnapshot(): DesktopLayoutSnapshot {
    return this.snapshot
  }

  /** @returns the selected global panel; null shows the Conversation. */
  getPanelInfo(): PanelInfo {
    return this.panelInfo
  }

  /** @param listener - callback notified after a snapshot or panel replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Select a registered global panel, or return to the Conversation.
   * @param panelId - registered `main` key, or null for the Conversation.
   * @throws if the key is not registered; the current selection is kept.
   */
  selectPanel(panelId: MainPanelId | null): void {
    if (panelId !== null && !this.hasMainPanel(panelId)) {
      throw new Error(`layout.selectPanel: main panel "${panelId}" is not registered`)
    }
    this.navigation.abort()
    if (this.panelInfo.activePanelId === panelId) return
    this.panelInfo = Object.freeze({ activePanelId: panelId })
    this.notify()
  }

  /** Return to the Conversation when the selected panel's registration goes away. */
  retainMainPanels(): void {
    const id = this.panelInfo.activePanelId
    if (id !== null && !this.hasMainPanel(id)) this.selectPanel(null)
  }

  /** @returns the new pending navigation's signal, aborting any earlier one. */
  beginNavigation(): AbortSignal {
    this.navigation.abort()
    this.navigation = new AbortController()
    return this.navigation.signal
  }

  /** Invalidate pending navigation when the owning layout unloads. */
  dispose(): void {
    this.navigation.abort()
  }

  /** Toggle the wide sidebar and the platform-selected compact rail. */
  toggleSidebar(): void {
    if (this.snapshot.narrow) {
      this.publish({ ...this.snapshot, narrowExpanded: !this.snapshot.narrowExpanded })
      return
    }
    this.publish({ ...this.snapshot, sidebar: this.snapshot.sidebar === 0 ? SIDEBAR_DEFAULT : 0 })
  }

  /** @param narrow - whether the frame is below the automatic-collapse breakpoint. */
  setNarrow(narrow: boolean): void {
    if (this.snapshot.narrow === narrow) return
    this.publish({ ...this.snapshot, narrow, narrowExpanded: false })
  }

  /**
   * Record the occupant's report that the right panel is drawn.
   *
   * On a narrow frame the expanded rail yields to the panel, which is the
   * space the frame offered the occupant when it reported the panel showable.
   * @param track - whether the panel reserves a grid track.
   * @param fullscreen - whether the panel covers the frame.
   */
  openRightbar(track: boolean, fullscreen: boolean): void {
    const current = this.snapshot
    if (current.rightbarShown && current.rightbarTrack === track && current.rightbarFullscreen === fullscreen) return
    this.publish({
      ...current,
      rightbarShown: true,
      rightbarTrack: track,
      rightbarFullscreen: fullscreen,
      narrowExpanded: current.narrow ? false : current.narrowExpanded,
    })
  }

  /** Record the occupant's report that the right panel is hidden; the next opening starts at the default width. */
  closeRightbar(): void {
    if (!this.snapshot.rightbarShown) return
    this.publish({
      ...this.snapshot,
      rightbar: RIGHTBAR_DEFAULT,
      rightbarShown: false,
      rightbarTrack: false,
      rightbarFullscreen: false,
    })
  }

  /** @param width - requested sidebar width from a resize gesture. */
  setSidebar(width: number): void {
    this.publish({ ...this.snapshot, sidebar: clamp(width, SIDEBAR_MIN, SIDEBAR_MAX) })
  }

  /** @param width - requested right-panel width from a resize gesture. */
  setRightbar(width: number): void {
    this.publish({ ...this.snapshot, rightbar: clamp(width, RIGHTBAR_MIN, RIGHTBAR_MAX) })
  }

  private publish(next: DesktopLayoutSnapshot): void {
    this.snapshot = Object.freeze(next)
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
