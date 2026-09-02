/**
 * Parametria's boot-time pinned-route preflight (issue #52).
 *
 * A `dsh-tool-subagent` row may override the provider inherited from its
 * caller. That is useful for the vision validator, but the override is only a
 * string until an adapter actually registers the route. Without this check the
 * first useful diagnosis arrives after a run has delegated its validation and
 * the child has already failed.
 *
 * This plugin derives the pins from the loader tree that mounted it and reads
 * the LLM registry when each session starts. Neither side is copied into a
 * second list: adding another pinned subagent row makes it participate, and a
 * provider registered after this plugin mounted is immediately recognised by
 * the next session.
 *
 * @module dsh-plugin-desktop/parametria-route-preflight
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { PARAMETRIA_PRODUCT_NAME } from './client/brand.ts'

/** Stable Cordis plugin name. */
export const name = 'parametria-route-preflight'

/** The preflight reads the live provider registry. */
export const inject = ['llm']

/** The module specifier whose rows can pin a child provider. */
export const SUBAGENT_PLUGIN = '@deepseek-ai/dsh-tool-subagent'

/** The operator command that installs the machine-wide route patch. */
export const ROUTE_REMEDY = 'corepack yarn install:profile'

/** Loader-entry shape used by the route discovery rule. */
export interface RouteEntry {
  /** Effective loader state, including disabled parent groups. */
  readonly disabled?: boolean
  readonly options: {
    readonly name: string
    readonly config?: unknown
  }
}

interface SubagentConfig {
  agentOptions?: {
    provider?: unknown
  }
}

/** Plugin config is deliberately empty: route names come from the loader tree. */
export interface Config {}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({})

/**
 * Discover every subagent provider pin in declaration order.
 *
 * @param entries - the mounted preset's live loader entries.
 * @returns de-duplicated provider ids.
 */
export function pinnedSubagentProviders(entries: Iterable<RouteEntry>): string[] {
  const providers = new Set<string>()
  for (const entry of entries) {
    if (entry.disabled) continue
    if (entry.options.name !== SUBAGENT_PLUGIN) continue
    const config = entry.options.config as SubagentConfig | undefined
    const provider = config?.agentOptions?.provider
    if (typeof provider === 'string' && provider.length > 0) providers.add(provider)
  }
  return [...providers]
}

/**
 * Render the model- and operator-visible setup failure.
 *
 * @param providers - provider ids absent from the live registry.
 * @returns loud banner text naming the missing routes and the remedy.
 */
export function unresolvedRouteBanner(providers: readonly string[]): string {
  const list = providers.map(provider => `- ${provider}`).join('\n')
  return [
    'PARAMETRIA ROUTE PREFLIGHT FAILED',
    '',
    'Pinned subagent provider routes are not registered:',
    list,
    '',
    `Validation cannot start on those routes. Install the ${PARAMETRIA_PRODUCT_NAME} profile, then restart DSH Desktop:`,
    ROUTE_REMEDY,
  ].join('\n')
}

/**
 * Install the session-start check against a loader-entry source.
 *
 * Exported so the registry behavior can be fenced against the real
 * `LlmRuntime` without constructing a persistence-backed loader in unit tests.
 * Production passes the exact tree that mounted this plugin.
 *
 * @param ctx - the mounting context.
 * @param entries - reads the current entries in this preset generation.
 */
export function installRoutePreflight(ctx: Context, entries: () => Iterable<RouteEntry>): void {
  ctx.on('agent/session-start', ({ agent }) => {
    const registered = new Set(ctx.llm.listProviders().map(provider => provider.id))
    const unresolved = pinnedSubagentProviders(entries())
      .filter(provider => !registered.has(provider))
    if (unresolved.length === 0) return

    const message = createUserMessage({
      source: {
        kind: 'plugin',
        plugin: name,
        form: 'notice',
        summary: boundContextSummary(
          `${PARAMETRIA_PRODUCT_NAME} route missing: ${unresolved.join(', ')}; run ${ROUTE_REMEDY}`,
        ),
      },
      content: [{ type: 'text', text: unresolvedRouteBanner(unresolved) }],
    })
    // `agent.inject()` would not reach the durable surface until the first
    // turn claims it. This acceptance criterion is SESSION-START visibility,
    // so append the plugin-sourced user message now; the public surface API
    // publishes it to clients immediately and includes it in the next model
    // history without waking the agent.
    agent.session.append('user/message', message, { surfaceOp: 'append' })
  })
}

/**
 * Bind the preflight to the loader tree that mounted this preset row.
 *
 * @param ctx - the mounting context.
 * @param config - the resolved plugin config.
 */
export function apply(ctx: Context, _config: Config): void {
  // `Entry.parent`, `EntryGroup.tree`, and `EntryTree.entries()` are public
  // exports of `@deepseek-ai/cordis-plugin-loader`. Reading that tree is the
  // loader's composition API, not an assumption about another plugin's
  // service internals; it is also the only exact view of this mounted preset
  // generation (re-reading the YAML could race a later generation).
  const entry = ctx.fiber.entry
  const tree = entry?.parent.tree
  if (!tree) {
    throw new Error(
      `${name} must be mounted as a loader entry inside the ${PARAMETRIA_PRODUCT_NAME} preset`,
    )
  }
  installRoutePreflight(ctx, () => tree.entries())
}
