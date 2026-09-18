import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from './contracts.ts'
import type { DesktopLayoutState } from './layout-state.ts'

/**
 * Provide the advanced layout service for one plugin-fiber lifetime.
 *
 * Advanced mode stands in for upstream's layout package, so it supplies what
 * that package supplies alongside `ctx.layout`: the root `usePanelInfo` source
 * the sidebar and document surfaces read, and the rule that a selected panel
 * whose `main` registration goes away falls back to the Conversation.
 * @param ctx - active browser Cordis context.
 * @param layout - desktop-owned layout implementation.
 * @returns disposer for the service registration.
 */
export function provideDesktopLayout(ctx: ClientContext, layout: DesktopLayoutState): () => void {
  const disposePanelInfo = ctx.slots.provideRoot({ hooks: { panelInfo: {
    getSnapshot: () => layout.getPanelInfo(),
    subscribe: listener => layout.subscribe(listener),
  } } })
  const dispose = ctx.reflect.provide('layout', layout)
  const disposePanels = ctx.slots.subscribe('main', () => { layout.retainMainPanels() })
  layout.retainMainPanels()
  return () => {
    layout.dispose()
    disposePanels()
    disposePanelInfo()
    void dispose()
  }
}
