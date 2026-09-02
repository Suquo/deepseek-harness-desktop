/**
 * Drift guard between the two pricing implementations.
 *
 * The same arithmetic exists twice on purpose, because its two consumers live
 * on opposite sides of a layering boundary that neither should cross:
 *
 *   - `dsh-plugin-desktop/src/client/cost-model.ts` — browser, TypeScript, in
 *     the desktop client bundle; the in-UI surface.
 *   - `dsh-preset-parametria/scripts/session-cost.mjs` — Node, offline; reads a
 *     session export the app has already written.
 *
 * The desktop shell must not depend on a preset package (that inverts the
 * layering), and a browser bundle must not carry Node's `fs`. So the fence
 * takes the place of the shared module: every vector below is priced by BOTH
 * implementations and the two answers must match, status and money alike. A
 * rule added to one and forgotten in the other fails here rather than shipping
 * a UI that disagrees with the report for the same run.
 */

import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - plain-JS sibling package, deliberately untyped and not a dependency of this one
import {
  STATUSES as OFFLINE_STATUSES,
  priceStep,
  withBilledCost as withOfflineBilledCost,
} from '../../dsh-preset-parametria/scripts/session-cost.mjs'
import type { CostLine, ModelRates, TokenBuckets } from '../src/client/cost-model.ts'
import { COST_STATUSES, NO_TOKENS, priceTokens, withBilledCost } from '../src/client/cost-model.ts'

interface OfflineCostLine {
  status: string
  usd?: number
  reason?: string
  estimate?: OfflineCostLine
}

/** The offline module is plain JS; this is the only place its shape is asserted. */
const priceOffline = priceStep as (row: unknown, table: unknown) => OfflineCostLine
const billOffline = withOfflineBilledCost as (estimate: OfflineCostLine, usd: number) => OfflineCostLine

const PROVIDER = 'openrouter'
const MODEL = 'google/gemini-3.6-flash'

/** Every named rate shape the two implementations must agree about. */
const RATE_SHAPES = {
  full: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0416666666666667 },
  noCacheRates: { input: 0.75, output: 3.75 },
  free: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  tiered: {
    input: 2, output: 6, cacheRead: 0.3,
    tiers: [{ inputTokensAbove: 200000, input: 4, output: 12, cacheRead: 0.6 }],
  },
  tiersOutOfOrder: {
    input: 1, output: 1,
    tiers: [
      { inputTokensAbove: 1000000, input: 9, output: 9 },
      { inputTokensAbove: 100, input: 3, output: 3 },
    ],
  },
} as const satisfies Record<string, ModelRates>

interface Vector {
  readonly name: string
  readonly rates: keyof typeof RATE_SHAPES | 'absent'
  readonly tokens: Partial<TokenBuckets> | 'none'
}

const VECTORS: readonly Vector[] = [
  { name: 'an ordinary uncached step', rates: 'full', tokens: { inputTokens: 100, outputTokens: 10 } },
  { name: 'a cache-heavy step', rates: 'full', tokens: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 } },
  { name: 'a step that also wrote cache', rates: 'full', tokens: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 90, cacheWriteTokens: 30 } },
  { name: 'the harvested 28-step run', rates: 'full', tokens: { inputTokens: 450139, cacheReadTokens: 1486141, outputTokens: 31209 } },
  { name: 'a step with no tokens at all', rates: 'full', tokens: {} },
  { name: 'a model the table does not carry', rates: 'absent', tokens: { inputTokens: 100, outputTokens: 10 } },
  { name: 'a cache-heavy step whose cacheRead rate is missing', rates: 'noCacheRates', tokens: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 } },
  { name: 'an uncached step whose missing cache rate is never consulted', rates: 'noCacheRates', tokens: { inputTokens: 20, outputTokens: 5 } },
  { name: 'a genuinely free model', rates: 'free', tokens: { inputTokens: 100, outputTokens: 10 } },
  { name: 'a step with no usage report', rates: 'full', tokens: 'none' },
  { name: 'a tiered model below its threshold', rates: 'tiered', tokens: { inputTokens: 1000, outputTokens: 100 } },
  { name: 'a tiered model pushed over by its cache reads alone', rates: 'tiered', tokens: { inputTokens: 150000, cacheReadTokens: 100000, outputTokens: 1000 } },
  { name: 'tiers declared out of order, low match', rates: 'tiersOutOfOrder', tokens: { inputTokens: 500, outputTokens: 10 } },
  { name: 'tiers declared out of order, high match', rates: 'tiersOutOfOrder', tokens: { inputTokens: 2000000, outputTokens: 10 } },
]

