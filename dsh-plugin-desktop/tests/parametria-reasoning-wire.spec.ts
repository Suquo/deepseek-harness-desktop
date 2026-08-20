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
 * NOTHING HERE REACHES THE NETWORK, by three independent means. The composed
 * route's `baseURL` is the real `https://openrouter.ai/api/v1` (fenced by
 * `dsh-preset-parametria`'s `vision-route.test.mjs:106` against the installed
 * catalog); `streamOnce` replaces it with the loopback server's origin, then
 * reads the endpoint back OFF THE OBJECT IT IS ABOUT TO MOUNT and refuses to
 * mount anything that is not `http://127.0.0.1:`. Every assertion then runs
 * through `wireBody`/`streamOnce`, which insist on exactly one CAPTURED body —
 * a request that escaped to the real endpoint would be zero captures and fail.
 *
 * `OPENROUTER_API_KEY` is overwritten with a placeholder in `beforeAll` and
 * restored in `afterAll`, so an operator running the gate with their real key
 * exported never sends it anywhere, and no captured header is ever inspected,
 * asserted on, or printed. That window is process-local because this package
 * leaves Vitest's defaults in place (`pool: 'forks'`, `isolate: true`), so the
 * overwrite is confined to this file's own worker; a future config that shares
 * a process across files would widen it and this comment is the note that says
 * so.
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
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { prepareDesktopProfile } from '../src/profile.ts'

/**
 * The two LLM plugins are loaded through COMPUTED specifiers, not static
 * imports, and that is deliberate rather than stylistic.
 *
 * Both `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-llm-pi-ai` reach
 * `@anthropic-ai/sdk`, whose `internal/types.d.mts:48` probes `undici-types`
 * through eight relative paths behind a MISPLACED `@ts-ignore` — the pragma
 * sits at the start of the same line, so it suppresses the line after it rather
 * than that one. This package keeps `skipLibCheck` off, so a static import of
 * either plugin fails `yarn typecheck` with seven `TS2307`s inside a dependency
 * this repository does not own and cannot patch from here (measured: adding one
 * static import to an otherwise empty spec reproduces them exactly).
 *
 * A computed specifier keeps the runtime edge and drops the type edge. The cost
 * is confined to this file, and the surface actually used is declared below as
 * `LlmService`; the alternative was turning lib checking off for every test in
 * the package to accommodate one dependency's packaging bug.
 */
