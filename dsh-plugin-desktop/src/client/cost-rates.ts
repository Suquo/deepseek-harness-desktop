/**
 * Live model rates for the desktop cost surface.
 *
 * WHY LIVE, AND NOT THE TABLE ALREADY IN THE TREE: the pinned pi-ai catalogue
 * (`@earendil-works/pi-ai/dist/providers/data/openrouter.json`) rates all 276
 * OpenRouter models, and on 2026-08-20 it was measured **exactly 2.000x** the
 * real rate for `google/gemini-3.6-flash` — a harvested 28-step run priced
 * $1.1322 against its true $0.5661. It also ships zero volume tiers, while
 * `x-ai/grok-4.5` really does double above 200k prompt tokens. A shipped table
 * drifts in both directions at once, so this surface reads the rates OpenRouter
 * publishes now and shows the reader when it read them.
 *
 * `GET /api/v1/models` is public and unauthenticated — no credential reaches
 * the renderer, and none is needed. It is still an ESTIMATE: it is the list
 * price, not the invoice, so BYOK routing, negotiated rates and provider
 * fallbacks are not reflected. Real billed cost needs the Host plane; that is
 * a separate issue.
 *
 * FAIL-OPEN (standard 4): every failure resolves to an empty table with the
 * reason attached. The surface then renders tokens and timings with `unpriced`
 * costs — a backend being unreachable never blanks a surface.
 */

import type { ModelRates, RateTable, RateTier } from './cost-model.ts'

/** The public, unauthenticated model catalogue. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

/** The pi-ai route name whose models this catalogue prices. */
export const OPENROUTER_PROVIDER = 'openrouter'

/** How long to wait before giving up and rendering everything unpriced. */
export const RATE_FETCH_TIMEOUT_MS = 8000

/** A resolved rate table plus the provenance a reader needs to trust it. */
export interface RateSnapshot {
  /** Rates by provider route and model id; empty when the fetch failed. */
  readonly table: RateTable
  /** When these rates were read, or undefined when none were. */
  readonly fetchedAt?: number
  /** How many models were rated. */
  readonly modelCount: number
  /** Why the table is empty, when it is. */
  readonly error?: string
}

/** The fail-open value: no rates, no pretence of any. */
export const NO_RATES: RateSnapshot = { table: {}, modelCount: 0 }

/**
 * OpenRouter publishes USD per token as decimal strings; the surface works in
 * USD per million tokens, which is the unit every rate table in this ecosystem
 * uses (pi-ai's catalogue included).
 */
function perMillion(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return parsed * 1_000_000
}

function readTiers(pricing: Record<string, unknown>): readonly RateTier[] | undefined {
  const overrides = pricing['overrides']
  if (!Array.isArray(overrides)) return undefined
  const tiers: RateTier[] = []
  for (const raw of overrides as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const override = raw as Record<string, unknown>
    const above = override['min_prompt_tokens']
    const input = perMillion(override['prompt'])
    const output = perMillion(override['completion'])
    if (typeof above !== 'number' || !Number.isFinite(above) || input === undefined || output === undefined) continue
    const cacheRead = perMillion(override['input_cache_read'])
    const cacheWrite = perMillion(override['input_cache_write'])
    tiers.push({
      inputTokensAbove: above,
      input,
      output,
      ...cacheRead === undefined ? {} : { cacheRead },
      ...cacheWrite === undefined ? {} : { cacheWrite },
    })
  }
  return tiers.length === 0 ? undefined : tiers
}

/**
 * Turn one OpenRouter catalogue payload into a rate table.
 *
 * A model whose prompt or completion rate does not parse is LEFT OUT rather
 * than defaulted, so it reaches the surface as `unpriced` instead of as a
 * confident wrong number.
 * @param payload - the parsed response body.
 * @returns the rate snapshot without its timestamp.
 */
