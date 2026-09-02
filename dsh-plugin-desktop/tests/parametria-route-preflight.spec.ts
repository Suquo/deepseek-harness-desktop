/** Fences for Parametria's boot-time pinned-route preflight (issue #52). */

import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  LlmAdapter,
  LlmRuntime,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import {
  SessionId,
  SessionStore,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
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
  options: { name?: string } = {},
): RouteEntry {
  return {
    options: {
      name: options.name ?? SUBAGENT_PLUGIN,
      config: provider === undefined ? {} : { agentOptions: { provider } },
    },
  }
}

let nextSession = 0

async function mounted(entries: RouteEntry[]) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  const session = ctx.sessions.create(SessionId(`route-preflight-${++nextSession}`))
  const published: SessionEvent[] = []
  ctx.on('session/event', (observed, event) => {
    if (observed === session) published.push(event)
  })
  const agent = { session } as Agent
  installRoutePreflight(ctx, () => entries)

  const start = () => ctx.emit('agent/session-start', { agent, source: 'startup' })
  return { ctx, published, session, start }
}

interface CompositionRow {
  name?: string
  group?: boolean
  config?: unknown
}

const JS_TAG = {
  tag: 'tag:yaml.org,2002:js',
  resolve: (source: string) => source,
}

function compositionEntries(rows: readonly CompositionRow[]): RouteEntry[] {
  const entries: RouteEntry[] = []
  for (const candidate of rows) {
    if (typeof candidate.name === 'string') {
      entries.push({ options: { name: candidate.name, config: candidate.config } })
    }
    if (candidate.group === true && Array.isArray(candidate.config)) {
      entries.push(...compositionEntries(candidate.config as CompositionRow[]))
    }
  }
  return entries
}

function noticeText(session: Session): string[] {
  return session.events.flatMap(event => {
    if (event.type !== 'user/message' || event.data.source.kind !== 'plugin') return []
    return event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
  })
}

describe('provider pins are derived from the mounted rows', () => {
  it('finds every subagent pin, de-duplicates it, and ignores unrelated rows', () => {
    expect(pinnedSubagentProviders([
      row('future-vision-route'),
      row('future-vision-route'),
      row('not-a-subagent', { name: 'another-plugin' }),
      row(),
      row('second-route'),
    ])).toEqual(['future-vision-route', 'second-route'])
  })
})

describe('session-start preflight against the live LLM registry', () => {
  it('is loud while an invented pinned route is absent, silent when registered, and loud after disposal', async () => {
    const route = 'future-vision-route'
    const { ctx, published, session, start } = await mounted([row(route)])

    start()
    expect(published).toHaveLength(1)
    expect(session.events).toHaveLength(1)
    expect(session.surface.nodes).toEqual([0])
    expect(session.events[0]?.type).toBe('user/message')
    const message = session.events[0]?.type === 'user/message'
      ? session.events[0].data
      : undefined
    expect(message?.source).toMatchObject({
      kind: 'plugin',
      plugin: 'parametria-route-preflight',
      form: 'notice',
      summary: expect.stringContaining(ROUTE_REMEDY),
    })
    expect((message?.source as { summary?: string } | undefined)?.summary).toContain(route)
    expect(message?.content).toEqual([{
      type: 'text',
      text: unresolvedRouteBanner([route]),
    }])
    expect(unresolvedRouteBanner([route])).toContain(route)
    expect(unresolvedRouteBanner([route])).toContain(ROUTE_REMEDY)

    const registration = ctx.llm.registerAdapter([route], new SilentAdapter())
    start()
    expect(session.events).toHaveLength(1)

    registration()
    start()
    expect(session.events).toHaveLength(2)
  })

  it('stays silent when every pinned route is registered', async () => {
    const { ctx, session, start } = await mounted([row('route-one'), row('route-two')])
    ctx.llm.registerAdapter(['route-one', 'route-two'], new SilentAdapter())

    start()

    expect(session.events).toEqual([])
  })

  it('re-reads the mounted rows at session start', async () => {
    const entries: RouteEntry[] = []
    const { session, start } = await mounted(entries)
    start()
    expect(session.events).toEqual([])

    entries.push(row('added-after-mount'))
    start()
    expect(noticeText(session)).toEqual([
      expect.stringContaining('added-after-mount'),
    ])
  })

  it('binds apply() to the loader tree that owns its preset row', async () => {
    const entries = [row('tree-owned-route')]
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
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
    const session = ctx.sessions.create(SessionId(`route-preflight-${++nextSession}`))
    const agent = { session } as Agent

    apply(ctx, {})
    ctx.emit('agent/session-start', { agent, source: 'startup' })

    expect(noticeText(session)).toEqual([
      expect.stringContaining('tree-owned-route'),
    ])
  })

  it('exercises the shipped preset with and without every route declared by its machine patch', async () => {
    const preset = parse(readFileSync(
      new URL('../../dsh-preset-parametria/preset/agent.cordis.yml', import.meta.url),
      'utf8',
    ), { customTags: [JS_TAG] }) as CompositionRow[]
    const machine = parse(readFileSync(
      new URL('../../dsh-preset-parametria/machine/cordis.patch.yml', import.meta.url),
      'utf8',
    ), { customTags: [JS_TAG] }) as Array<{
      id?: string
      config?: { providers?: Record<string, unknown> }
    }>
    const routeRow = machine.find(candidate => candidate.id === 'llm-pi-ai')
    const declaredRoutes = Object.keys(routeRow?.config?.providers ?? {})
    const entries = compositionEntries(preset)
    const pins = pinnedSubagentProviders(entries)
    expect(pins.length).toBeGreaterThan(0)
    expect(declaredRoutes).toEqual(expect.arrayContaining(pins))

    const missing = await mounted(entries)
    missing.start()
    expect(noticeText(missing.session)).toEqual([
      expect.stringContaining(pins[0] as string),
    ])
    expect(noticeText(missing.session)[0]).toContain(ROUTE_REMEDY)

    const installed = await mounted(entries)
    installed.ctx.llm.registerAdapter(declaredRoutes, new SilentAdapter())
    installed.start()
    expect(installed.session.events).toEqual([])
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
