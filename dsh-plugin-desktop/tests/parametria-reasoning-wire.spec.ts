/**
 * The fence issue #53 was missing: what does the `parametria-vision` route
 * actually PUT ON THE WIRE for reasoning?
 *
 * Every existing fence over that route reads a source file. None of them can
 * see a request body, so all of them stayed green while both validator children
 * of 2026-08-20 (sessions `de0ce2b8` and `2c7adafa`) died at their first request
 * with OpenRouter `400 Reasoning is mandatory for this endpoint and cannot be
 * disabled` (`INVALID_REQUEST`) — the route was sending an explicit
 * reasoning-disable that nobody had written and no static check could name.
 *
 * WHY IT SENT ONE. The block used to declare a valueless `off:`, on upstream's
 * own documented semantics for that spelling — "supported, send nothing",
 * `packages/llm/llm-pi-ai/src/catalog.ts:657-661`. Measured at the current pin,
 * those semantics are DIALECT-SPECIFIC:
 *
 *   1. `llm-pi-ai/src/adapter.ts:92` collapses effort `off` to `undefined`, so
 *      "Off selected" and "nothing selected" are the same request by the time
 *      pi-ai is called.
 *   2. `llm-pi-ai/src/catalog.ts:711-719` pins every UNDECLARED level to `null`
 *      but leaves a declared-but-valueless `off` ABSENT from
 *      `thinkingLevelMap`.
 *   3. pi-ai `dist/api/openai-completions.js:598-608` — the `openrouter` branch
 *      this route selects — then runs
 *      `else if (map?.off !== null) params.reasoning = { effort: map?.off ?? 'none' }`.
 *      `undefined !== null`, so ABSENT sends `"none"`. The plain `openai`
 *      branch at `:636-641` guards on `typeof offValue === 'string'` and really
 *      does send nothing, which is why the upstream comment reads true.
 *
 * WHAT THIS FILE ASSERTS. The whole chain the operator's machine runs — the
 * real installer, `prepareDesktopProfile` + `composeEntries`, the real `llm`
 * registry, the real `llm-pi-ai` adapter, the pinned pi-ai — against a loopback
 * endpoint that records the request body. Both directions: the fixed route
 * cannot emit a disable under any effort selection, and re-introducing the
 * valueless `off:` into that same composed config reproduces the exact
 * 400-producing body. The red half is executed, not described, so this fence
 * cannot rot into an assertion about a shape upstream no longer produces.
 *
 * NOTHING HERE REACHES THE NETWORK. The composed route's `baseURL` is the real
 * `https://openrouter.ai/api/v1` (fenced by `dsh-preset-parametria`'s
 * `vision-route.test.mjs` against the installed catalog); this file replaces it
 * with the loopback server's origin and asserts the replacement took before
 * mounting anything. `OPENROUTER_API_KEY` is overwritten with a placeholder for
 * the duration and restored afterwards, so an operator running the gate with
 * their real key exported never sends it anywhere, and no captured header is
 * ever asserted on or printed.
 */

import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as piAiPlugin from '@deepseek-ai/dsh-llm-pi-ai'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { prepareDesktopProfile } from '../src/profile.ts'

const PRESET_ROOT = fileURLToPath(new URL('../../dsh-preset-parametria/', import.meta.url))
const INSTALLER = join(PRESET_ROOT, 'scripts', 'install-profile.mjs')
const ROUTE = 'parametria-vision'
const MODEL = 'google/gemini-3.6-flash'
const API_KEY_ENV = 'OPENROUTER_API_KEY'
/** Not a credential: the adapter refuses to send at all when the reference misses. */
const PLACEHOLDER_KEY = 'parametria-reasoning-wire-spec-placeholder'
/** The body upstream OpenRouter answered 400 to. */
const DISABLE = { effort: 'none' }

interface RouteProfile {
  baseURL: string
  compat?: { thinkingFormat?: string }
  models: { id: string; reasoningEfforts?: Record<string, string | null> }[]
}

const homes: string[] = []
let composedRoute: RouteProfile
let priorKey: string | undefined

/**
 * The `parametria-vision` route exactly as the operator's machine composes it:
 * the real installer writes the machine-wide patch, and the launcher's own
 * profile preparation and composition read it back. Taking the config from here
 * rather than from the package file is what makes this a fence over what SHIPS
 * — an installer that stopped writing the block, or a composition that dropped
 * it, fails here rather than passing on a hand-built fixture.
 */
