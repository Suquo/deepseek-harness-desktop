/**
 * The fence for issues #60 and #62: what do BARE pi-ai routes put on the wire
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
 * uses (pre-patch `:636-641`, `:652-657` in the patched file),
 * `typeof offValue === "string"`. A declared spelling is still sent; an absent
 * one is no longer manufactured.
 *
 * WHAT THIS FILE ASSERTS. Real `llm` registry, real `llm-pi-ai` adapter, real
 * pinned pi-ai, real catalog entry, against a loopback endpoint that records
 * the request body. It is deliberately NOT built on the preset's managed route:
 * the surface under test is the bare route an operator writes in
 * `~/.dsh/settings.yaml`, which declares nothing but a credential.
 *
 * Issue #62 grounds the remaining asymmetric branches. DeepSeek-format models
 * use declaration -> documented model allowlist -> omission precedence: a
 * declared string goes out verbatim, explicit null omits, and the fixed
 * `disabled` fallback is reserved for IDs whose provider documents the toggle.
 * Azure Responses has no safe fallback at this pin and sends only a declared
 * string. An exhaustive catalog census couples every absent-Off DeepSeek route
 * to the exported cited allowlist or a cited deny set, so a pin change cannot
 * silently enter either behavior class.
 *
 * NOTHING HERE REACHES THE NETWORK. Each catalog entry's own `baseUrl` names a
 * real provider, and the mount overrides it with a loopback origin. The check
 * that this WORKED is not the override itself but
 * `wireBody`, which insists on exactly one CAPTURED body: a request that went
 * to the real endpoint instead is zero captures and a failure rather than a
 * silent pass.
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
/** Public exhaustive catalog readers; a new provider cannot hide from the census. */
const ALL_CATALOG_SPECIFIER = '@earendil-works/pi-ai/providers/all'
/** The patched module exports the RM-ruled, source-cited DeepSeek allowlist. */
const OPENAI_COMPLETIONS_SPECIFIER = '@earendil-works/pi-ai/api/openai-completions'

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

interface WireTarget {
  provider: string
  model: string
}

const OPENROUTER_TARGET: WireTarget = { provider: ROUTE, model: MODEL }
const DEEPSEEK_DENY_TARGET: WireTarget = { provider: 'moonshotai', model: 'kimi-k2-thinking' }
const DEEPSEEK_ALLOW_TARGET: WireTarget = { provider: 'deepseek', model: 'deepseek-v4-flash' }
const DEEPSEEK_NULL_TARGET: WireTarget = { provider: 'moonshotai', model: 'kimi-k2.7-code' }
const AZURE_UNDECLARED_TARGET: WireTarget = { provider: 'azure-openai-responses', model: 'o3' }

/**
 * Models whose vendor says thinking cannot be disabled. Deny stays test-side
 * because omission is the safe production default, but the census must name
 * and source every current member of that class.
 */
const DEEPSEEK_THINKING_DISABLE_DENY_MODEL_SOURCES = Object.freeze({
  'kimi-k2-thinking': 'Moonshot Kimi CLI: https://github.com/MoonshotAI/kimi-cli',
  'kimi-k2-thinking-turbo': 'Moonshot Kimi CLI: https://github.com/MoonshotAI/kimi-cli',
})