export function parseOpenRouterModels(payload: unknown): { table: RateTable; modelCount: number } {
  const data = (payload as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return { table: {}, modelCount: 0 }
  const models: Record<string, ModelRates> = {}
  for (const raw of data as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>
    const id = entry['id']
    const pricing = entry['pricing']
    if (typeof id !== 'string' || typeof pricing !== 'object' || pricing === null) continue
    const rates = pricing as Record<string, unknown>
    const input = perMillion(rates['prompt'])
    const output = perMillion(rates['completion'])
    if (input === undefined || output === undefined) continue
    const cacheRead = perMillion(rates['input_cache_read'])
    const cacheWrite = perMillion(rates['input_cache_write'])
    const tiers = readTiers(rates)
    models[id] = {
      input,
      output,
      ...cacheRead === undefined ? {} : { cacheRead },
      ...cacheWrite === undefined ? {} : { cacheWrite },
      ...tiers === undefined ? {} : { tiers },
    }
  }
  const modelCount = Object.keys(models).length
  return { table: modelCount === 0 ? {} : { [OPENROUTER_PROVIDER]: models }, modelCount }
}

/**
 * Read the live rates once.
 *
 * Never rejects: every failure — offline, timeout, non-200, malformed body —
 * becomes a {@link RateSnapshot} carrying the reason, because a cost surface
 * that disappears when a third-party endpoint is slow is worse than one that
 * says it does not know the price.
 * @param signal - optional caller abort, composed with the internal timeout.
 * @param fetchImpl - injected for tests; defaults to the page's `fetch`.
 * @returns the snapshot, always.
 */
export async function fetchOpenRouterRates(
  signal?: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<RateSnapshot> {
  const timeout = AbortSignal.timeout(RATE_FETCH_TIMEOUT_MS)
  try {
    const response = await fetchImpl(OPENROUTER_MODELS_URL, {
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      return { ...NO_RATES, error: `OpenRouter answered ${String(response.status)}` }
    }
    const { table, modelCount } = parseOpenRouterModels(await response.json())
    if (modelCount === 0) return { ...NO_RATES, error: 'OpenRouter returned no priced models' }
    return { table, modelCount, fetchedAt: Date.now() }
  } catch (cause: unknown) {
    return { ...NO_RATES, error: cause instanceof Error ? cause.message : String(cause) }
  }
}

/**
 * A single in-flight read shared by every mounted badge.
 *
 * One client generation reads the catalogue once: a conversation renders one
 * of these per turn, and a fetch per badge would hammer a third-party endpoint
 * for a table that does not change during a session.
 */
export class RateSource {
  private pending: Promise<RateSnapshot> | undefined
  private snapshot: RateSnapshot = NO_RATES
  private readonly listeners = new Set<() => void>()
  private readonly controller = new AbortController()

  /** @param read - injected reader; defaults to the live fetch. */
  constructor(private readonly read: (signal: AbortSignal) => Promise<RateSnapshot> = fetchOpenRouterRates) {}

  /** @returns the current snapshot; the fail-open empty table until the first read lands. */
  getSnapshot(): RateSnapshot {
    return this.snapshot
  }

  /**
   * Subscribe to snapshot changes and start the read on first interest.
   * @param listener - called once the snapshot changes.
   * @returns unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    // The `.catch` is not belt-and-braces. `fetchOpenRouterRates` never
    // rejects, but the reader is injectable and `dispose()` aborts an
    // in-flight read — an abort that rejected would surface as an unhandled
    // rejection during ordinary shell teardown.
    this.pending ??= this.read(this.controller.signal)
      .catch((cause: unknown) => ({
        ...NO_RATES,
        error: cause instanceof Error ? cause.message : String(cause),
      }))
      .then((next) => {
        this.snapshot = next
        for (const notify of [...this.listeners]) notify()
        return next
      })
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The in-flight read, once one has been started.
   *
   * Exists so a caller — the disposal fence above all — can await the read's
   * settlement instead of racing it. It resolves, never rejects.
   * @returns the read promise, or undefined before the first subscriber.
   */
  whenSettled(): Promise<RateSnapshot> | undefined {
    return this.pending
  }

  /** Abandon an in-flight read and drop every listener; the generation owns this. */
  dispose(): void {
    this.controller.abort()
    this.listeners.clear()
  }
}