function composeRoute(): RouteProfile {
  const home = mkdtempSync(join(tmpdir(), 'dsh-reasoning-wire-'))
  homes.push(home)
  execFileSync(process.execPath, [INSTALLER, '--home', home], { stdio: 'pipe' })
  const rows: EntryOptions[] = []
  const walk = (entries: readonly EntryOptions[]): void => {
    for (const row of entries) {
      rows.push(row)
      if (row.group === true && Array.isArray(row.config)) walk(row.config as EntryOptions[])
    }
  }
  walk(composeEntries([prepareDesktopProfile('1', home, 'win32', 'desktop').patches]))
  const config = rows.find(row => row.id === 'llm-pi-ai')?.config as
    { providers?: Record<string, RouteProfile> } | undefined
  const route = config?.providers?.[ROUTE]
  if (route === undefined) throw new Error(`the composed desktop profile declares no "${ROUTE}" route`)
  return route
}

/** What one request through the mounted route produced. */
interface Outcome {
  /** Every request body the endpoint received — empty when nothing was sent. */
  bodies: Record<string, unknown>[]
  /** The stream's own chunks, which carry a refusal the transport never saw. */
  chunks: { type?: string; reason?: { kind?: string; failure?: { code?: string; message?: string } } }[]
  /** What the route advertises for this model, as any selector would read it. */
  offeredEfforts: string[]
}

/**
 * Drive one real request through the mounted route and report everything that
 * came back. Failures are values here rather than throws because a refusal
 * BEFORE the wire is one of the outcomes under test — but a body is never
 * inferred from silence: `wireBody` below insists on exactly one.
 */