/** The pi-ai catalog fields this fence reads, named rather than spread through casts. */
interface CatalogEntry {
  id?: string
  provider?: string
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

interface CatalogModule {
  getBuiltinProviders: () => string[]
  getBuiltinModels: (provider: never) => CatalogEntry[]
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
let allCatalog: CatalogModule
let deepseekDisableModelSources: Readonly<Record<string, string>>
let priorKey: string | undefined

/**
 * Drive one real request through a mounted route and report everything that
 * came back. Failures are values rather than throws because a refusal BEFORE
 * the wire is one of the outcomes under test — but a body is never inferred
 * from silence: `wireBody` below insists on exactly one.
 */
async function streamOnce(
  route: RouteProfile,
  effort?: string,
  target: WireTarget = OPENROUTER_TARGET,
): Promise<Outcome> {
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
    // A caller must not bring its own endpoint. The override below is appended
    // last and would silently win, so a route that arrived carrying a real
    // `baseURL` would look mounted-to-loopback while saying otherwise about
    // what the file is testing. Checked against the CALLER's object, which is
    // not built here — re-reading the literal one line above it would assert
    // nothing.
    if (route.baseURL !== undefined) {
      throw new Error(`routes in this file declare no endpoint of their own; got ${route.baseURL}`)
    }
    const mountConfig = { providers: { [target.provider]: { ...route, baseURL } } }
    // What actually proves nothing escaped to the catalog entry's real endpoint
    // is not this override but `wireBody`'s insistence on exactly one CAPTURED
    // body. A request that went elsewhere is zero captures and a named failure.
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
    await llm.listModels(target.provider)
    const info = await llm.resolveModelInfo(target.provider, target.model)
    offeredEfforts = (info.reasoning?.efforts ?? []).map(entry => entry.id)
    for await (const chunk of llm.stream({
      provider: target.provider,
      model: target.model,
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
async function wireBody(
  route: RouteProfile,
  effort?: string,
  target: WireTarget = OPENROUTER_TARGET,
): Promise<Record<string, unknown>> {
  const outcome = await streamOnce(route, effort, target)
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
function expectRealRequest(body: Record<string, unknown>, target: WireTarget = OPENROUTER_TARGET): void {
  expect(body).toMatchObject({ model: target.model, stream: true })
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

function expectNoThinking(body: Record<string, unknown>): void {
  expect(body.thinking).toBeUndefined()
  expect(Object.hasOwn(body, 'thinking')).toBe(false)
}

beforeAll(async () => {
  priorKey = process.env[API_KEY_ENV]
  process.env[API_KEY_ENV] = PLACEHOLDER_KEY
  const [openrouterModule, catalogModule, completionsModule] = await Promise.all([
    import(OPENROUTER_CATALOG_SPECIFIER),
    import(ALL_CATALOG_SPECIFIER),
    import(OPENAI_COMPLETIONS_SPECIFIER),
  ])
  catalog = (openrouterModule as { OPENROUTER_MODELS: Record<string, CatalogEntry> }).OPENROUTER_MODELS
  allCatalog = catalogModule as CatalogModule
  deepseekDisableModelSources = (completionsModule as {
    DEEPSEEK_THINKING_DISABLE_MODEL_SOURCES?: Readonly<Record<string, string>>
  }).DEEPSEEK_THINKING_DISABLE_MODEL_SOURCES ?? {}
})

afterAll(() => {
  if (priorKey === undefined) delete process.env[API_KEY_ENV]
  else process.env[API_KEY_ENV] = priorKey
})

describe('a bare pi-ai route on the wire', {
  // MEASURED on win32: the whole file runs in ~1.5-2.5s across its mounts and
  // loopback round trips, with no per-test install to pay. The slowest test is
  // the first, which absorbs the module graph's cold import. The same ~20x
  // margin over it that the two sibling wire specs derived.
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
    // With the patch the documented meaning holds for this dialect too.
    //
    // "Send nothing" is the claim, and it is the whole claim: this branch emits
    // only `{ effort: ... }`, and OpenRouter's effort enum has no disable
    // spelling, so selecting Off on such a route now means the provider's own
    // default applies. That is the documented dispatch, not a disable — and it
    // is the honest surface for an endpoint that mandates reasoning, where the
    // alternative was a control that could only 400. A route that wants Off to
    // actually suppress reasoning needs a wire spelling its provider accepts.
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

  it('covers the patch\'s OTHER branch: `string-thinking` obeys the same rule', async () => {
    // The patch changes two branches, and this is the second. No catalog model
    // ships on this dialect (measured: zero across every installed
    // `dist/providers/*.models.js`), so without these two cases half the patch
    // would be revertible with the gate still green — and it is reachable, by
    // exactly the route-level `compat` override used below and in the red half.
    const bare: RouteProfile = { ...bareRoute(), compat: { thinkingFormat: 'string-thinking' } }
    const nothingDeclared = await wireBody(bare)
    expectRealRequest(nothingDeclared)
    // This branch's payload is a bare string on `thinking`, not an object, so
    // the invention it used to make was the literal `"none"` in that slot.
    expect(nothingDeclared.thinking).toBeUndefined()
    expect(Object.hasOwn(nothingDeclared, 'thinking')).toBe(false)
    // ... and the preserved half: a declared spelling still goes out verbatim.
    const declared = await wireBody({
      ...bare,
      models: [{ id: MODEL, reasoningEfforts: { off: 'none', high: 'high' } }],
    })
    expectRealRequest(declared)
    expect(declared.thinking).toBe('none')
  })

  it('omits DeepSeek disable for a thinking-only model and preserves it for an allowlisted toggle', async () => {
    // RED before issue #62: Kimi's thinking-only endpoint has no `off`
    // declaration, but the old `undefined !== null` predicate still fabricated
    // `{ type: "disabled" }`. The grounded safe behavior is omission.
    const denied = await wireBody(bareRoute(), undefined, DEEPSEEK_DENY_TARGET)
    expectRealRequest(denied, DEEPSEEK_DENY_TARGET)
    expectNoThinking(denied)

    // GREEN control before and after the fix: DeepSeek V4 defaults thinking on
    // and documents the fixed `disabled` spelling, so Off must remain effective.
    const allowed = await wireBody(bareRoute(), undefined, DEEPSEEK_ALLOW_TARGET)
    expectRealRequest(allowed, DEEPSEEK_ALLOW_TARGET)
    expect(allowed.thinking).toEqual({ type: 'disabled' })

    // Declarations outrank the fallback: a string is sent verbatim.
    const declared = await wireBody({
      ...bareRoute(),
      models: [{ id: DEEPSEEK_ALLOW_TARGET.model, reasoningEfforts: { off: 'declared-off', high: 'high' } }],
    }, undefined, DEEPSEEK_ALLOW_TARGET)
    expectRealRequest(declared, DEEPSEEK_ALLOW_TARGET)
    expect(declared.thinking).toEqual({ type: 'declared-off' })

    // The built-in K2.7 entry is the catalog's actual explicit-null case; it is
    // always-thinking and must omit rather than falling through to any literal.
    const explicitNull = await wireBody(bareRoute(), undefined, DEEPSEEK_NULL_TARGET)
    expectRealRequest(explicitNull, DEEPSEEK_NULL_TARGET)
    expectNoThinking(explicitNull)
  })

  it('omits Azure `none` when undeclared and preserves a declared Off spelling', async () => {
    // RED before issue #62: every pre-GPT-5.1 o-series model rejects `none`, but
    // the Azure Responses branch manufactured it from this absent map.
    const absent = await wireBody(bareRoute(), undefined, AZURE_UNDECLARED_TARGET)
    expectRealRequest(absent, AZURE_UNDECLARED_TARGET)
    expectNoReasoning(absent)

    // GREEN control before and after the fix: declaration, not a blessed
    // literal, is the authority. Use a conspicuous value so fallback cannot
    // accidentally satisfy the assertion.
    const declared = await wireBody({
      ...bareRoute(),
      models: [{ id: AZURE_UNDECLARED_TARGET.model, reasoningEfforts: { off: 'declared-off', high: 'high' } }],
    }, undefined, AZURE_UNDECLARED_TARGET)
    expectRealRequest(declared, AZURE_UNDECLARED_TARGET)
    expect(declared.reasoning).toEqual({ effort: 'declared-off' })
  })

  it('classifies every absent-Off DeepSeek catalog route at this pin', () => {
    const allowlistedRoutes: string[] = []
    const deniedRoutes: string[] = []
    const unclassifiedRoutes: string[] = []

    for (const provider of allCatalog.getBuiltinProviders()) {
      for (const model of allCatalog.getBuiltinModels(provider as never)) {
        if (model.reasoning !== true || model.compat?.thinkingFormat !== 'deepseek') continue
        if (Object.hasOwn(model.thinkingLevelMap ?? {}, 'off')) continue
        const route = `${provider}/${model.id}`
        if (model.id !== undefined && Object.hasOwn(deepseekDisableModelSources, model.id)) {
          allowlistedRoutes.push(route)
        } else if (model.id !== undefined && Object.hasOwn(DEEPSEEK_THINKING_DISABLE_DENY_MODEL_SOURCES, model.id)) {
          deniedRoutes.push(route)
        } else {
          unclassifiedRoutes.push(route)
        }
      }
    }

    // The exported production table is reviewable data, not hidden control
    // flow, and every member carries the provider-doc citation the RM ruled.
    expect(Object.keys(deepseekDisableModelSources).sort()).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-pro',
      'kimi-k2.5',
      'kimi-k2.6',
      'mimo-v2-flash',
      'mimo-v2-omni',
      'mimo-v2-pro',
      'mimo-v2.5',
      'mimo-v2.5-pro',
      'mimo-v2.5-pro-ultraspeed',
    ])
    expect(Object.values(deepseekDisableModelSources).every(source => source.includes('https://'))).toBe(true)

    expect(allowlistedRoutes.sort()).toEqual([
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4-pro',
      'moonshotai-cn/kimi-k2.5',
      'moonshotai-cn/kimi-k2.6',
      'moonshotai/kimi-k2.5',
      'moonshotai/kimi-k2.6',
      'opencode-go/deepseek-v4-flash',
      'opencode-go/deepseek-v4-pro',
      'opencode-go/kimi-k2.6',
      'opencode/kimi-k2.6',
      'qwen-token-plan-cn/deepseek-v4-flash',
      'qwen-token-plan-cn/deepseek-v4-pro',
      'qwen-token-plan/deepseek-v4-flash',
      'qwen-token-plan/deepseek-v4-pro',
      'xiaomi-token-plan-ams/mimo-v2-pro',
      'xiaomi-token-plan-ams/mimo-v2.5',
      'xiaomi-token-plan-ams/mimo-v2.5-pro',
      'xiaomi-token-plan-cn/mimo-v2-pro',
      'xiaomi-token-plan-cn/mimo-v2.5',
      'xiaomi-token-plan-cn/mimo-v2.5-pro',
      'xiaomi-token-plan-sgp/mimo-v2-pro',
      'xiaomi-token-plan-sgp/mimo-v2.5',
      'xiaomi-token-plan-sgp/mimo-v2.5-pro',
      'xiaomi/mimo-v2-flash',
      'xiaomi/mimo-v2-omni',
      'xiaomi/mimo-v2-pro',
      'xiaomi/mimo-v2.5',
      'xiaomi/mimo-v2.5-pro',
      'xiaomi/mimo-v2.5-pro-ultraspeed',
    ])
    expect(deniedRoutes.sort()).toEqual([
      'moonshotai-cn/kimi-k2-thinking',
      'moonshotai-cn/kimi-k2-thinking-turbo',
      'moonshotai/kimi-k2-thinking',
      'moonshotai/kimi-k2-thinking-turbo',
    ])
    expect(unclassifiedRoutes).toEqual([])
  })
})
