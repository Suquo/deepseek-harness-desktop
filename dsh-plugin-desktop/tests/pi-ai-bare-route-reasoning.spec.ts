/**
 * The fence for issue #60: what does a BARE OpenRouter route put on the wire
 * for reasoning when nothing selects an effort?
 *
 * PR #59 fixed the declared half of this — the managed `parametria-vision`
 * route no longer declares a valueless `off:`. It could not fix the bare half,
 * and the bare half is the larger one: a route that declares no `models:` at
 * all inherits pi-ai's own catalog entries, and 163 of those entries carry
 * `reasoning: true` with NO `thinkingLevelMap` whatsoever. At the pinned
 * `@earendil-works/pi-ai@0.82.1` the `openrouter` branch of
 * `dist/api/openai-completions.js` read that absence as a declaration:
 *
 *   else if (model.thinkingLevelMap?.off !== null) {
 *       openRouterParams.reasoning = { effort: model.thinkingLevelMap?.off ?? "none" };
 *   }
 *
 * `undefined !== null` is true, so every one of those models had the literal
 * wire spelling `"none"` INVENTED for it. On a reasoning-mandatory endpoint
 * that is a guaranteed `400 ... Reasoning is mandatory for this endpoint and
 * cannot be disabled` — the failure that killed both validator children of
 * 2026-08-20 and, through the operator's bare `openrouter` route, 26 requests
 * across five sessions.
 *
 * `patches/pi-ai@0.82.1.patch` replaces that test in the `openrouter` and
 * `string-thinking` branches — the two whose payload is `map?.off ?? "none"` —
 * with the guard the plain OpenAI-style branch of the same function already
 * uses at `:636-641`, `typeof offValue === "string"`. A declared spelling is
 * still sent; an absent one is no longer manufactured.
 *
 * WHAT THIS FILE ASSERTS. Real `llm` registry, real `llm-pi-ai` adapter, real
 * pinned pi-ai, real catalog entry, against a loopback endpoint that records
 * the request body. It is deliberately NOT built on the preset's managed route:
 * the surface under test is the bare route an operator writes in
 * `~/.dsh/settings.yaml`, which declares nothing but a credential.
 *
 * THE RED HALF IS EXECUTED. The `deepseek` branch of the same function is the
 * one this patch deliberately does NOT touch (its payload is the fixed literal
 * `{ type: "disabled" }`, never the map's value, so there is no spelling for a
 * string guard to require — and 33 catalog models depend on it to honour Off).
 * That branch still runs the pre-fix `map?.off !== null` predicate, so pointing
 * the SAME bare catalog model at it reproduces a manufactured disable live, at
 * this pin, on every run. If upstream ever changes that predicate the fence
 * fails and the green assertions above are re-derived instead of trusted.
 *
 * NOTHING HERE REACHES THE NETWORK. The catalog entry's own `baseUrl` is the
 * real `https://openrouter.ai/api/v1`, so this file never lets a route reach a
 * mount without a loopback override: `streamOnce` builds the endpoint, reads it
 * back OFF THE OBJECT IT IS ABOUT TO MOUNT, and refuses anything that is not
 * `http://127.0.0.1:`. Every reasoning assertion then runs through `wireBody`,
 * which insists on exactly one CAPTURED body, so a request that escaped to the
 * real endpoint is zero captures and a failure rather than a silent pass.
 * `OPENROUTER_API_KEY` is overwritten with a placeholder in `beforeAll` and
 * restored in `afterAll` (process-local under this package's Vitest defaults,
 * `pool: 'forks'` + `isolate: true`), so an operator running the gate with a
 * real key exported never sends it anywhere; no captured header is inspected,
 * asserted on, or printed.
 */

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'

/**
 * The three runtime packages are loaded through COMPUTED specifiers rather than
 * static imports, for the reason PR #59's sibling fence records: both
 * `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-llm-pi-ai` reach
 * `@anthropic-ai/sdk`, whose `internal/types.d.mts:48` probes `undici-types`
 * behind a MISPLACED `@ts-ignore`, and this package keeps `skipLibCheck` off,
 * so a static import of either fails `yarn typecheck` with seven `TS2307`s in a
 * dependency this repository does not own. `@earendil-works/pi-ai` is the same
 * package family and joins them. A computed specifier keeps the runtime edge
 * and drops the type edge; the surfaces actually used are declared below.
 */
const LLM_RUNTIME_SPECIFIER = '@deepseek-ai/dsh-llm'
const PI_AI_PLUGIN_SPECIFIER = '@deepseek-ai/dsh-llm-pi-ai'
/** The pinned catalog itself, the same data the adapter materializes models from. */
const OPENROUTER_CATALOG_SPECIFIER = '@earendil-works/pi-ai/providers/openrouter.models'

/** A bare route names the pi-ai provider and nothing else; this is that key. */
const ROUTE = 'openrouter'
/**
 * The model both dead validator children asked for, and the model the
 * operator's own bare `openrouter` route serves. It is used because it is the
 * incident's model, and the census assertion below states the property that
 * makes it the incident's model rather than assuming it.
 */