function bucketsOf(vector: Vector): TokenBuckets | undefined {
  return vector.tokens === 'none' ? undefined : { ...NO_TOKENS, ...vector.tokens }
}

/** Collapse both results to one comparable shape: status, and money to the cent-thousandth. */
function comparable(line: CostLine | OfflineCostLine): { status: string; usd: string | null } {
  const usd = 'usd' in line && typeof line.usd === 'number' ? line.usd.toFixed(10) : null
  return { status: line.status, usd }
}

describe('the in-UI and offline pricing implementations agree', () => {
  it.each(VECTORS.map(vector => [vector.name, vector] as const))('%s', (_name, vector) => {
    const tokens = bucketsOf(vector)
    const rates = vector.rates === 'absent' ? undefined : RATE_SHAPES[vector.rates]

    const inUi = priceTokens(tokens, rates, `${PROVIDER}/${MODEL}`)
    const offline = priceOffline(
      { provider: PROVIDER, model: MODEL, ...tokens === undefined ? {} : { usage: tokens } },
      rates === undefined ? { [PROVIDER]: {} } : { [PROVIDER]: { [MODEL]: rates } },
    )

    expect(comparable(inUi)).toEqual(comparable(offline))
  })

  it('declares the same status set on both sides, in both directions', () => {
    // The first version of this sweep enumerated statuses through `priceTokens`
    // alone and compared them to a literal, so a status only the OFFLINE
    // implementation could produce escaped it entirely — while the test's name
    // claimed to cover both. Each side now publishes its own set and they are
    // compared as sets: an addition to either that is not mirrored fails here.
    const inUi: readonly string[] = COST_STATUSES
    const offline = OFFLINE_STATUSES as readonly string[]
    expect(offline.filter(status => !inUi.includes(status))).toEqual([])
    expect(inUi.filter(status => !offline.includes(status))).toEqual([])
  })

  it('reaches every declared status from the vector table, on both sides', () => {
    // A declared status neither implementation produces, or a vector table that
    // never reaches a declared one, is a hole in the fence above. Both arms are
    // swept, so this no longer speaks for an implementation it never ran.
    const inUi = new Set<string>()
    const offline = new Set<string>()
    for (const vector of VECTORS) {
      const tokens = bucketsOf(vector)
      const rates = vector.rates === 'absent' ? undefined : RATE_SHAPES[vector.rates]
      inUi.add(priceTokens(tokens, rates, 'x/y').status)
      offline.add(priceOffline(
        { provider: PROVIDER, model: MODEL, ...tokens === undefined ? {} : { usage: tokens } },
        rates === undefined ? { [PROVIDER]: {} } : { [PROVIDER]: { [MODEL]: rates } },
      ).status)
    }
    const estimate = priceTokens({ ...NO_TOKENS, inputTokens: 1 }, RATE_SHAPES.full, 'x/y')
    const offlineEstimate = priceOffline(
      { provider: PROVIDER, model: MODEL, usage: { inputTokens: 1 } },
      { [PROVIDER]: { [MODEL]: RATE_SHAPES.full } },
    )
    inUi.add(withBilledCost(estimate, 0).status)
    offline.add(billOffline(offlineEstimate, 0).status)
    const declared = [...COST_STATUSES].sort()
    expect([...inUi].sort()).toEqual(declared)
    expect([...offline].sort()).toEqual(declared)
  })

  it('constructs the same billed overlay without losing the estimate', () => {
    const inUiEstimate = priceTokens({ ...NO_TOKENS, inputTokens: 10 }, RATE_SHAPES.full, 'x/y')
    const offlineEstimate = priceOffline(
      { provider: PROVIDER, model: MODEL, usage: { inputTokens: 10 } },
      { [PROVIDER]: { [MODEL]: RATE_SHAPES.full } },
    )
    expect(withBilledCost(inUiEstimate, 0.0123)).toEqual(billOffline(offlineEstimate, 0.0123))
  })

  it('states its own divergence: only the reason wording differs', () => {
    // The two carry different vocabulary for the same refusal ("no live rate
    // for" vs "no price entry for") because one names a live source and the
    // other a supplied file. The fence compares status and money, and this
    // records why it does not compare prose.
    const inUi = priceTokens({ ...NO_TOKENS, inputTokens: 1 }, undefined, 'openrouter/x')
    const offline = priceOffline(
      { provider: 'openrouter', model: 'x', usage: { inputTokens: 1 } },
      { openrouter: {} },
    )
    expect(inUi.status).toBe(offline.status)
    expect(inUi.status === 'unpriced' && inUi.reason).not.toBe(offline.reason)
  })
})
