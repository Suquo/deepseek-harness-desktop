import { describe, expect, it } from 'vitest'
import type { ModelRates, TokenBuckets } from '../src/client/cost-model.ts'
import {
  NO_TOKENS, addTokens, formatCost, formatDuration,
  priceTokens, ratesFor, ratesInForce, readTokenBuckets, withBilledCost,
} from '../src/client/cost-model.ts'

/** `google/gemini-3.6-flash` in USD per million tokens, from the live catalogue on 2026-08-20. */
const FLASH: ModelRates = { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.0416666666666667 }

/** `x-ai/grok-4.5` as the live catalogue publishes it, tier included. */
const GROK: ModelRates = {
  input: 2, output: 6, cacheRead: 0.3,
  tiers: [{ inputTokensAbove: 200000, input: 4, output: 12, cacheRead: 0.6 }],
}

const TABLE = { openrouter: { 'google/gemini-3.6-flash': FLASH, 'x-ai/grok-4.5': GROK } }

function tokens(partial: Partial<TokenBuckets>): TokenBuckets {
  return { ...NO_TOKENS, ...partial }
}

/** Money is summed bucket by bucket, so a one-expression expectation differs in the last bit. */
function expectUsd(actual: number, expected: number): void {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-12)
}

describe('reading a usage record off the wire', () => {
  it('accepts the four counts and treats anything else as no usage at all', () => {
    expect(readTokenBuckets({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 90, cacheWriteTokens: 1 }))
      .toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 90, cacheWriteTokens: 1 })
    // A partial report is still a report: the absent buckets are zero, not unknown.
    expect(readTokenBuckets({ inputTokens: 10 })).toEqual(tokens({ inputTokens: 10 }))
    // These are the shapes that must NOT become an all-zero "free" reading.
    expect(readTokenBuckets(undefined)).toBeUndefined()
    expect(readTokenBuckets(null)).toBeUndefined()
    expect(readTokenBuckets({})).toBeUndefined()
    expect(readTokenBuckets({ totalTokens: 100 })).toBeUndefined()
    expect(readTokenBuckets('120')).toBeUndefined()
  })

  it('discards counts that are not finite positive numbers', () => {
    expect(readTokenBuckets({ inputTokens: Number.NaN, outputTokens: 5 })).toEqual(tokens({ outputTokens: 5 }))
    expect(readTokenBuckets({ inputTokens: -3, outputTokens: 5 })).toEqual(tokens({ outputTokens: 5 }))
    expect(readTokenBuckets({ inputTokens: Number.POSITIVE_INFINITY, outputTokens: 5 })).toEqual(tokens({ outputTokens: 5 }))
  })
})

describe('pricing the four disjoint buckets', () => {
  it('rates each bucket at its own rate and never double counts a cached token', () => {
    // pi-ai computes `input = prompt_tokens - cacheRead - cacheWrite` before the
    // harness sees a usage record, so cached tokens must be priced ONLY at the
    // cacheRead rate — at 0.075 against 0.75, folding them into input would
    // overstate this step tenfold.
    const line = priceTokens(tokens({ inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 }), FLASH, 'openrouter/flash')
    expect(line.status).toBe('priced')
    if (line.status !== 'priced') return
    expectUsd(line.usd, (0.75 * 20 + 3.75 * 5 + 0.075 * 90) / 1e6)
  })

  it('prices the harvested 28-step run at the figure the offline harness reports', () => {
    const line = priceTokens(
      tokens({ inputTokens: 450139, cacheReadTokens: 1486141, outputTokens: 31209 }),
      FLASH,
      'openrouter/google/gemini-3.6-flash',
    )
    expect(line.status).toBe('priced')
    if (line.status !== 'priced') return
    expect(line.usd.toFixed(4)).toBe('0.5661')
    // The rate table pinned in the tree would have said $1.1322 for the same
    // tokens. That 2.000x gap is the whole reason this surface reads live rates.
    const pinned = priceTokens(
      tokens({ inputTokens: 450139, cacheReadTokens: 1486141, outputTokens: 31209 }),
      { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0.083333 },
      'openrouter/google/gemini-3.6-flash',
    )
    expect(pinned.status === 'priced' && (pinned.usd / line.usd).toFixed(3)).toBe('2.000')
  })
})

describe('volume tiers', () => {
  it('applies the tier whose threshold the WHOLE prompt crosses', () => {
    // 150k uncached + 100k cached = 250k prompt tokens: over grok's 200k line
    // even though neither bucket alone is.
    const heavy = tokens({ inputTokens: 150000, cacheReadTokens: 100000, outputTokens: 1000 })
    expect(ratesInForce(GROK, heavy).input).toBe(4)
    const line = priceTokens(heavy, GROK, 'openrouter/x-ai/grok-4.5')
    expect(line.status).toBe('priced')
    if (line.status !== 'priced') return
    expectUsd(line.usd, (4 * 150000 + 0.6 * 100000 + 12 * 1000) / 1e6)
  })

  it('stays on the base rates below the threshold, and takes the highest match above it', () => {
    const light = tokens({ inputTokens: 1000, outputTokens: 100 })
    expect(ratesInForce(GROK, light).input).toBe(2)
    const tiered: ModelRates = {
      input: 1, output: 1,
      tiers: [
        { inputTokensAbove: 1000000, input: 9, output: 9 },
        { inputTokensAbove: 100, input: 3, output: 3 },
      ],
    }
    // Listed out of order on purpose: resolution is by threshold, not position.
    expect(ratesInForce(tiered, tokens({ inputTokens: 500 })).input).toBe(3)
    expect(ratesInForce(tiered, tokens({ inputTokens: 2000000 })).input).toBe(9)
    expect(ratesInForce(tiered, tokens({ inputTokens: 50 })).input).toBe(1)
  })
})

