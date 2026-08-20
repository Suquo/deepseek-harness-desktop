/**
 * Pricing arithmetic for the desktop cost surface.
 *
 * Pure, DOM-free, and deliberately ignorant of where rates come from: the
 * caller supplies a {@link RateTable} and this module turns token buckets into
 * a {@link CostLine}. `cost-rates.ts` owns the source (live OpenRouter rates);
 * `turn-cost.ts` owns the fold; this owns only the multiply.
 *
 * THE ONE RULE: a rate nobody knows never renders as zero. `unpriced` and
 * `untokenized` carry no `usd` at all — the union makes a caller branch before
 * it can print a number — and only a model whose every used bucket is rated at
 * zero reports `free`. A cost line reading `$0.00` therefore means the tokens
 * were free, never that the lookup missed.
 *
 * The four buckets are DISJOINT. pi-ai computes `input = prompt_tokens -
 * cacheRead - cacheWrite` before the harness ever sees a usage record
 * (`@earendil-works/pi-ai/dist/api/openai-completions.js`), so adding cached
 * tokens back into the input bucket would bill the same tokens twice, at ten
 * times the rate.
 */

/** Per-million-token USD rates for the four disjoint buckets. */
export interface ModelRates {
  /** USD per million uncached prompt tokens. */
  readonly input: number
  /** USD per million completion tokens (reasoning tokens are already inside this bucket). */
  readonly output: number
  /**
   * USD per million cache-read tokens, when the provider prices caching.
   *
   * Optional on purpose: a provider that does not publish a cache rate must not
   * be given an invented one. Absent here and non-zero in the run means the
   * generation reports `unpriced`, which is the honest answer.
   */
  readonly cacheRead?: number
  /** USD per million cache-write tokens, when the provider prices caching. */
  readonly cacheWrite?: number
  /**
   * Volume tiers, highest matching threshold wins.
   *
   * Not decoration: `x-ai/grok-4.5` doubles every rate above 200,000 prompt
   * tokens, and a long-context Parametria run crosses that line routinely. The
   * pinned pi-ai catalogue ships zero tiers for all 276 OpenRouter models, so a
   * table built from it understates exactly the runs this harness exists for.
   */
  readonly tiers?: readonly RateTier[]
}

/** One volume tier: the rates that apply once prompt tokens exceed its threshold. */
export interface RateTier extends Omit<ModelRates, 'tiers'> {
  /** Prompt-token count (input + cacheRead + cacheWrite) above which this tier's rates apply. */
  readonly inputTokensAbove: number
}

/** Rates by provider route, then by model id. */
export type RateTable = Readonly<Record<string, Readonly<Record<string, ModelRates>> | undefined>>

/** The four disjoint token counts the harness records per generation. */
export interface TokenBuckets {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/**
 * The outcome of pricing one generation.
 *
 * A union rather than an optional number, so that no caller can read `usd`
 * without having established that one exists.
 */
export type CostLine =
  | { readonly status: 'priced'; readonly usd: number }
  | { readonly status: 'free'; readonly usd: 0 }
  | { readonly status: 'unpriced'; readonly reason: string }
  | { readonly status: 'untokenized'; readonly reason: string }

/** Applying this to a non-`never` type is a compile error — the assertion behind {@link COST_STATUSES}. */
type AssertNever<T extends never> = T

/**
 * Every status a {@link CostLine} can carry, as a value a test can iterate.
 *
 * `CostLine` is a type and so invisible at runtime, which is exactly what let a
 * status sweep enumerate one implementation and silently miss the other's. This
 * list is the union's runtime witness, pinned to it in BOTH directions at
 * compile time: `satisfies` rejects a member the union does not have, and
 * {@link UnlistedCostStatus} rejects a union arm this list omits.
 */
export const COST_STATUSES = ['priced', 'free', 'unpriced', 'untokenized'] as const satisfies readonly CostLine['status'][]

/**
 * Compile-time proof that {@link COST_STATUSES} omits no arm of {@link CostLine}.
 *
 * Resolves to `never` while the two agree. Add a fifth arm to `CostLine`
 * without listing it here and `Exclude` yields that arm, `AssertNever` refuses
 * it, and the build fails at the declaration — rather than in a test that
 * happens to enumerate the old four and passes.
 */
export type UnlistedCostStatus = AssertNever<Exclude<CostLine['status'], (typeof COST_STATUSES)[number]>>

/** Bucket field names paired with the rate field that prices them. */
const BUCKET_RATES = [
  ['inputTokens', 'input'],
  ['cacheReadTokens', 'cacheRead'],
  ['cacheWriteTokens', 'cacheWrite'],
  ['outputTokens', 'output'],
] as const satisfies readonly (readonly [keyof TokenBuckets, keyof Omit<ModelRates, 'tiers'>])[]

/** An empty run reports no tokens rather than absent ones. */
export const NO_TOKENS: TokenBuckets = {
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Narrow the `unknown` usage carried on an assistant node.
 *
 * The client contract types the field as `unknown` (it crosses the wire from
 * the Host), so every consumer has to prove its shape. A record that carries
 * none of the four counts is not a usage report and returns `undefined`, which
 * is what separates "this step was never billed" from "this step cost zero".
 * @param usage - the node's raw usage value.
 * @returns the four buckets, or undefined when no usage was recorded.
 */
export function readTokenBuckets(usage: unknown): TokenBuckets | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const present = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']
    .some(field => typeof record[field] === 'number')
  if (!present) return undefined
  return {
    inputTokens: count(record['inputTokens']),
    outputTokens: count(record['outputTokens']),
    cacheReadTokens: count(record['cacheReadTokens']),
    cacheWriteTokens: count(record['cacheWriteTokens']),
  }
}

/** Add two bucket sets. @param a - left. @param b - right. @returns the sum. */
export function addTokens(a: TokenBuckets, b: TokenBuckets): TokenBuckets {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  }
}

