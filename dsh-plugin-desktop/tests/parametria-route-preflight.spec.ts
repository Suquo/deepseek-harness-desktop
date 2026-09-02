/** Fences for Parametria's boot-time pinned-route preflight (issue #52). */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  LlmAdapter,
  LlmRuntime,
  type GenerateOptions,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  ROUTE_REMEDY,
  SUBAGENT_PLUGIN,
  apply,
  installRoutePreflight,
  pinnedSubagentProviders,
  unresolvedRouteBanner,
  type RouteEntry,
} from '../src/parametria-route-preflight.ts'

/** Adapter used only to mutate the real registry; no request is made. */
class SilentAdapter extends LlmAdapter {
  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await Promise.resolve()
  }
}

function row(
  provider?: string,
  options: { disabled?: boolean; name?: string } = {},
): RouteEntry {
  return {
    disabled: options.disabled ?? false,
    options: {
      name: options.name ?? SUBAGENT_PLUGIN,
      config: provider === undefined ? {} : { agentOptions: { provider } },
    },
  }
}

async function mounted(entries: RouteEntry[]) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const injected: UserMessage[] = []
  const agent = {
    inject(message: UserMessage) {
      injected.push(message)
    },
  } as Agent
  installRoutePreflight(ctx, () => entries)

  const start = () => ctx.emit('agent/session-start', { agent, source: 'startup' })
  return { ctx, injected, start }
}

describe('provider pins are derived from the mounted rows', () => {
  it('finds every active subagent pin, de-duplicates it, and ignores unrelated rows', () => {
    expect(pinnedSubagentProviders([
      row('future-vision-route'),
      row('future-vision-route'),
      row('disabled-route', { disabled: true }),
      row('not-a-subagent', { name: 'another-plugin' }),
      row(),
      row('second-route'),
    ])).toEqual(['future-vision-route', 'second-route'])
  })

  it('contains no preset provider list in the implementation', () => {
    const source = readFileSync(
      new URL('../src/parametria-route-preflight.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('parametria-vision')
  })
})

describe('session-start preflight against the live LLM registry', () => {
  it('is loud while an invented pinned route is absent, silent when registered, and loud after disposal', async () => {
    const route = 'future-vision-route'
    const { ctx, injected, start } = await mounted([row(route)])

    start()
    expect(injected).toHaveLength(1)
    expect(injected[0]?.source).toMatchObject({
      kind: 'plugin',
      plugin: 'parametria-route-preflight',
      form: 'notice',
    })
    expect(injected[0]?.content).toEqual([{
      type: 'text',
      text: unresolvedRouteBanner([route]),
    }])
    expect(unresolvedRouteBanner([route])).toContain(route)
    expect(unresolvedRouteBanner([route])).toContain(ROUTE_REMEDY)

    const registration = ctx.llm.registerAdapter([route], new SilentAdapter())
    start()
    expect(injected).toHaveLength(1)

    registration()
    start()
    expect(injected).toHaveLength(2)
  })

  it('stays silent when every pinned route is registered', async () => {
    const { ctx, injected, start } = await mounted([row('route-one'), row('route-two')])
    ctx.llm.registerAdapter(['route-one', 'route-two'], new SilentAdapter())

    start()

    expect(injected).toEqual([])
  })

  it('re-reads the mounted rows at session start', async () => {
    const entries: RouteEntry[] = []
    const { injected, start } = await mounted(entries)
    start()
    expect(injected).toEqual([])

    entries.push(row('added-after-mount'))
    start()
    expect(injected[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('added-after-mount'),
    })
  })

  it('binds apply() to the loader tree that owns its preset row', async () => {
    const entries = [row('tree-owned-route')]
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    Object.assign(ctx.fiber, {
      entry: {
        parent: {
          tree: {
            *entries() {
              yield* entries
            },
          },
        },
      },
    })
    const injected: UserMessage[] = []
    const agent = {
      inject(message: UserMessage) {
        injected.push(message)
      },
    } as Agent

    apply(ctx, {})
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    expect(injected[0]?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('tree-owned-route'),
    })
  })
})

describe('Cordis namespace module shape', () => {
  it('exports name, inject, and apply as siblings with no default export', () => {
    const source = readFileSync(
      new URL('../src/parametria-route-preflight.ts', import.meta.url),
      'utf8',
    )
    expect(source).toMatch(/^export const name =/m)
    expect(source).toMatch(/^export const inject =/m)
    expect(source).toMatch(/^export function apply\(/m)
    expect(source).not.toMatch(/export default/u)
  })
})
