// Since 0.1.5-rc.2 upstream's own layout package declares the frame contract
// this shell hosts: `ctx.layout` as `ILayout`, the root children `sidebar`,
// `main` (keyed), `rightbar` and `shell.overlay`, and the root `usePanelInfo`
// hook. Advanced mode replaces that package's frame and service, so it types
// against the same declarations rather than restating a copy that could drift.
// The `root` slot itself and `ctx.slots` are declared by the renderer package.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

/** Sidebar geometry passed by the desktop root slot. */
export interface DesktopSidebarOwnerProps {
  /** Whether the sidebar is showing its compact rail. */
  collapsed: boolean
  /** Current rendered sidebar width. */
  width: number
}

/** Public panel transitions consumed by conversation and sidebar plugins. */
export type DesktopLayoutService = import('@deepseek-ai/dsh-client-ui-layout/client').ILayout
