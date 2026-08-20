import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type convergence only: locale/theme declarations expose settings slot rows.
// The desktop client does not load or register a settings surface.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { startRendererBootReporter } from './boot-health.ts'
import { installCostSurface } from './cost-surface.ts'
import { installDesktopDirectoryPickerBridge } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { installWorkspaceFolderDrop } from './workspace-folder-drop.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type { DesktopClientEnvironment, DesktopClientMode, DesktopClientPlatform } from './environment.ts'

/** Services required by advanced presentation. */
export const inject = [
  'slots',
  'sessions',
  'theme',
  'workspaces',
]

/**
 * Register desktop-owned client surfaces for the current BrowserWindow mode.
 *
 * Everything registered unconditionally here reaches BOTH shell modes, so
 * everything here has to be additive: compatibility mode runs the upstream
 * default client, and AGENTS.md admits desktop-owned UI there only when it adds
 * to a documented slot without replacing or altering upstream slots, services or
 * behaviour. The boot reporter, the folder drop and the directory-picker bridge
 * met that bar already; the cost surface is the first desktop-owned *visible*
 * surface to join them, under the owner ruling on issue #36.
 *
 * Mode-specific composition — owning the root slot, the window frame's styles,
 * the theme presenter — stays behind the advanced branch at the end.
 * @param ctx - browser Cordis context.
 */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  ctx.effect(
    () => installWorkspaceFolderDrop({
      create: input => ctx.workspaces.create(input),
      startSession: workspaceId => { ctx.workspaces.startSession(workspaceId) },
    }),
    'dsh-plugin-desktop: workspace folder drop',
  )
  // Desktop-owned reporting surface, contributed to upstream's own turn-tail
  // action list. It reads session state and renders; it replaces nothing, so it
  // belongs to both modes rather than to the advanced shell.
  ctx.effect(
    () => installCostSurface(ctx),
    'dsh-plugin-desktop: turn cost surface',
  )
  if (environment.platform === 'win32') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)
}