const LLM_RUNTIME_SPECIFIER = '@deepseek-ai/dsh-llm'
const PI_AI_SPECIFIER = '@deepseek-ai/dsh-llm-pi-ai'

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
    const received: Buffer[] = []
    request.on('data', chunk => received.push(chunk as Buffer))
    request.on('end', () => {
      // Only the body is read. Headers carry the credential reference's value
      // and are deliberately never inspected, asserted on, or logged.
      //
      // A body that does not parse is recorded rather than thrown: a throw in a
      // request listener is an uncaught exception that takes the worker down
      // with a stack naming no test, where a recorded value fails the assertion
      // that asked for the body.
      const text = Buffer.concat(received).toString('utf8')
      try {
        bodies.push(JSON.parse(text) as Record<string, unknown>)
      } catch {
        bodies.push({ unparseableBody: text })
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  // Everything after the socket is bound runs under the cleanup below —
  // including the dynamic imports and both mounts, any of which can throw.
  const disposers: (() => Promise<unknown> | unknown)[] = [() => server.close()]
  try {
    const { port } = server.address() as AddressInfo
    const baseURL = `http://127.0.0.1:${port}/v1`
    const ctx = new Context()
    // The route config is the YAML the composition pipeline produced, unedited
    // except for the endpoint.
    const mountConfig = { providers: { [ROUTE]: { ...route, baseURL } } }
    // The endpoint the request will actually go to, read back off the object
    // being mounted rather than off the string built for it: this is the check
    // that keeps a composed `https://openrouter.ai/api/v1` from surviving into
    // a mount, which would spend real credit and answer a real 400.
    const mounted = mountConfig.providers[ROUTE]?.baseURL
    if (mounted !== baseURL || !mounted.startsWith('http://127.0.0.1:')) {
      throw new Error(`refusing to mount a non-loopback endpoint: ${String(mounted)}`)
    }
    const [llmRuntimeModule, piAiModule] = await Promise.all([
      import(LLM_RUNTIME_SPECIFIER),
      import(PI_AI_SPECIFIER),
    ])
    // `undefined` is the config the runtime takes: it is a Service with no
    // options, and passing it explicitly is what the typed overload expects.
    const runtime = ctx.plugin(llmRuntimeModule.default as never, undefined as never)
    disposers.unshift(() => runtime.dispose())
    const provider = ctx.plugin(piAiModule as never, mountConfig as never)
    disposers.unshift(() => provider.dispose())
    // Awaiting each fiber is the readiness signal — no sleep, and no polling
    // window that could pass for "registered" on a slow machine. `llm-pi-ai`
    // declares `inject: ['llm']`, so its fiber settles only once the runtime is
    // attached and its own routes are registered.
    await runtime
    await provider
    const llm = (ctx as unknown as { llm: LlmService }).llm
    // Throws `NO_ADAPTER` if the route did not register, which is a failure of
    // the thing under test rather than a reason to keep waiting.
    await llm.listModels(ROUTE)
    const info = await llm.resolveModelInfo(ROUTE, MODEL)
    offeredEfforts = (info.reasoning?.efforts ?? []).map(entry => entry.id)
    for await (const chunk of llm.stream({
      provider: ROUTE,
      model: MODEL,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
      ...effort === undefined ? {} : { reasoningEffort: effort },
    })) chunks.push(chunk as Outcome['chunks'][number])
  } finally {
    // Every disposer runs even if an earlier one rejects: a failing dispose
    // must not leak the socket behind it, and must not replace the failure the
    // test was about with its own.
    await Promise.allSettled(disposers.map(dispose => dispose()))
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
  const [body] = outcome.bodies
  if (outcome.bodies.length !== 1 || body === undefined) {
    throw new Error(
      `expected exactly one captured request, got ${outcome.bodies.length}`
      + ` (stream chunks: ${JSON.stringify(outcome.chunks)})`,
    )
  }
  return body
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

// The budget is passed to the HOOK, not inherited from the `describe` below: a
// suite-level `timeout` applies to tests only, and a hook falls back to
// `config.hookTimeout`, which this package does not set. The install here is the
// single slowest step in the file, so leaving it on the 5s default would have
// given it a TIGHTER ceiling than the sibling spec that runs four of them inside
// `it` blocks under 10s.
beforeAll(() => {
  priorKey = process.env[API_KEY_ENV]
  process.env[API_KEY_ENV] = PLACEHOLDER_KEY
  composedRoute = composeRoute()
}, process.platform === 'win32' ? 20_000 : 10_000)

afterAll(() => {
  if (priorKey === undefined) delete process.env[API_KEY_ENV]
  else process.env[API_KEY_ENV] = priorKey
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('the parametria-vision route on the wire', {
  // MEASURED on win32: 2.2-2.4s for the whole file, of which the tests are
  // ~0.9-1.8s across five mounts and loopback round trips; the install and
  // composition are paid once in the hook above, under its own budget. The
  // sibling `parametria-machine-route.spec.ts` derived 10s from ~480ms tests;
  // the same ~20x ratio over the slowest test here lands in the same place.
  timeout: process.platform === 'win32' ? 10_000 : 5_000,
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
    const [preFixBody] = preFix.bodies
    if (preFixBody === undefined) throw new Error('the pre-fix route sent no request at all')
    expectRealRequest(preFixBody)
    expect(preFixBody.reasoning).toEqual(DISABLE)
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