const MODEL = 'google/gemini-3.6-flash'
const API_KEY_ENV = 'OPENROUTER_API_KEY'
/** Not a credential: the adapter refuses to send at all when the reference misses. */
const PLACEHOLDER_KEY = 'pi-ai-bare-route-reasoning-spec-placeholder'
/** The body OpenRouter answered 400 to. */
const DISABLE = { effort: 'none' }

/** The pi-ai catalog fields this fence reads, named rather than spread through casts. */
interface CatalogEntry {
  reasoning?: boolean
  thinkingLevelMap?: Record<string, string | null | undefined>
  compat?: { thinkingFormat?: string }
}

/** The service surface these fences drive. */
interface LlmService {
  listModels: (provider: string) => Promise<unknown>
  resolveModelInfo: (provider: string, model: string) => Promise<{
    reasoning?: { efforts?: { id: string }[] }
  }>
  stream: (options: unknown) => AsyncIterable<unknown>
}

/** One route declaration, in the shape `llm-pi-ai` takes under `providers`. */
interface RouteProfile {
  apiKeyEnv: string
  baseURL?: string
  compat?: { thinkingFormat?: string }
  models?: { id: string; reasoningEfforts?: Record<string, string | null> }[]
}

/** What one request through the mounted route produced. */
interface Outcome {
  /** Every request body the endpoint received — empty when nothing was sent. */
  bodies: Record<string, unknown>[]
  /** The stream's own chunks, which carry a refusal the transport never saw. */
  chunks: { type?: string; reason?: { kind?: string; failure?: { code?: string } } }[]
  /** What the route advertises for this model, as any selector would read it. */
  offeredEfforts: string[]
}

/**
 * A bare catalog route: a credential and nothing else. `baseURL` is the single
 * addition, and it is not cosmetic — see the loopback guard in `streamOnce`.
 */
function bareRoute(): RouteProfile {
  return { apiKeyEnv: API_KEY_ENV }
}

let catalog: Record<string, CatalogEntry>
let priorKey: string | undefined

/**
 * Drive one real request through a mounted route and report everything that
 * came back. Failures are values rather than throws because a refusal BEFORE
 * the wire is one of the outcomes under test — but a body is never inferred
 * from silence: `wireBody` below insists on exactly one.
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
    const mountConfig = { providers: { [ROUTE]: { ...route, baseURL } } }
    // The endpoint the request will actually go to, read back off the object
    // being mounted rather than off the string built for it. This matters more
    // here than in the sibling fence: a BARE route inherits the catalog entry's
    // own `https://openrouter.ai/api/v1`, so an override that silently failed
    // to land would send a real request to a real provider.
    const mounted = mountConfig.providers[ROUTE]?.baseURL
    if (mounted !== baseURL || !mounted.startsWith('http://127.0.0.1:')) {
      throw new Error(`refusing to mount a non-loopback endpoint: ${String(mounted)}`)
    }
    const [llmRuntimeModule, piAiModule] = await Promise.all([
      import(LLM_RUNTIME_SPECIFIER),
      import(PI_AI_PLUGIN_SPECIFIER),
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

/**
 * The one request body a route puts on the wire for the given effort selection.
 * Insists on exactly one captured request: a request that never reached the
 * endpoint must fail the test that asked for its body, not satisfy an assertion
 * about a field that body does not have.
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

/**
 * The request carried no reasoning field at all.
 *
 * Two assertions rather than one, and the order is the point: the first PRINTS
 * whatever was sent, so a regression's failure message names the invented body
 * (`{ effort: 'none' }`) instead of reporting `expected true to be false`; the
 * second is the precise claim, because a key present with an `undefined` value
 * is still a key and `JSON.stringify` would drop it from the wire either way.
 */
function expectNoReasoning(body: Record<string, unknown>): void {
  expect(body.reasoning).toBeUndefined()
  expect(Object.hasOwn(body, 'reasoning')).toBe(false)
}

beforeAll(async () => {
  priorKey = process.env[API_KEY_ENV]
  process.env[API_KEY_ENV] = PLACEHOLDER_KEY
  const module = await import(OPENROUTER_CATALOG_SPECIFIER) as { OPENROUTER_MODELS: Record<string, CatalogEntry> }
  catalog = module.OPENROUTER_MODELS
})

afterAll(() => {
  if (priorKey === undefined) delete process.env[API_KEY_ENV]
  else process.env[API_KEY_ENV] = priorKey
})

