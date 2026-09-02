/**
 * Parametria's one-turn `read_image` route fallback (issue #54).
 *
 * Upstream's image tool remains the owner of file resolution, attachment
 * admission, rendering, and exact-route modality validation. The small Yarn
 * patch only asks composition for an optional candidate after the calling
 * route is known text-only. This plugin supplies the Parametria-owned vision
 * route, keeps the rest of that turn on it so the attached image reaches a
 * capable model, then restores the prior route on the first later-turn request.
 *
 * @module dsh-plugin-desktop/parametria-read-image-fallback
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { ImageRouteFallback } from '@deepseek-ai/dsh-tool-fs'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'parametria-read-image-fallback'

/** The patched image gate and request waterfall both consume the live LLM service. */
export const inject = ['llm']

/** Exact fallback route owned by the Parametria machine composition. */
export interface Config {
  provider: string
  model: string
}

/** Runtime configuration schema. */
export const Config: z<Config> = z.object({
  provider: z.string(),
  model: z.string(),
})

interface Route {
  readonly provider: string
  readonly model: string
}

interface FallbackState {
  readonly activeTurn: number
  readonly fallback: Route
  readonly original: LlmCallConfig
}

function sameRoute(config: Route, route: Route): boolean {
  return config.provider === route.provider && config.model === route.model
}

function originalConfig(agent: Agent, current: Route): LlmCallConfig {
  const routed = agent.session.requestHeader()?.config
  if (routed !== undefined) return structuredClone(routed)
  return {
    provider: agent.options.provider ?? current.provider,
    model: agent.options.model ?? current.model,
    ...(agent.options.maxTokens === undefined ? {} : { maxTokens: agent.options.maxTokens }),
  }
}

function withRoute(config: LlmCallConfig, route: Route): LlmCallConfig {
  const { reasoningEffort: _inheritedEffort, ...portable } = config
  return { ...portable, ...route }
}

/**
 * Install the fallback routing state machine.
 *
 * Exported for direct lifecycle tests. All handlers fail open: an internal
 * read or bookkeeping failure declines the fallback or preserves the route
 * another request listener selected.
 */
export function installReadImageFallback(ctx: Context, config: Config): void {
  const states = new Map<Agent, FallbackState>()
  // A model-requested tool execution does not carry its turn number. Remember
  // the request that admitted it so same-turn steering cannot restore early.
  const requestTurns = new WeakMap<Agent, number>()

  ctx.on('fs/read-image-route', async (exec, current, next) => {
    const downstream = await next()
    if (downstream !== undefined) return downstream
    try {
      const agent = exec.agent
      if (agent === undefined) return undefined
      const activeTurn = requestTurns.get(agent)
      if (activeTurn === undefined) return undefined
      const fallback = Object.freeze({ provider: config.provider, model: config.model })
      const original = originalConfig(agent, current)
      const candidate: ImageRouteFallback = {
        ...fallback,
        activate() {
          states.set(agent, { activeTurn, fallback, original })
        },
      }
      return candidate
    } catch (error: unknown) {
      ctx.logger.warn(
        `${name}: fallback selection failed open `
        + `(${error instanceof Error ? error.message : String(error)}); preserving the upstream refusal`,
      )
      return undefined
    }
  })

  ctx.on('agent/request', async ({ agent, turn }, next) => {
    const proposed = await next()
    try {
      requestTurns.set(agent, turn)
      const state = states.get(agent)
      if (state === undefined) return proposed
      if (turn === state.activeTurn) return withRoute(proposed, state.fallback)

      states.delete(agent)
      return sameRoute(proposed, state.fallback)
        ? structuredClone(state.original)
        : proposed
    } catch (error: unknown) {
      states.delete(agent)
      ctx.logger.warn(
        `${name}: request routing failed open `
        + `(${error instanceof Error ? error.message : String(error)}); preserving the proposed route`,
      )
      return proposed
    }
  })

  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
    requestTurns.delete(agent)
  })
}

/** Register the Parametria-only route fallback. */
export function apply(ctx: Context, config: Config): void {
  installReadImageFallback(ctx, config)
}