describe('what happens when a rate is not known', () => {
  it('reports unpriced with no number attached when the table has no entry', () => {
    const line = priceTokens(tokens({ inputTokens: 10 }), undefined, 'openrouter/unknown-model')
    expect(line).toEqual({ status: 'unpriced', reason: 'no live rate for openrouter/unknown-model' })
    // The union is the fence: an unpriced line carries no `usd` to print.
    expect('usd' in line).toBe(false)
  })

  it('refuses the WHOLE line when a bucket that carries tokens has no rate', () => {
    // The trap: a cache-heavy step whose cacheRead rate is missing would be
    // understated by an order of magnitude if the bucket were merely skipped.
    const line = priceTokens(tokens({ inputTokens: 20, outputTokens: 5, cacheReadTokens: 90 }), { input: 0.75, output: 3.75 }, 'a/partial')
    expect(line.status).toBe('unpriced')
    expect(line.status === 'unpriced' && line.reason).toMatch(/no cacheRead rate, and this used 90 cacheRead tokens/)
  })

  it('prices a step that never touched the unrated bucket', () => {
    const line = priceTokens(tokens({ inputTokens: 20, outputTokens: 5 }), { input: 0.75, output: 3.75 }, 'a/partial')
    expect(line.status).toBe('priced')
  })

  it('keeps free distinguishable from unpriced, and both from no usage', () => {
    const free = priceTokens(tokens({ inputTokens: 100, outputTokens: 10 }), { input: 0, output: 0 }, 'a/free')
    expect(free).toEqual({ status: 'free', usd: 0 })
    const unknown = priceTokens(tokens({ inputTokens: 100 }), undefined, 'openrouter/auto')
    expect(unknown.status).toBe('unpriced')
    const none = priceTokens(undefined, FLASH, 'openrouter/flash')
    expect(none).toEqual({ status: 'untokenized', reason: 'no usage was recorded for this generation' })
    // All three would render "$0.00" under a naive report; none may compare equal.
    expect(new Set([free.status, unknown.status, none.status]).size).toBe(3)
  })
})

describe('table lookup', () => {
  it('needs both halves of the identity', () => {
    expect(ratesFor(TABLE, 'openrouter', 'google/gemini-3.6-flash')).toBe(FLASH)
    expect(ratesFor(TABLE, undefined, 'google/gemini-3.6-flash')).toBeUndefined()
    expect(ratesFor(TABLE, 'openrouter', undefined)).toBeUndefined()
    // A deepseek-route model is not in the OpenRouter catalogue, and is reported
    // unpriced rather than silently matched against a same-named entry.
    expect(ratesFor(TABLE, 'deepseek-official', 'deepseek-v4-flash')).toBeUndefined()
  })
})

describe('display', () => {
  it('keeps sub-cent costs legible and rounds only above a dollar', () => {
    expect(formatCost({ status: 'priced', usd: 0.0166 })).toBe('$0.0166')
    expect(formatCost({ status: 'priced', usd: 1.1322 })).toBe('$1.13')
    expect(formatCost({ status: 'free', usd: 0 })).toBe('free')
    expect(formatCost({ status: 'unpriced', reason: 'x' })).toBe('unpriced')
    expect(formatCost({ status: 'untokenized', reason: 'x' })).toBe('no usage')
  })

  it('labels a billed zero and retains the list-rate estimate it replaced', () => {
    const estimate = { status: 'priced', usd: 0.0166 } as const
    const billed = withBilledCost(estimate, 0)
    expect(billed).toEqual({ status: 'billed', usd: 0, estimate })
    expect(formatCost(billed)).toBe('$0.0000 billed')
    expect(() => withBilledCost(estimate, -1)).toThrow(/finite nonnegative/)
    expect(() => withBilledCost(estimate, Number.NaN)).toThrow(/finite nonnegative/)
  })

  it('renders an unknown duration as a dash rather than as zero', () => {
    expect(formatDuration(undefined)).toBe('—')
    expect(formatDuration(Number.NaN)).toBe('—')
    expect(formatDuration(-1)).toBe('—')
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(940)).toBe('940ms')
    expect(formatDuration(9730)).toBe('9.7s')
    expect(formatDuration(636800)).toBe('10m 37s')
  })

  it('adds bucket sets without losing a bucket', () => {
    expect(addTokens(tokens({ inputTokens: 1, cacheWriteTokens: 4 }), tokens({ outputTokens: 2, cacheReadTokens: 3 })))
      .toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })
  })
})