describe('a bare OpenRouter route on the wire', {
  // MEASURED on win32: the whole file runs in ~1.5-2.5s across five mounts and
  // loopback round trips, with no per-test install to pay. The same ~20x margin
  // over the slowest test that the two sibling wire specs derived.
  timeout: process.platform === 'win32' ? 10_000 : 5_000,
}, () => {
  it('still finds the incident model in the bug class the patch is about', () => {
    // The precondition every assertion below rests on, stated as properties of
    // the INSTALLED catalog rather than assumed from the incident report: this
    // model reasons, declares no level map at all, and selects the branch the
    // patch changed. A pin bump that gives it a map, or moves it off this
    // dialect, makes the rest of this file measure something else — and says so
    // here rather than going quietly green.
    const entry = catalog[MODEL]
    expect(entry).toBeDefined()
    expect(entry?.reasoning).toBe(true)
    expect(entry?.thinkingLevelMap).toBeUndefined()
    expect(entry?.compat?.thinkingFormat).toBe('openrouter')
    // ... and it is not a lone oddity: the class is the reason this is a patch
    // rather than a route edit. Asserted as a floor, so the count moving with
    // the catalog does not churn the fence, while the class emptying out — the
    // one change that would make this file vacuous — fails it.
    const bugClass = Object.entries(catalog).filter(([, model]) =>
      model.reasoning === true
      && model.compat?.thinkingFormat === 'openrouter'
      && typeof model.thinkingLevelMap?.off !== 'string')
    expect(bugClass.length).toBeGreaterThanOrEqual(50)
  })

  it('sends no reasoning field at all when no effort is selected — the bare-route fix', async () => {
    // THE FIX. Before `patches/pi-ai@0.82.1.patch` this body carried
    // `reasoning: { effort: "none" }`, invented from an absent declaration.
    const body = await wireBody(bareRoute())
    expectRealRequest(body)
    expectNoReasoning(body)
  })

  it('still sends the selected effort, so the fix did not disable reasoning', async () => {
    // The other direction of the same branch, which the patch does not touch:
    // an absent map means the selected level goes out under its own name.
    const body = await wireBody(bareRoute(), 'high')
    expectRealRequest(body)
    expect(body.reasoning).toEqual({ effort: 'high' })
  })

  it('still sends a DECLARED string `off` exactly as before the patch', async () => {
    // The regression the patch had to preserve: where the model really does
    // declare a wire spelling for off, that spelling is still what goes out —
    // including when it is the very literal the bare case used to invent. The
    // difference the patch makes is declaration, not value.
    const declared: RouteProfile = {
      ...bareRoute(),
      models: [{ id: MODEL, reasoningEfforts: { off: 'none', high: 'high' } }],
    }
    const body = await wireBody(declared)
    expectRealRequest(body)
    expect(body.reasoning).toEqual(DISABLE)
    // Selecting Off explicitly is the same request: the adapter collapses
    // effort `off` to "nothing selected" before pi-ai is reached
    // (`llm-pi-ai/src/adapter.ts:92`), so both arrive at the same branch.
    const chosen = await wireBody(declared, 'off')
    expectRealRequest(chosen)
    expect(chosen.reasoning).toEqual(DISABLE)
  })

  it('sends nothing for a valueless `off:`, which is what upstream documents that spelling to mean', async () => {
    // A declared-but-valueless `off:` leaves the key ABSENT from
    // `thinkingLevelMap` (`llm-pi-ai/src/catalog.ts:711-719`) precisely so that
    // it can mean "supported, send nothing" (`:657-661`). Under the openrouter
    // branch it did not: absent was read as a declaration of `"none"`, which is
    // what PR #59 had to remove the spelling from the managed route to escape.
    // With the patch the documented meaning holds for this dialect too, and Off
    // is a control that works rather than one that 400s.
    const valueless: RouteProfile = {
      ...bareRoute(),
      models: [{ id: MODEL, reasoningEfforts: { off: null, high: 'high' } }],
    }
    const outcome = await streamOnce(valueless, 'off')
    expect(outcome.offeredEfforts).toEqual(['off', 'high'])
    const [body] = outcome.bodies
    if (body === undefined) throw new Error('the valueless-off route sent no request at all')
    expectRealRequest(body)
    expectNoReasoning(body)
  })

  it('reproduces the pre-fix invention live, through the branch this patch deliberately left alone', async () => {
    // THE RED HALF, executed rather than described. `deepseek` is the third
    // branch of `buildParams` that consults `thinkingLevelMap.off`, and the
    // patch does NOT change it: its payload is the fixed literal
    // `{ type: "disabled" }` and never the map's value, so there is no spelling
    // for a string guard to require, and 33 catalog models rely on it to honour
    // Off. It therefore still runs the pre-fix predicate,
    // `model.thinkingLevelMap?.off !== null`.
    //
    // Pointing the SAME bare catalog model — same absent map, same "no effort
    // selected" — at that branch shows the predicate still reading an absence
    // as a declaration at this pin. That is the behaviour the openrouter branch
    // above no longer has, and this test is what keeps that difference
    // attributable to the patch rather than to anything else about the model.
    //
    // It is also the fence over the deferral: patching `deepseek` too would
    // fail here and force the conversation instead of landing silently.
    const viaUnpatchedBranch: RouteProfile = { ...bareRoute(), compat: { thinkingFormat: 'deepseek' } }
    const body = await wireBody(viaUnpatchedBranch)
    expectRealRequest(body)
    expect(body.thinking).toEqual({ type: 'disabled' })
    // ... and the openrouter branch, on the same model in the same run, does
    // not. Stated as a pair so the difference is attributed to the branch under
    // test and not to the catalog entry.
    const viaPatchedBranch = await wireBody(bareRoute())
    expectRealRequest(viaPatchedBranch)
    expectNoReasoning(viaPatchedBranch)
  })
})