async function streamOnce(route: RouteProfile, effort?: string): Promise<Outcome> {
  const bodies: Record<string, unknown>[] = []
  const chunks: Outcome['chunks'] = []
  let offeredEfforts: string[] = []
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      // Only the body is read. Headers carry the credential reference's value
      // and are deliberately never inspected, asserted on, or logged.
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const baseURL = `http://127.0.0.1:${port}/v1`
  if (!baseURL.startsWith('http://127.0.0.1:')) throw new Error('refusing to mount a non-loopback endpoint')
  const ctx = new Context()
  try {
    ctx.plugin(LlmRuntime)
    ctx.plugin(piAiPlugin, { providers: { [ROUTE]: { ...route, baseURL } } })
    // Both plugins mount on their own fibers, so readiness is polled through
    // the registry itself rather than slept on: the service is absent until
    // `LlmRuntime` attaches, and `listModels` throws `NO_ADAPTER` until
    // `llm-pi-ai` has registered this route.
    const deadline = Date.now() + 10_000
    let llm: LlmService
    for (;;) {
      const service = (ctx as unknown as { llm?: LlmService }).llm
      try {
        if (service === undefined) throw new Error('the llm service has not attached yet')
        await service.listModels(ROUTE)
        llm = service
        break
      } catch (error) {
        if (Date.now() > deadline) throw error
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    }
    const info = await llm.resolveModelInfo(ROUTE, MODEL)
    offeredEfforts = (info.reasoning?.efforts ?? []).map(entry => entry.id)
    for await (const chunk of llm.stream({
      provider: ROUTE,
      model: MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })) chunks.push(chunk as Outcome['chunks'][number])
  } finally {
    await ctx.stop?.()
    server.close()
  }
  return { bodies, chunks, offeredEfforts }
}

/** The service surface these fences drive, named rather than spread through casts. */
interface LlmService {
  listModels: (provider: string) => Promise<unknown>
  resolveModelInfo: (provider: string, model: string) => Promise<{
    reasoning?: { efforts?: { id: string }[] }
  }>
  stream: (options: unknown) => AsyncIterable<unknown>
}

/**
 * The one request body this route puts on the wire for the given effort
 * selection. Insists on exactly one captured request: a request that never
 * reached the endpoint must fail the test that asked for its body, not satisfy
 * an assertion about a field that body does not have.
 */
async function wireBody(route: RouteProfile, effort?: string): Promise<Record<string, unknown>> {
  const outcome = await streamOnce(route, effort)
  if (outcome.bodies.length !== 1) {
    throw new Error(
      `expected exactly one captured request, got ${outcome.bodies.length}`
      + ` (stream chunks: ${JSON.stringify(outcome.chunks)})`,
    )
  }
  return outcome.bodies[0]
}

/**
 * The body reached the endpoint and is the request under test. Asserted before
 * every reasoning claim so an absent `reasoning` field can only ever mean "this
 * request carried none", never "there was no request".
 */
function expectRealRequest(body: Record<string, unknown>): void {
  expect(body).toMatchObject({ model: MODEL, stream: true })
}

/** The same composed route with the pre-fix valueless `off:` put back. */
function withValuelessOff(route: RouteProfile): RouteProfile {
  return {
    ...route,
    models: route.models.map(model => (model.id === MODEL
      ? { ...model, reasoningEfforts: { off: null, ...model.reasoningEfforts } }
      : model)),
  }
}

beforeAll(() => {
  priorKey = process.env[API_KEY_ENV]
  process.env[API_KEY_ENV] = PLACEHOLDER_KEY
  composedRoute = composeRoute()
})

afterAll(() => {
  if (priorKey === undefined) delete process.env[API_KEY_ENV]
  else process.env[API_KEY_ENV] = priorKey
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('the parametria-vision route on the wire', {
  // MEASURED on win32: one install + one composition in `beforeAll`, then five
  // loopback round trips at ~200-400ms each, 2.4s for the file. The sibling
  // `parametria-machine-route.spec.ts` derived 10s for four installs; this file
  // pays one install and adds only local HTTP, so the same ceiling is generous
  // by the same margin.
  timeout: process.platform === 'win32' ? 20_000 : 10_000,
}, () => {
  it('still speaks the dialect this fence measured, so a change re-opens the question', () => {
    // Every assertion below is a statement about the `openrouter` branch of
    // `openai-completions.js`. The other branches disagree with it — `openai`
    // sends nothing where this one sends `"none"` — so a silent dialect change
    // would leave the fence green while measuring something else.
    expect(composedRoute.compat?.thinkingFormat).toBe('openrouter')
  })

  it('sends no reasoning field at all when no effort is selected — the validator\'s case', async () => {
    // A `subagent_validator` child is spawned with `agentOptions` naming only
    // the provider and model, and the route declares no default effort, so this
    // is exactly the request both dead children made.
    const body = await wireBody(composedRoute)
    expectRealRequest(body)
    expect(Object.hasOwn(body, 'reasoning')).toBe(false)
  })

  it('no longer offers Off at all, and refuses one BEFORE the wire if something names it anyway', async () => {
    // The user-visible half of the fix, measured rather than assumed. Omitting
    // the key pins `off` to `null` in `thinkingLevelMap`, and pi-ai reports a
    // null level as unsupported (`dist/models.js:392-402`), so the selector
    // stops showing Off for this route.
    //
    // That is the honest surface for this endpoint: OpenRouter mandates
    // reasoning here, so an Off control was never a capability the route had —
    // it was a control that produced a mid-turn 400. A caller that names `off`
    // regardless is now refused by the adapter, naming the route, the model and
    // the effort, with NOTHING sent (`llm-pi-ai/src/adapter.ts:129-141`) —
    // distinguishable from an unknown failure, and cheaper than a provider
    // rejection after the request is durable.
    const outcome = await streamOnce(composedRoute, 'off')
    expect(outcome.offeredEfforts).toEqual(['high'])
    expect(outcome.bodies).toEqual([])
    expect(outcome.chunks).toContainEqual(expect.objectContaining({
      reason: expect.objectContaining({
        kind: 'error',
        failure: expect.objectContaining({ code: 'UNSUPPORTED_REASONING_EFFORT' }),
      }),
    }))
  })

  it('still sends the declared thinking level when High is selected', async () => {
    // The other direction of the same seam: removing `off` must not have made
    // the route stop reasoning on request.
    const body = await wireBody(composedRoute, 'high')
    expectRealRequest(body)
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('reproduces the 400-producing body the moment a valueless `off:` comes back', async () => {
    // THE RED HALF, executed rather than asserted from memory. This is the
    // pre-fix composed config, one key different, and the body it produces is
    // the one OpenRouter answered `400 Reasoning is mandatory for this endpoint
    // and cannot be disabled` to. If upstream ever changes that branch, this
    // fails and the green assertions above are re-derived rather than trusted.
    const preFix = await streamOnce(withValuelessOff(composedRoute))
    expect(preFix.bodies).toHaveLength(1)
    expectRealRequest(preFix.bodies[0])
    expect(preFix.bodies[0].reasoning).toEqual(DISABLE)
    // The same key is also what made Off selectable, which is how a control
    // that could only ever 400 came to be offered in the first place.
    expect(preFix.offeredEfforts).toEqual(['off', 'high'])
    // ... and with the key back out, the same request carries nothing. Stated
    // as a pair so the difference is attributed to the declaration under test
    // and not to anything else in the composed route.
    const fixed = await wireBody(composedRoute)
    expectRealRequest(fixed)
    expect(Object.hasOwn(fixed, 'reasoning')).toBe(false)
  })
})
