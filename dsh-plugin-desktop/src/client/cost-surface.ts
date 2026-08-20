/**
 * The desktop cost surface: per-generation cost and per-step timing, in the UI.
 *
 * WHERE IT MOUNTS, AND WHY THERE. Upstream renders an action row at the tail of
 * every finished turn and declares `conversation.chat.assistant-actions` inside
 * it — a list slot addressed by the closing message's identity. That is exactly
 * one render site per completed turn, which is exactly the granularity the
 * owner asked for: one Parametria definition build is one turn. Contributing to
 * a list slot is composition, not override; nothing upstream is replaced.
 *
 * WHERE IT DOES NOT MOUNT. Only the desktop-composed (advanced) shell installs
 * this. Compatibility mode runs the upstream default client without overrides
 * (AGENTS.md), and this is a desktop-owned surface, so it is installed from
 * `applyAdvancedShell` and by nothing else.
 *
 * Its stylesheet is its own `<style>` element, deliberately not folded into the
 * advanced-shell sheet: those styles are the window frame's and the brand's,
 * this one belongs to a slot contribution with a different lifetime.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RateSource } from './cost-rates.ts'
import { TurnCostBadge } from './TurnCostBadge.tsx'

/** List-slot entry id; one contribution per turn action row. */
export const COST_BADGE_ENTRY_ID = 'desktop-turn-cost'

/**
 * Render order inside the action row.
 *
 * High, so the badge trails upstream's own copy/branch/retry actions rather
 * than pushing them along — this reports on the turn, it does not act on it.
 */
export const COST_BADGE_ORDER = 900

/**
 * The cost surface stylesheet.
 *
 * Every colour is an upstream alias token, so both themes come from the theme
 * presenter's own palette rather than from hand-picked hexes that would only
 * be right in one of them. The numeric columns are tabular-figure aligned
 * because the whole point of the table is comparing magnitudes down a column.
 */
const COST_STYLES = `
.dshDesktopCostBadge { display: inline-block; font-size: 12px; }
.dshDesktopCostBadge > summary { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 6px; color: var(--dsw-alias-label-tertiary); cursor: pointer; list-style: none; white-space: nowrap; font-variant-numeric: tabular-nums; }
.dshDesktopCostBadge > summary::-webkit-details-marker { display: none; }
.dshDesktopCostBadge > summary:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.dshDesktopCostBadge > summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshDesktopCostMoney { color: var(--dsw-alias-label-secondary); font-weight: 600; }
.dshDesktopCostDot { opacity: 0.5; }
.dshDesktopCostPanel { max-width: min(720px, 80vw); margin-top: 6px; padding: 10px 12px; overflow-x: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.dshDesktopCostTable { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.dshDesktopCostTable caption { margin-bottom: 6px; color: var(--dsw-alias-label-tertiary); text-align: left; }
.dshDesktopCostTable th, .dshDesktopCostTable td { padding: 3px 8px 3px 0; text-align: right; white-space: nowrap; }
.dshDesktopCostTable thead th { color: var(--dsw-alias-label-tertiary); font-weight: 500; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dshDesktopCostTable th:nth-child(1), .dshDesktopCostTable td:nth-child(1),
.dshDesktopCostTable th:nth-child(2), .dshDesktopCostTable td:nth-child(2) { text-align: left; }
.dshDesktopCostTable tbody th { color: var(--dsw-alias-label-tertiary); font-weight: 400; }
.dshDesktopCostTable tbody td:last-child { color: var(--dsw-alias-label-primary); }
.dshDesktopCostUnknown { color: var(--dsw-alias-state-error-primary); }
.dshDesktopCostTotals { display: grid; grid-template-columns: auto 1fr; gap: 2px 12px; margin: 10px 0 0; padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
.dshDesktopCostTotals dt { color: var(--dsw-alias-label-tertiary); }
.dshDesktopCostTotals dd { margin: 0; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshDesktopCostProvenance { margin: 8px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
`

/**
 * Install the cost surface's stylesheet.
 * @returns the style disposer.
 */
export function installCostStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/cost-surface'
  style.textContent = COST_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

/**
 * Mount the per-generation cost surface for one desktop client generation.
 *
 * `slots.inject` defers the registration until upstream's turn-tail entry has
 * declared the slot, so this is independent of client plugin load order: the
 * desktop plugin never assumes it loads after the conversation package.
 * @param ctx - active browser Cordis context.
 * @returns disposer releasing the rate read, the registration and the styles.
 */
export function installCostSurface(ctx: ClientContext): () => void {
  const rateSource = new RateSource()
  const removeStyles = installCostStyles()
  const removeRegistration = ctx.slots.inject(
    'conversation.chat.assistant-actions',
    () => ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: COST_BADGE_ENTRY_ID,
      order: COST_BADGE_ORDER,
      registrant: 'dsh-plugin-desktop: turn cost',
      inject: () => ({ rateSource }),
    }, TurnCostBadge),
  )
  return () => {
    removeRegistration()
    removeStyles()
    rateSource.dispose()
  }
}