/**
 * Resolve the rates in force for a prompt of this size.
 *
 * Mirrors pi-ai's own tier resolution: the threshold is compared against the
 * whole prompt (input + both cache buckets), and the HIGHEST matched threshold
 * wins, so tiers may be listed in any order.
 * @param rates - the model's rate record.
 * @param tokens - the generation's buckets.
 * @returns the flat rates to multiply by.
 */
export function ratesInForce(rates: ModelRates, tokens: TokenBuckets): Omit<ModelRates, 'tiers'> {
  const promptTokens = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
  let winner: Omit<ModelRates, 'tiers'> = rates
  let matched = -1
  for (const tier of rates.tiers ?? []) {
    if (promptTokens > tier.inputTokensAbove && tier.inputTokensAbove > matched) {
      winner = tier
      matched = tier.inputTokensAbove
    }
  }
  return winner
}

/** Find a model's rates in a table. @param table - the rate table. @param provider - route name. @param model - model id. @returns the rates when present. */
export function ratesFor(table: RateTable, provider: string | undefined, model: string | undefined): ModelRates | undefined {
  if (provider === undefined || model === undefined) return undefined
  return table[provider]?.[model]
}

/**
 * Price one generation's token buckets.
 *
 * A bucket that carries tokens but has no rate makes the WHOLE line unpriced.
 * Rating three buckets of four and calling the sum a cost is the silent
 * understatement this module exists to refuse — on a cache-heavy Parametria
 * run the unrated bucket is usually the largest one.
 * @param tokens - the generation's buckets, or undefined when none was recorded.
 * @param rates - the model's rates, or undefined when the table has none.
 * @param label - provider/model text used in the refusal reason.
 * @returns the cost line.
 */
export function priceTokens(
  tokens: TokenBuckets | undefined,
  rates: ModelRates | undefined,
  label: string,
): CostLine {
  if (tokens === undefined) return { status: 'untokenized', reason: 'no usage was recorded for this generation' }
  if (rates === undefined) return { status: 'unpriced', reason: `no live rate for ${label}` }
  const inForce = ratesInForce(rates, tokens)
  let usd = 0
  let rated = 0
  for (const [bucket, rate] of BUCKET_RATES) {
    const used = tokens[bucket]
    if (used === 0) continue
    const perMillion = inForce[rate]
    if (typeof perMillion !== 'number' || !Number.isFinite(perMillion)) {
      return { status: 'unpriced', reason: `${label} has no ${rate} rate, and this used ${String(used)} ${rate} tokens` }
    }
    usd += (perMillion / 1_000_000) * used
    rated += perMillion
  }
  return rated === 0 ? { status: 'free', usd: 0 } : { status: 'priced', usd }
}

/**
 * Format a cost line for display.
 *
 * Sub-cent costs get four decimals because a Parametria step routinely lands
 * between a tenth of a cent and a cent, and `$0.01` for everything would make
 * the per-step column useless.
 * @param line - the cost line.
 * @returns display text.
 */
export function formatCost(line: CostLine): string {
  switch (line.status) {
    case 'free': return 'free'
    case 'priced': return line.usd >= 1 ? `$${line.usd.toFixed(2)}` : `$${line.usd.toFixed(4)}`
    case 'unpriced': return 'unpriced'
    case 'untokenized': return 'no usage'
  }
}

/**
 * Format a duration for display.
 * @param milliseconds - the duration, or undefined when unknown.
 * @returns display text; an em dash when the boundary was not recorded.
 */
export function formatDuration(milliseconds: number | undefined): string {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  if (milliseconds < 1000) return `${String(Math.round(milliseconds))}ms`
  const seconds = milliseconds / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes)}m ${String(Math.round(seconds - minutes * 60))}s`
}
